/**
 * Adaptador Pitaco v3.
 *
 * A lista de jogos vem de uma resposta protobuf. Em ambientes cloud o HTML
 * pode não renderizar os links, portanto a resposta binária é a fonte
 * principal e o DOM fica como fallback.
 */
import { BrowserContext } from 'playwright'
import { logger } from '../lib/logger'
import { extractStage, normalizeLine, normalizePlayerNameFormat } from '../lib/normalize'
import { isClubTeam } from '../lib/flagMap'
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping'
import { decode, ungrpc, sub, subAll, strPath, type Node } from './pitacoCore'
import {
  resolvePitacoMarket,
  normMarketName,
  RAW_PITACO_MARKET_MAP,
} from './marketMap'

export { resolvePitacoMarket, normMarketName } from './marketMap'

const PITACO_BASE = 'https://pitaco.bet.br'
const COMP_SERVICE = 'ui_betting_competition_components.UiBettingCompetitionService'

// Competition IDs
const COMPETITION_IDS: Record<string, string> = {
  copa: '13204866376',
  brasileirao: '13203979564',
  mls: '13203979544',
}

const RAW_MARKET_MAP: Record<string, ScrapedOdd['market']> = {
  ...RAW_PITACO_MARKET_MAP,
}

// Mapa normalizado para matching flexível
const NORM_MARKET_MAP = new Map<string, ScrapedOdd['market']>();
for (const [key, val] of Object.entries(RAW_MARKET_MAP)) {
  NORM_MARKET_MAP.set(normMarketName(key), val);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

const PITACO_GRPC_HEADERS: Record<string, string> = {
  'content-type': 'application/grpc-web+proto',
  'x-grpc-web': '1',
  'x-user-agent': 'connect-es/2.1.1',
  origin: PITACO_BASE,
  referer: `${PITACO_BASE}/`,
  platform: 'turbo_lite_desktop',
  product: 'betting',
  supported_products: 'regulated',
  app_version: '888.888.888',
  user_tracking_platform: 'turbo_lite_desktop',
}

function grpcFrame(payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(5 + payload.length)
  new DataView(body.buffer).setUint32(1, payload.length, false)
  body.set(payload, 5)
  return body
}

function competitionRequestBody(competitionId: string): Uint8Array {
  const id = new TextEncoder().encode(competitionId)
  return grpcFrame(Uint8Array.from([10, id.length, ...id]))
}

function eventTabRequestBody(eventId: string): Uint8Array {
  const encoder = new TextEncoder()
  const tab = encoder.encode(`${eventId}::7`)
  const id = encoder.encode(eventId)
  const nested = Uint8Array.from([
    10, tab.length, ...tab,
    26, 1, 55, // tab/category "7" = jogadores
  ])
  return grpcFrame(Uint8Array.from([
    10, nested.length, ...nested,
    34, id.length, ...id,
  ]))
}

async function fetchPitacoGrpc(
  path: string,
  body: Uint8Array,
): Promise<Uint8Array | null> {
  try {
    // Copia para ArrayBuffer puro: o tipo genérico de Uint8Array também aceita
    // SharedArrayBuffer, que não faz parte de BodyInit nas tipagens do Next.
    const requestBody = Uint8Array.from(body).buffer
    const response = await fetch(`${PITACO_BASE}/api/${path}`, {
      method: 'POST',
      headers: PITACO_GRPC_HEADERS,
      body: requestBody,
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      logger.warn(`[Pitaco] API direta HTTP ${response.status}: ${path}`)
      return null
    }
    const data = new Uint8Array(await response.arrayBuffer())
    return data.length >= 100 ? data : null
  } catch (error) {
    logger.warn(`[Pitaco] API direta falhou: ${path}`, { error: String(error) })
    return null
  }
}

// Set para logar mercados desconhecidos apenas uma vez por sessão
const loggedUnknownMarkets = new Set<string>();

// Uma rodada cheia + os próximos jogos. Pode ser ajustado no ambiente.
const MAX_GAMES_PER_COMP = Math.max(
  1,
  parseInt(process.env.PITACO_MAX_GAMES ?? '24', 10),
);

const textDecoder = new TextDecoder('utf-8', { fatal: false })

/**
 * Extrai IDs de evento da resposta de GetUiCompetitionTabContent.
 * Os IDs aparecem como strings protobuf de 11 dígitos. IDs de times e
 * campeonatos são varints nessa resposta; as strings numéricas encontradas
 * aqui são justamente os eventos apresentados na aba "Partidas".
 */
export function extractCompetitionEventIds(buf: Uint8Array): string[] {
  const ids = new Set<string>()

  const walk = (node: Node | undefined, depth: number) => {
    if (!node || depth > 14) return
    for (const fields of node.values()) {
      for (const field of fields) {
        if (field.k !== 'L') continue
        const raw = field.v as Uint8Array
        const value = textDecoder.decode(raw)
        if (/^\d{11}$/.test(value)) ids.add(value)

        // decode() é tolerante a payloads que não são submensagens.
        // Só continua quando encontrou ao menos um campo válido.
        const child = decode(raw)
        if (child.size > 0) walk(child, depth + 1)
      }
    }
  }

  walk(decode(ungrpc(buf)), 0)
  return [...ids]
}

// Parse protobuf
export function parseMarkets(root: Node): Map<string, Array<{ player: string; team: string; line: string; outcomeId: string }>> {
  const markets = new Map<string, Array<{ player: string; team: string; line: string; outcomeId: string }>>()
  for (const M of subAll(root, 1)) {
    const W = sub(M, 1)
    const marketName = strPath(W, [1, 1])
    if (!marketName) continue;
    const normName = normMarketName(marketName);
    const mappedMarket = resolvePitacoMarket(marketName) ?? NORM_MARKET_MAP.get(normName);
    if (!mappedMarket) {
      // Loga mercados não reconhecidos para debug (apenas primeira vez)
      if (!loggedUnknownMarkets.has(normName)) {
        loggedUnknownMarkets.add(normName);
        logger.info(`[Pitaco] Mercado não mapeado no gRPC: "${marketName}" (norm: "${normName}")`);
      }
      continue;
    }
    const f14 = sub(sub(sub(W, 2), 1), 14)
    const result: Array<{ player: string; team: string; line: string; outcomeId: string }> = []
    for (const P of subAll(f14, 1)) {
      const header = sub(P, 1)
      const player = strPath(header, [1, 1]) || '?'
      const team = strPath(header, [2, 1]) || ''
      for (const ln of subAll(P, 2)) {
        const label = strPath(ln, [1, 1])
        const outcomeId = strPath(ln, [2, 1])
        if (outcomeId && label && /^7\d{14,}$/.test(outcomeId)) {
          result.push({ player, team, line: label, outcomeId })
        }
      }
    }
    if (result.length) markets.set(marketName, result)
  }
  return markets
}

export function parseOdds(root: Node): Map<string, number> {
  const odds = new Map<string, number>()
  for (const entry of subAll(root, 2)) {
    const inner = sub(entry, 2)
    // outcome_id em inner.2.1.1, display em inner.2.1.2.4, raw em inner.2.1.2.2
    const outcomeId = strPath(inner, [1, 1])
    const rawStr = strPath(inner, [1, 2, 4])
    const rawNum = strPath(inner, [1, 2, 2])
    if (!outcomeId || !/^7\d{14,}$/.test(outcomeId)) continue
    let value = 0
    if (rawStr) { const m = rawStr.match(/([\d.]+)x/); if (m) value = parseFloat(m[1]) }
    if (value === 0 && rawNum) value = parseInt(rawNum, 10) / 1_000_000
    if (value > 0) odds.set(outcomeId, value)
  }
  return odds
}

export function extractTeams(root: Node): string[] {
  const teams = new Set<string>()
  for (const M of subAll(root, 1)) {
    const W = sub(M, 1)
    const f14 = sub(sub(sub(W, 2), 1), 14)
    for (const P of subAll(f14, 1)) {
      const t = strPath(sub(P, 1), [2, 1])
      if (t) teams.add(t)
    }
  }
  return [...teams]
}

// API pública
export async function scrapePitaco(context: BrowserContext, competitionKeys?: string[]): Promise<ScrapedMatch[]> {
  const results: ScrapedMatch[] = []

  const compsToScrape: string[] = competitionKeys?.length
    ? competitionKeys.filter((k: string) => COMPETITION_IDS[k])
    : Object.keys(COMPETITION_IDS);

  try {
    for (const compKey of compsToScrape) {
      const compId = COMPETITION_IDS[compKey];
      logger.info(`[Pitaco] Buscando jogos da competição: ${compKey} (ID: ${compId})`);

      const compUrl = `${PITACO_BASE}/betting/competitions/${compId}?tab=matches`
      // Coleta event IDs de hrefs E da resposta protobuf oficial.
      const networkIds = new Set<string>()
      const directCompetition = await fetchPitacoGrpc(
        `${COMP_SERVICE}/GetUiCompetitionPage`,
        competitionRequestBody(compId),
      )
      if (directCompetition) {
        for (const id of extractCompetitionEventIds(directCompetition)) {
          networkIds.add(id)
        }
      }

      let hrefs: string[] = []
      if (networkIds.size === 0) {
        const compPage = await context.newPage()
        compPage.on('response', async (resp) => {
          try {
            const u = resp.url()
            if (!/competition|event|match|betting/i.test(u)) return
            if (
              u.includes('GetUiCompetitionTabContent') ||
              u.includes('GetUiCompetitionPage')
            ) {
              const body = new Uint8Array(await resp.body())
              for (const id of extractCompetitionEventIds(body)) networkIds.add(id)
              return
            }
            const txt = await resp.text().catch(() => '')
            for (const m of txt.matchAll(/\/betting\/events\/(\d{8,})/g)) {
              networkIds.add(m[1])
            }
            for (const m of txt.matchAll(/"eventId"\s*:\s*"?(\d{8,})"?/g)) {
              networkIds.add(m[1])
            }
            for (const m of txt.matchAll(/"id"\s*:\s*"?(13\d{8,})"?/g)) {
              networkIds.add(m[1])
            }
          } catch { /* */ }
        })
        await compPage.goto(compUrl, { waitUntil: 'domcontentloaded', timeout: 45000 })
        try {
          await compPage.waitForSelector('a[href*="/betting/events/"]', { timeout: 15000 })
        } catch { /* tenta mesmo assim após waits extras */ }
        await compPage.waitForTimeout(3000)
        for (let s = 0; s < 6; s++) {
          await compPage.evaluate(() => window.scrollBy(0, 700))
          await compPage.waitForTimeout(350)
        }

        hrefs = await compPage.evaluate(() =>
          [...new Set(Array.from(document.querySelectorAll('a[href*="/betting/events/"]'))
            .map(a => (a as HTMLAnchorElement).href))]
        )
        if (hrefs.length === 0) {
          hrefs = await compPage.evaluate(() =>
            [...new Set(
              Array.from(document.querySelectorAll('a[href]'))
                .map(a => (a as HTMLAnchorElement).href)
                .filter(h => /\/betting\/events\/\d+/.test(h)),
            )]
          )
        }
        if (hrefs.length === 0) {
          const html = await compPage.content()
          for (const m of html.matchAll(/\/betting\/events\/(\d{8,})/g)) {
            hrefs.push(`${PITACO_BASE}/betting/events/${m[1]}`)
          }
        }
        await compPage.close().catch(() => null)
      }

      const rawIds = [
        ...hrefs.map(h => h.match(/\/events\/(\d+)/)?.[1]).filter(Boolean) as string[],
        ...networkIds,
      ]
      const eventIds = rawIds
        .filter(id => id !== compId)
        .filter(id => /^133\d{8}$/.test(id))
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .slice(0, MAX_GAMES_PER_COMP)

      if (eventIds.length === 0) {
        logger.warn(`[Pitaco] ${compKey}: Nenhum jogo encontrado (hrefs: ${hrefs.length}, networkIds: ${networkIds.size})`)
        continue
      }
      logger.info(`[Pitaco] ${compKey}: ${eventIds.length} jogos para coletar.`);

      // Processa jogos em paralelo com limite de concorrência
      const CONCURRENCY = 3;
      for (let i = 0; i < eventIds.length; i += CONCURRENCY) {
        const batch = eventIds.slice(i, i + CONCURRENCY);
        const batchResults = await Promise.allSettled(
          batch.map(async (eventId) => {
            try {
              const tabUrl = `${PITACO_BASE}/betting/events/${eventId}?tab=${eventId}::7`
              let grpcBody = await fetchPitacoGrpc(
                'ui_betting_events_components.UiBettingEventService/GetUiEventTabContent',
                eventTabRequestBody(eventId),
              )

              if (!grpcBody) {
                const gamePage = await context.newPage()
                gamePage.on('response', async (resp) => {
                  if (resp.url().includes('GetUiEventTabContent')) {
                    try { grpcBody = new Uint8Array(await resp.body()) } catch {}
                  }
                })
                await gamePage.goto(tabUrl, { waitUntil: 'load', timeout: 20000 })
                const t0 = Date.now()
                while (!grpcBody && Date.now() - t0 < 10000) {
                  await delay(100)
                }
                await gamePage.close().catch(() => null)
              }

              if (!grpcBody || grpcBody.length < 100) {
                return null
              }

              const root = decode(ungrpc(grpcBody))
              const markets = parseMarkets(root)
              const odds = parseOdds(root)

              if (markets.size === 0 || odds.size === 0) {
                return null
              }

              const scrapedOdds: ScrapedOdd[] = []
              for (const [marketName, players] of markets) {
                const market =
                  resolvePitacoMarket(marketName) ??
                  NORM_MARKET_MAP.get(normMarketName(marketName)) ??
                  RAW_MARKET_MAP[marketName]
                if (!market) continue
                for (const p of players) {
                  const val = odds.get(p.outcomeId)
                  if (!val) continue
                  const normLine = normalizeLine(p.line)
                  if (!normLine) continue
                  scrapedOdds.push({
                    playerName: normalizePlayerNameFormat(p.player),
                    team: p.team,
                    line: normLine,
                    value: val,
                    house: 'pitaco',
                    market,
                    url: tabUrl,
                  })
                }
              }

              if (scrapedOdds.length > 0) {
                const teams = extractTeams(root)
                
                // Filtra jogos que não são clubes
                if (teams.length < 2 || !isClubTeam(teams[0]) || !isClubTeam(teams[1])) {
                  logger.warn(`[Pitaco] ${eventId}: ignorando não-clube: ${teams[0] ?? '?'} x ${teams[1] ?? '?'}`);
                  return null;
                }

                return {
                  homeTeam: teams[0] ?? 'Desconhecido',
                  awayTeam: teams[1] ?? 'Desconhecido',
                  dateTime: new Date(),
                  competition: compKey,
                  stage: extractStage('Brasileirão Série A 2026'),
                  odds: scrapedOdds,
                }
              }

              return null
            } catch (err) {
              logger.warn(`[Pitaco] Erro no jogo ${eventId}:`, { error: String(err) })
              return null
            }
          })
        )

        for (const r of batchResults) {
          if (r.status === 'fulfilled' && r.value) {
            results.push(r.value)
            logger.info(`[Pitaco] ${r.value.homeTeam} vs ${r.value.awayTeam}: ${r.value.odds.length} odds`)
          }
        }
      }
    }
  } catch (error) {
    logger.error('[Pitaco] Erro:', { error: String(error) })
  }

  logger.info(`[Pitaco] Finalizado. ${results.length} jogos.`)
  return results
}
