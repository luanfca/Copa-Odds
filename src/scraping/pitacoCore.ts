// ============================================================================
// pitacoCore.ts
// Decodificador protobuf + parsers para o Pitaco (pitaco.bet.br)
// Sem dependências externas. Validado offline contra captura real:
//   Qualquer Cartão 49/49, Cartão Vermelho 49/49, Marcar Gol 21/21 etc.
//
// Protocolo (descoberto por engenharia reversa):
//
// 1) ESTRUTURA  ->  RPC gRPC-Web (Connect):
//    POST https://pitaco.bet.br/api/ui_betting_events_components.UiBettingEventService/GetUiEventTabContent
//    Body = frames gRPC-web [1 flag][4B big-endian len][payload]...
//    Caminho do protobuf:
//      root.1[*]                      -> bloco de mercado
//        .1.1.1                       -> nome do mercado ("Desarmes", "Faltas Cometidas"...)
//        .1.2.1.14.1[*]               -> jogadores
//          .1.1.1 = nome | .1.2.1 = time | .1.3.1 = foto
//          .2[*]                      -> linhas
//            .1.1   = label da linha ("2+")
//            .2.1   = outcome_id  (CHAVE QUE LIGA ÀS ODDS)
//            .2.2.1 = label ("Ugarte 2+")
//            .2.3   = status_id (prefixo 6...)
//
// 2) ODDS  ->  WebSocket:
//    wss://pitaco.bet.br/api/real-time-odds?appVersion=888.888.888
//    Frames binarios protobuf. Para cada outcome:
//      { 1: outcome_id("7..."), 2: { 1: raw, 2: ts(varint), 3: display("3.75x") } }
//    odd decimal = raw / 1_000_000
//    (mensagens de status tem id prefixo 6... e nao tem display)
// ============================================================================

export type Field = { k: 'V' | 'L' | 'I32' | 'I64'; v: number | Uint8Array }
export type Node = Map<number, Field[]>

function readVarint(b: Uint8Array, i: number): [number, number] {
	let shift = 0
	let res = 0
	while (i < b.length) {
		const x = b[i++]
		res += (x & 0x7f) * Math.pow(2, shift)
		if (!(x & 0x80)) break
		shift += 7
	}
	return [res, i]
}

export function decode(b: Uint8Array): Node {
	const out: Node = new Map()
	let i = 0
	while (i < b.length) {
		let tag: number
		;[tag, i] = readVarint(b, i)
		if (i > b.length) break
		const field = Math.floor(tag / 8)
		const wt = tag & 7
		let f: Field | null = null
		if (wt === 0) {
			let v: number
			;[v, i] = readVarint(b, i)
			f = { k: 'V', v }
		} else if (wt === 2) {
			let ln: number
			;[ln, i] = readVarint(b, i)
			if (i + ln > b.length) break
			f = { k: 'L', v: b.slice(i, i + ln) }
			i += ln
		} else if (wt === 5) {
			f = { k: 'I32', v: 0 }
			i += 4
		} else if (wt === 1) {
			f = { k: 'I64', v: 0 }
			i += 8
		} else break
		if (f) {
			if (!out.has(field)) out.set(field, [])
			out.get(field)!.push(f)
		}
	}
	return out
}

function looksMsg(c: Uint8Array): boolean {
	if (!c.length) return false
	let i = 0
	let n = 0
	try {
		while (i < c.length) {
			let tag: number
			;[tag, i] = readVarint(c, i)
			const wt = tag & 7
			if (wt === 2) {
				let ln: number
				;[ln, i] = readVarint(c, i)
				if (i + ln > c.length) return false
				i += ln
			} else if (wt === 0) {
				;[, i] = readVarint(c, i)
			} else if (wt === 5) i += 4
			else if (wt === 1) i += 8
			else return false
			n++
		}
		return i === c.length && n > 0
	} catch {
		return false
	}
}

const td = new TextDecoder('utf-8', { fatal: false })
function asStr(b: Uint8Array): string {
	return td.decode(b)
}

export function sub(node: Node | undefined, field: number): Node | undefined {
	const f = node?.get(field)?.[0]
	if (!f || f.k !== 'L') return undefined
	const raw = f.v as Uint8Array
	return looksMsg(raw) ? decode(raw) : undefined
}
export function subAll(node: Node | undefined, field: number): Node[] {
	const arr = node?.get(field) || []
	return arr
		.filter((f) => f.k === 'L' && looksMsg(f.v as Uint8Array))
		.map((f) => decode(f.v as Uint8Array))
}
export function str(node: Node | undefined, field: number): string | undefined {
	const f = node?.get(field)?.[0]
	if (!f || f.k !== 'L') return undefined
	return asStr(f.v as Uint8Array)
}
export function strPath(node: Node | undefined, path: number[]): string | undefined {
	let n = node
	for (let i = 0; i < path.length - 1; i++) n = sub(n, path[i])
	return str(n, path[path.length - 1])
}

/** Remove o framing gRPC-web/Connect ([1 flag][4B len][payload]...) e concatena os payloads de dados. */
export function ungrpc(buf: Uint8Array): Uint8Array {
	const parts: Uint8Array[] = []
	let i = 0
	while (i + 5 <= buf.length) {
		const flag = buf[i]
		const ln = (buf[i + 1] << 24) | (buf[i + 2] << 16) | (buf[i + 3] << 8) | buf[i + 4]
		i += 5
		const payload = buf.slice(i, i + ln)
		i += ln
		if (flag & 0x80) continue // frame de trailer
		parts.push(payload)
	}
	if (!parts.length) return buf
	const total = parts.reduce((a, p) => a + p.length, 0)
	const out = new Uint8Array(total)
	let o = 0
	for (const p of parts) {
		out.set(p, o)
		o += p.length
	}
	return out
}

// ---------------------------------------------------------------------------
// ODDS (WebSocket real-time-odds)
// ---------------------------------------------------------------------------
export type OddsValue = { value: number; display: string }

/** Decodifica um frame binario do WS e retorna { outcome_id -> { value, display } }. */
export function parseWsOdds(buf: Uint8Array): Record<string, OddsValue> {
	const map: Record<string, OddsValue> = {}
	function walk(n: Node) {
		for (const [, fields] of n)
			for (const f of fields) {
				if (f.k !== 'L') continue
				const raw = f.v as Uint8Array
				if (!looksMsg(raw)) continue
				const node = decode(raw)
				const id = str(node, 1)
				const odds = sub(node, 2)
				if (id && /^7\d{14,}$/.test(id) && odds) {
					const rawOdd = str(odds, 1)
					const display = str(odds, 3)
					if (rawOdd && /^\d+$/.test(rawOdd) && display) {
						map[id] = { value: parseInt(rawOdd, 10) / 1_000_000, display }
					}
				}
				walk(node)
			}
	}
	walk(decode(buf))
	return map
}

// ---------------------------------------------------------------------------
// ESTRUTURA (GetUiEventTabContent)
// ---------------------------------------------------------------------------
export type PitacoLine = { line: string; outcomeId: string; label?: string; statusId?: string }
export type PitacoPlayerMarket = {
	market: string
	player: string
	team?: string
	lines: PitacoLine[]
}

/**
 * Decodifica o body (gRPC-web) de GetUiEventTabContent e retorna os mercados de
 * player props (jogador x linhas x outcome_id). Passe `targetMarkets` para filtrar
 * por nome de mercado (ex.: new Set(['Desarmes','Faltas Cometidas','Faltas Sofridas'])).
 */
export function parseTabContent(buf: Uint8Array, targetMarkets?: Set<string>): PitacoPlayerMarket[] {
	const root = decode(ungrpc(buf))
	const results: PitacoPlayerMarket[] = []
	for (const M of subAll(root, 1)) {
		const W = sub(M, 1)
		const marketName = strPath(W, [1, 1])
		if (!marketName) continue
		if (targetMarkets && !targetMarkets.has(marketName)) continue
		const f14 = sub(sub(sub(W, 2), 1), 14) // W.2.1.14 -> agrupamento de jogadores
		const players = subAll(f14, 1)
		for (const P of players) {
			const header = sub(P, 1)
			const player = strPath(header, [1, 1]) || '?'
			const team = strPath(header, [2, 1])
			const lines: PitacoLine[] = []
			for (const line of subAll(P, 2)) {
				const label = strPath(line, [1, 1])
				const outcomeId = strPath(line, [2, 1])
				const outLabel = strPath(line, [2, 2, 1])
				const statusId = str(sub(line, 2), 3)
				if (outcomeId && /^7\d{14,}$/.test(outcomeId)) {
					lines.push({ line: label, outcomeId, label: outLabel, statusId })
				}
			}
			if (lines.length) results.push({ market: marketName, player, team, lines })
		}
	}
	return results
}
