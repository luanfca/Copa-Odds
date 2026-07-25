/**
 * Adaptador de scraping para BetMGM Brasil — via API REST direta.
 *
 * Estratégia (sem browser):
 * 1. Busca jogos de múltiplas ligas via groupIds configurados.
 * 2. Para cada lote de eventos, busca mercados de jogador em paralelo.
 * 3. Extrai odds de desarmes, faltas, finalizações e chutes.
 *
 * APIs reais descobertas via análise de tráfego:
 * - GET /events?groupIds=1820&...
 * - GET /events?ids={id1,id2}&marketTypes=player-to-make-x-plus-tackles,...
 */

import { logger } from '../lib/logger';
import { normalizePlayerNameFormat, normalizeLine, extractStage } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Group IDs por competição no BetMGM Brasil.
 *
 * NOTA: A API da BetMGM usa `player-to-have-x-plus-shots` para
 * finalização (chutes totais), NÃO `player-to-make-x-plus-shots`.
 * Ambos os tipos precisam estar no MARKET_TYPES para coletar
 * todos os mercados.
 */
const COMPETITION_GROUPS: Record<string, { groupIds: number[]; keywords: string[] }> = {
  copa: {
    groupIds: [1820],
    keywords: ['copa do mundo', 'world cup', 'fifa', 'mundial', 'world cup 2026'],
  },
  brasileirao: {
    groupIds: [1173],
    keywords: ['brasileirão', 'brasileirao', 'serie a', 'brasil', 'série a'],
  },
  mls: {
    groupIds: [820],
    keywords: ['mls', 'major league soccer', 'eua', 'usa', 'united states', 'estados unidos'],
  },
  // Premier League e La Liga não têm mercados de jogador na BetMGM Brasil
};

const BETMGM_API_BASE = 'https://br-program-api.goldrush.llc/program/v1/api';

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
  'player-to-make-x-plus-shots',
  'player-to-have-x-plus-shots',
  'player-to-have-x-plus-shots-on-target',
  'player-to-make-x-plus-shots-on-target',
].join(',');

const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping BetMGM.
 *
 * Fluxo:
 * 1. Descobre IDs dos jogos de múltiplas ligas via groupIds.
 * 2. Processa em lotes de BATCH_SIZE para não sobrecarregar a API.
 * 3. Cada lote busca mercados de jogador (desarmes, faltas, finalizações).
 *
 * @param competitionKeys - Chaves das competições para buscar (ex: ['premier_league', 'la_liga']).
 * Se vazio, busca todas as competições configuradas.
 */
export async function scrapeBetMGM(competitionKeys?: string[]): Promise<ScrapedMatch[]> {
  logger.info('[BetMGM] Iniciando scraping direto via API...');
  const results: ScrapedMatch[] = [];

  try {
    // Determina quais competições buscar
    const compsToScrape = competitionKeys?.length
      ? competitionKeys.filter(k => COMPETITION_GROUPS[k])
      : Object.keys(COMPETITION_GROUPS);

    for (const compKey of compsToScrape) {
      const comp = COMPETITION_GROUPS[compKey];
      logger.info(`[BetMGM] Buscando eventos da competição: ${compKey}`);

      let eventIds = await fetchEventIdsForCompetition(comp.groupIds, comp.keywords, compKey);
      logger.info(`[BetMGM] ${compKey}: ${eventIds.length} jogos encontrados.`);

      if (eventIds.length === 0) {
        logger.warn(`[BetMGM] ${compKey}: Nenhum jogo encontrado via groupId.`);
        continue;
      }

      for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
        const batch = eventIds.slice(i, i + BATCH_SIZE);
        const batchMatches = await fetchPlayerMarketsForEvents(batch, compKey);
        results.push(...batchMatches);

        const hasMore = i + BATCH_SIZE < eventIds.length;
        if (hasMore) await delay(BATCH_DELAY_MS);
      }
    }

  } catch (error) {
    logger.error('[BetMGM] Erro durante scraping:', { error: String(error) });
  }

  logger.info(`[BetMGM] Scraping finalizado. ${results.length} jogos com odds.`);
  return results;
}

// ─── Funções internas ─────────────────────────────────────────────────────────

/** Descobre IDs dos jogos buscando nos grupos configurados para uma competição. */
async function fetchEventIdsForCompetition(
  groupIds: number[],
  keywords: string[],
  competitionKey: string,
): Promise<number[]> {
  const eventIds: number[] = [];

  for (const groupId of groupIds) {
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
        const matchesCompetition =
          keywords.some(kw => leagueName.includes(kw)) ||
          groupIds.includes(groupId);

        if (matchesCompetition && !eventIds.includes(ev.id)) {
          eventIds.push(ev.id);
        }
      }

      logger.info(`[BetMGM] Grupo ${groupId} (${competitionKey}): ${events.length} eventos, ${eventIds.length} filtrados.`);
    } catch (err) {
      logger.warn(`[BetMGM] Erro ao buscar grupo ${groupId}:`, { error: String(err) });
    }
  }

  return eventIds;
}

/** Busca mercados de jogador (desarmes, faltas, finalizações) para um lote de IDs de eventos. */
async function fetchPlayerMarketsForEvents(eventIds: number[], competitionKey: string): Promise<ScrapedMatch[]> {
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
      .map(ev => extractMatchFromEvent(ev, competitionKey))
      .filter((m): m is ScrapedMatch => m !== null);

  } catch (err) {
    logger.warn(`[BetMGM] Erro ao buscar eventos ${eventIds.join(',')}:`, { error: String(err) });
    return [];
  }
}

/** Resolve o marketKey a partir do tipo e nome do mercado. */
function resolveMarketKey(mType: string, mName: string): string {
  const lower = mName.toLowerCase();
  // Desarmes / tackles (tinha sumido: type existia no request mas nunca mapeava)
  if (
    mType === 'player-to-make-x-plus-tackles' ||
    mType === 'player-to-have-x-plus-tackles' ||
    lower.includes('desarme') ||
    lower.includes('tackle') ||
    lower.includes('abordagem')
  ) {
    return 'desarmes';
  }

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

  if (
    mType === 'player-to-have-x-plus-shots-on-target' ||
    mType === 'player-to-make-x-plus-shots-on-target' ||
    lower.includes('chute no gol') ||
    lower.includes('chute ao gol') ||
    lower.includes('chutes no gol') ||
    lower.includes('shots on target')
  ) return 'chutes_ao_gol';

  if (
    mType === 'player-to-make-x-plus-shots' ||
    mType === 'player-to-have-x-plus-shots' ||
    lower.includes('finalização') ||
    lower.includes('finalizac') ||
    (lower.includes('chutes') && !lower.includes('gol')) ||
    (lower.includes('shots') && !lower.includes('target'))
  ) return 'finalizacao';

  return '';
}

/** Resolve o time de um jogador cruzando com a lista de participantes.
 *  Sem match → string vazia (NÃO assume casa: isso marcava visitante como home). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolvePlayerTeam(playerName: string, participants: any[], _homeTeam: string): string {
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
    if (found) return String(participant.name ?? '').trim();
  }
  return '';
}

/** Extrai os dados de um evento da API e retorna um ScrapedMatch ou null. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractMatchFromEvent(ev: any, competitionKey: string): ScrapedMatch | null {
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
    m.type === 'player-to-make-x-plus-shots' ||
    m.type === 'player-to-have-x-plus-shots' ||
    m.type === 'player-to-have-x-plus-shots-on-target' ||
    m.type === 'player-to-make-x-plus-shots-on-target' ||
    (m.name ?? '').toLowerCase().includes('desarme') ||
    (m.name ?? '').toLowerCase().includes('falta') ||
    (m.name ?? '').toLowerCase().includes('finalização') ||
    (m.name ?? '').toLowerCase().includes('chute') ||
    (m.name ?? '').toLowerCase().includes('shot'),
  );

  if (playerMarkets.length === 0) return null;

  const odds: ScrapedOdd[] = [];
  const eventUrl = `https://www.betmgm.bet.br/sports/event/${ev.id}`;

  for (const market of playerMarkets) {
    const mType: string = market.type ?? '';
    const mName: string = market.name ?? '';
    const marketKey = resolveMarketKey(mType, mName);
    if (!marketKey) continue;
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
        competition: competitionKey,
      });
    }
  }

  if (odds.length === 0) return null;

  return {
    homeTeam,
    awayTeam,
    dateTime: new Date(ev.startTime ?? Date.now()),
    stage: extractStage(ev.leagueName ?? ev.group?.name ?? ''),
    competition: competitionKey,
    odds,
  };
}
