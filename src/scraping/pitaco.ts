/**
 * Adaptador Pitaco v2 — intercepta gRPC de cada jogo, parseia tudo de uma vez.
 * ~10s por jogo (sem WS, sem DOM parsing).
 */
import { chromium, BrowserContext, Page } from 'playwright'
import { logger } from '../lib/logger'
import { extractStage, normalizeLine, normalizePlayerNameFormat } from '../lib/normalize'
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping'
import { decode, ungrpc, sub, subAll, strPath, type Node } from './pitacoCore'

const PITACO_BASE = 'https://pitaco.bet.br'
const COMP_SERVICE = 'ui_betting_competition_components.UiBettingCompetitionService'
const GET_MATCHES_B64 = 'AAAAAB4KDAoHbWF0Y2hlcxoBMRDEFxoLMTMyMDQ4NjYzNzY='

const MARKET_MAP: Record<string, ScrapedOdd['market']> = {
  'Desarmes': 'desarmes',
  'Faltas Cometidas': 'faltas_cometidas',
  'Faltas Sofridas': 'faltas_sofridas',
}
const TARGET_MARKETS = new Set(Object.keys(MARKET_MAP))
const delay = (ms: number) => new Promise(r => setTimeout(r, ms))

// ─── Parse protobuf ──────────────────────────────────────────────

function parseMarkets(root: Node): Map<string, Array<{ player: string; team: string; line: string; outcomeId: string }>> {
  const markets = new Map<string, Array<{ player: string; team: string; line: string; outcomeId: string }>>()
  for (const M of subAll(root, 1)) {
    const W = sub(M, 1)
    const marketName = strPath(W, [1, 1])
    if (!marketName || !TARGET_MARKETS.has(marketName)) continue
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

function parseOdds(root: Node): Map<string, number> {
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

function extractTeams(root: Node): string[] {
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

// ─── API pública ─────────────────────────────────────────────────

export async function scrapePitaco(context: BrowserContext): Promise<ScrapedMatch[]> {
  const results: ScrapedMatch[] = []

  try {
    // 1) Navega ao Pitaco para pegar cookies e depois busca jogos
    const compPage = await context.newPage()
    await compPage.goto(`${PITACO_BASE}/betting/competitions/13204866376?tab=matches`, {
      waitUntil: 'domcontentloaded', timeout: 30000,
    })
    await compPage.waitForTimeout(3000)

    // Extrai event links da página
    const hrefs = await compPage.evaluate(() =>
      [...new Set(Array.from(document.querySelectorAll('a[href*="/betting/events/"]'))
        .map(a => (a as HTMLAnchorElement).href))]
    )
    await compPage.close().catch(() => null)

    const eventIds = hrefs.map(h => h.match(/\/events\/(\d+)/)?.[1]).filter(Boolean) as string[]
    if (eventIds.length === 0) {
      logger.warn('[Pitaco] Nenhum jogo encontrado')
      return []
    }
    logger.info(`[Pitaco] ${eventIds.length} jogos para coletar`)

    // 2) Para cada jogo: intercepta gRPC e parseia
    for (const eventId of eventIds) {
      try {
        const gamePage = await context.newPage()
        let grpcBody: Uint8Array | null = null

        gamePage.on('response', async (resp) => {
          if (resp.url().includes('GetUiEventTabContent')) {
            try { grpcBody = new Uint8Array(await resp.body()) } catch {}
          }
        })

        const tabUrl = `${PITACO_BASE}/betting/events/${eventId}?tab=${eventId}::7`
        await gamePage.goto(tabUrl, { waitUntil: 'load', timeout: 30000 })

        // Espera gRPC
        const t0 = Date.now()
        while (!grpcBody && Date.now() - t0 < 12000) await delay(300)
        if (!grpcBody || grpcBody.length < 100) {
          await gamePage.close().catch(() => null)
          continue
        }

        const root = decode(ungrpc(grpcBody))
        const markets = parseMarkets(root)
        const odds = parseOdds(root)

        if (markets.size === 0 || odds.size === 0) {
          await gamePage.close().catch(() => null)
          continue
        }

        const scrapedOdds: ScrapedOdd[] = []
        for (const [marketName, players] of markets) {
          const market = MARKET_MAP[marketName]
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
          results.push({
            homeTeam: teams[0] ?? 'Desconhecido',
            awayTeam: teams[1] ?? 'Desconhecido',
            dateTime: new Date(),
            stage: extractStage('Copa do Mundo 2026'),
            odds: scrapedOdds,
          })
          logger.info(`[Pitaco] ${eventId}: ${scrapedOdds.length} odds`)
        }

        await gamePage.close().catch(() => null)
        await delay(300)
      } catch (err) {
        logger.warn(`[Pitaco] Erro ${eventId}: ${err}`)
      }
    }
  } catch (error) {
    logger.error('[Pitaco] Erro:', { error: String(error) })
  }

  logger.info(`[Pitaco] Finalizado. ${results.length} jogos.`)
  return results
}
