/**
 * Adaptador de scraping para BetMGM Brasil — via API REST direta.
 *
 * Estratégia (sem browser):
 * 1. Busca jogos da Copa do Mundo via groupId 1820 (Copa do Mundo FIFA 2026).
 * 2. Para cada lote de eventos, busca mercados de jogador em paralelo.
 * 3. Extrai odds de desarmes, faltas cometidas e faltas sofridas.
 *
 * APIs reais descobertas via análise de tráfego:
 * - GET /events?groupIds=1820&...
 * - GET /events?ids={id1,id2}&marketTypes=player-to-make-x-plus-tackles,...
 *
 * MUDANÇAS vs versão anterior:
 * - REMOVIDO: `import { BrowserContext } from 'playwright'` (não era usado)
 * - REMOVIDO: interfaces ScrapedOdd/ScrapedMatch locais → usa src/types/scraping.ts
 * - REMOVIDO: extractStage() local duplicada → usa normalize.ts
 * - MANTIDO: batching de 5 eventos por request (rate limiting da API)
 */

import { logger } from '../lib/logger';
import { normalizePlayerNameFormat, normalizeLine, extractStage } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Group ID da Copa do Mundo FIFA 2026 no BetMGM Brasil. */
const COPA_GROUP_IDS = [1820] as const;

const BETMGM_API_BASE = 'https://br-program-api.goldrush.llc/program/v1/api';

const COPA_KEYWORDS = [
  'copa do mundo', 'world cup', 'fifa', 'mundial', 'world cup 2026',
] as const;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://www.betmgm.bet.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Origin': 'https://www.betmgm.bet.br',
};

const MARKET_TYPES = [
  'player-to-make-x-plus-tackles',
  'player-to-commit-x-plus-fouls',
  'player-to-win-x-plus-fouls',
].join(',');

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping BetMGM.
 *
 * Fluxo:
 * 1. Descobre IDs dos jogos da Copa do Mundo via groupId.
 * 2. Processa em lotes de BATCH_SIZE para não sobrecarregar a API.
 * 3. Cada lote busca mercados de jogador (desarmes + faltas) em uma única request.
 */
export async function scrapeBetMGM(): Promise<ScrapedMatch[]> {
  logger.info('[BetMGM] Iniciando scraping direto via API...');
  const results: ScrapedMatch[] = [];

  try {
    let eventIds = await fetchCopaEventIds();
    logger.info(`[BetMGM] ${eventIds.length} jogos da Copa encontrados.`);

    if (eventIds.length === 0) {
      logger.warn('[BetMGM] Nenhum jogo encontrado via groupId. Usando IDs de fallback...');
      // IDs de fallback para quando a API de grupos não retornar nada.
      // Mantidos apenas como última linha de defesa — a API de grupos é a fonte primária.
      eventIds = [1078314, 585046, 1481340, 1486313, 1487326, 1489531, 1481746, 1486716, 1486742, 1473537];
    }

    for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
      const batch = eventIds.slice(i, i + BATCH_SIZE);
      const batchMatches = await fetchPlayerMarketsForEvents(batch);
      results.push(...batchMatches);

      const hasMore = i + BATCH_SIZE < eventIds.length;
      if (hasMore) await delay(BATCH_DELAY_MS);
    }

  } catch (error) {
    logger.error('[BetMGM] Erro durante scraping:', { error: String(error) });
  }

  logger.info(`[BetMGM] Scraping finalizado. ${results.length} jogos com odds.`);
  return results;
}

// ─── Funções internas ─────────────────────────────────────────────────────────

/** Descobre IDs dos jogos da Copa do Mundo buscando nos grupos configurados. */
async function fetchCopaEventIds(): Promise<number[]> {
  const eventIds: number[] = [];

  for (const groupId of COPA_GROUP_IDS) {
    try {
      const url = new URL(`${BETMGM_API_BASE}/events`);
      url.searchParams.set('groupIds', String(groupId));
      url.searchParams.set('matchState', 'PREMATCH,ONGOING');
      url.searchParams.set('startTimeOffsetFrom', '-86400000');
      url.searchParams.set('lang', 'pt');
      url.searchParams.set('brand', 'betmgm');
      url.searchParams.set('location', 'BR');
      url.searchParams.set('fields', 'GROUPS,BETMARKETS');
      url.searchParams.set('limit', '50');

      const res = await fetch(url.toString(), { headers: BASE_HEADERS });
      if (!res.ok) {
        logger.warn(`[BetMGM] Grupo ${groupId} retornou status ${res.status}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = await res.json() as { data?: any[] };
      const events = data?.data ?? [];

      for (const ev of events) {
        if (!ev?.id || typeof ev.id !== 'number') continue;

        const leagueName: string = (ev.leagueName ?? ev.group?.name ?? '').toLowerCase();
        const isWorldCup =
          COPA_KEYWORDS.some(kw => leagueName.includes(kw)) ||
          COPA_GROUP_IDS.includes(groupId);

        if (isWorldCup && !eventIds.includes(ev.id)) {
          eventIds.push(ev.id);
        }
      }

      logger.info(`[BetMGM] Grupo ${groupId}: ${events.length} eventos, ${eventIds.length} da Copa.`);
    } catch (err) {
      logger.warn(`[BetMGM] Erro ao buscar grupo ${groupId}:`, { error: String(err) });
    }
  }

  return eventIds;
}

/** Busca mercados de jogador (desarmes e faltas) para um lote de IDs de eventos. */
async function fetchPlayerMarketsForEvents(eventIds: number[]): Promise<ScrapedMatch[]> {
  if (eventIds.length === 0) return [];

  const url = new URL(`${BETMGM_API_BASE}/events`);
  url.searchParams.set('ids', eventIds.join(','));
  url.searchParams.set('lang', 'pt');
  url.searchParams.set('brand', 'betmgm');
  url.searchParams.set('location', 'BR');
  url.searchParams.set('fields', 'GROUPS,BETMARKETS,STATISTICS');
  url.searchParams.set('marketTypes', MARKET_TYPES);

  try {
    const res = await fetch(url.toString(), { headers: BASE_HEADERS });
    if (!res.ok) {
      logger.warn(`[BetMGM] Eventos ${eventIds.join(',')} retornou status ${res.status}`);
      return [];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as { data?: any[] };
    const events = data?.data ?? [];

    return events
      .map(extractMatchFromEvent)
      .filter((m): m is ScrapedMatch => m !== null);

  } catch (err) {
    logger.warn(`[BetMGM] Erro ao buscar eventos ${eventIds.join(',')}:`, { error: String(err) });
    return [];
  }
}

/** Resolve o marketKey a partir do tipo e nome do mercado. */
function resolveMarketKey(mType: string, mName: string): string {
  const lower = mName.toLowerCase();
  if (
    mType === 'player-to-commit-x-plus-fouls' ||
    lower.includes('faltas cometidas') ||
    lower.includes('cometer faltas')
  ) return 'faltas_cometidas';

  if (
    mType === 'player-to-win-x-plus-fouls' ||
    lower.includes('faltas sofridas') ||
    lower.includes('sofrer faltas') ||
    lower.includes('faltas ganhas')
  ) return 'faltas_sofridas';

  return 'desarmes';
}

/** Resolve o time de um jogador cruzando com a lista de participantes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePlayerTeam(playerName: string, participants: any[], homeTeam: string): string {
  for (const participant of participants) {
    if (!Array.isArray(participant.players)) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = participant.players.some((pl: any) => {
      const plNorm = normalizePlayerNameFormat(pl.name ?? '');
      return (
        plNorm.toLowerCase() === playerName.toLowerCase() ||
        (pl.name?.toLowerCase() ?? '') === playerName.toLowerCase()
      );
    });
    if (found) return participant.name ?? homeTeam;
  }
  return homeTeam;
}

/** Extrai os dados de um evento da API e retorna um ScrapedMatch ou null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMatchFromEvent(ev: any): ScrapedMatch | null {
  if (!ev || typeof ev !== 'object') return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const homeParticipant: any = ev.participants?.find((p: any) => p.position === 'HOME') ?? ev.participants?.[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const awayParticipant: any = ev.participants?.find((p: any) => p.position === 'AWAY') ?? ev.participants?.[1];

  const homeTeam: string = homeParticipant?.name ?? '';
  const awayTeam: string = awayParticipant?.name ?? '';
  if (!homeTeam || !awayTeam) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const playerMarkets: any[] = (ev.markets ?? []).filter((m: any) =>
    m.type === 'player-to-make-x-plus-tackles' ||
    m.type === 'player-to-commit-x-plus-fouls' ||
    m.type === 'player-to-win-x-plus-fouls' ||
    (m.name ?? '').toLowerCase().includes('desarme') ||
    (m.name ?? '').toLowerCase().includes('falta'),
  );

  if (playerMarkets.length === 0) return null;

  const odds: ScrapedOdd[] = [];
  const eventUrl = `https://www.betmgm.bet.br/sports/event/${ev.id}`;

  for (const market of playerMarkets) {
    const mType: string = market.type ?? '';
    const mName: string = market.name ?? '';
    const marketKey = resolveMarketKey(mType, mName);
    const line = normalizeLine(mName);

    for (const outcome of (market.outcomes ?? [])) {
      const playerName = normalizePlayerNameFormat(
        outcome.name ?? outcome.freeTextOutcomeName ?? '',
      );
      const price = Number(outcome.formatDecimal ?? outcome.odds ?? 0);

      if (!playerName || price <= 1) continue;

      odds.push({
        playerName,
        team: resolvePlayerTeam(playerName, ev.participants ?? [], homeTeam),
        line,
        value: price,
        house: 'betmgm',
        market: marketKey,
        url: eventUrl,
      });
    }
  }

  if (odds.length === 0) return null;

  return {
    homeTeam,
    awayTeam,
    dateTime: new Date(ev.startTime ?? Date.now()),
    stage: extractStage(ev.leagueName ?? ev.group?.name ?? ''),
    odds,
  };
}
