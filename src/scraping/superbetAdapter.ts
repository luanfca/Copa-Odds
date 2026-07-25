/**
 * Adaptador de scraping para Superbet Brasil — via API REST direta.
 *
 * Estratégia (sem browser):
 * 1. Busca jogos de múltiplas competições via CDN da Superbet.
 * 2. Para cada jogo, busca mercados via BetBuilder API.
 * 3. Filtra mercados de desarmes, faltas, finalizações e chutes.
 *
 * APIs descobertas via análise de tráfego real:
 * - CDN:        https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date
 * - BetBuilder: https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2/getBetbuilderMarketsForMatch
 */

import { logger } from '../lib/logger';
import { normalizePlayerNameFormat, normalizeLine } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';

// ─── Configuração ─────────────────────────────────────────────────────────────

/**
 * Tournament IDs na Superbet Brasil (API CDN).
 * Descobertos via interceptação da página:
 * - brasileirao (Série A) => tournamentId 1698
 * - mls                    => categoryId 241 (MLS), filtrada por tournamentId 897 (1ª divisão)
 * - copa                    => categoryId 102 (Copa do Mundo)
 * A API `/events/by-date` aceita `tournamentIds` (Série A) ou `categoryId`
 * (Copa, MLS). A MLS é uma categoria (241) cujo torneio de 1ª divisão é 897;
 * os demais (58341, 3743, 37036, 40768) são MLS Next/USL/feminino e são ignorados.
 */
const COMPETITION_TOURNAMENTS: Record<string, { tournamentId?: number; categoryId?: number; filterTournamentId?: number; name: string }> = {
  copa: { categoryId: 102, name: 'Copa do Mundo' },
  brasileirao: { tournamentId: 1698, name: 'Brasileirão Série A' },
  mls: { categoryId: 241, filterTournamentId: 897, name: 'Major League Soccer' },
  // Premier League e La Liga precisam de season ativa para ter dados
};

const SPORT_ID_FUTEBOL = 5;

const CDN_BASE = 'https://production-superbet-offer-br.freetls.fastly.net';
const BMB_BASE = 'https://production-superbet-bmb.freetls.fastly.net';

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://superbet.bet.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
};

const MATCH_PLAYER_DELAY_MS = 300;

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface TournamentMatch {
  id: number;
  homeTeam: string;
  awayTeam: string;
  dateTime: Date;
  tournamentId: number;
  competition?: string;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping Superbet.
 *
 * @param competitionKeys - Chaves das competições para buscar.
 * Se vazio, busca todas as competições configuradas.
 */
export async function scrapeSuperbet(competitionKeys?: string[]): Promise<ScrapedMatch[]> {
  logger.info('[Superbet] Iniciando scraping via API CDN...');
  const results: ScrapedMatch[] = [];

  try {
    // Determina quais competições buscar
    const compsToScrape = competitionKeys?.length
      ? competitionKeys.filter(k => COMPETITION_TOURNAMENTS[k])
      : Object.keys(COMPETITION_TOURNAMENTS);

    for (const compKey of compsToScrape) {
      const comp = COMPETITION_TOURNAMENTS[compKey];
      const idLabel = comp.tournamentId ? `tournamentId: ${comp.tournamentId}` : `categoryId: ${comp.categoryId}`;
      logger.info(`[Superbet] Buscando jogos da competição: ${compKey} (${idLabel})`);

      const matchIds = await fetchMatchIdsForCategory(comp, compKey);
      logger.info(`[Superbet] ${compKey}: ${matchIds.length} jogos encontrados.`);

      if (matchIds.length === 0) {
        logger.warn(`[Superbet] ${compKey}: Nenhum jogo encontrado.`);
        continue;
      }

      for (const match of matchIds) {
        try {
          const matchData = await fetchMatchPlayerMarkets(match, compKey);
          if (matchData) {
            results.push(matchData);
            logger.info(
              `[Superbet] ${compKey}: ${match.homeTeam} vs ${match.awayTeam}: ${matchData.odds.length} odds.`,
            );
          }
        } catch (err) {
          logger.warn(`[Superbet] Erro ao processar jogo ${match.id}:`, { error: String(err) });
        }
      }
    }

  } catch (error) {
    logger.error('[Superbet] Erro durante scraping:', { error: String(error) });
  }

  logger.info(`[Superbet] Scraping finalizado. ${results.length} jogos com odds.`);
  return results;
}

// ─── Funções internas ─────────────────────────────────────────────────────────

/**
 * Busca jogos de uma competição específica via API CDN.
 * Usa `tournamentIds` quando a competição tem um (Série A, MLS) ou
 * `categoryId` (Copa). A janela de datas é ampla (hoje-1 até hoje+10)
 * para capturar toda a rodada, não apenas os jogos das próximas 24h.
 */
async function fetchMatchIdsForCategory(
  comp: { tournamentId?: number; categoryId?: number; filterTournamentId?: number },
  competitionKey: string,
): Promise<TournamentMatch[]> {
  const start = new Date();
  start.setDate(start.getDate() - 1);
  const end = new Date();
  end.setDate(end.getDate() + 10);
  const startStr = start.toISOString().replace('T', ' ').slice(0, 19);
  const endStr = end.toISOString().replace('T', ' ').slice(0, 19);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let events: any[] = [];
  try {
    const url = new URL(`${CDN_BASE}/v2/pt-BR/events/by-date`);
    url.searchParams.set('currentStatus', 'active');
    url.searchParams.set('offerState', 'prematch');
    url.searchParams.set('sportId', String(SPORT_ID_FUTEBOL));
    url.searchParams.set('startDate', startStr);
    url.searchParams.set('endDate', endStr);
    if (comp.tournamentId) {
      url.searchParams.set('tournamentIds', String(comp.tournamentId));
    } else if (comp.categoryId) {
      url.searchParams.set('categoryId', String(comp.categoryId));
    }

    const res = await fetch(url.toString(), { headers: BASE_HEADERS });
    const idLabel = comp.tournamentId ? `tournament ${comp.tournamentId}` : `categoria ${comp.categoryId}`;
    if (!res.ok) {
      logger.warn(`[Superbet] events by-date (${idLabel}) retornou status ${res.status}`);
      return [];
    }

    const data = await res.json() as { data?: any; events?: any[] };
    events = Array.isArray(data?.data)
      ? data.data
      : (data?.data?.events ?? data?.events ?? []);
  } catch (err) {
    logger.warn(`[Superbet] Erro ao buscar competição ${competitionKey}:`, { error: String(err) });
    return [];
  }

  const allMatches: TournamentMatch[] = [];
  const seenIds = new Set<number>();

  for (const ev of events) {
    const eventId = ev?.eventId ?? ev?.offerId ?? ev?.uuid;
    if (!eventId) continue;

    const numId = Number(eventId);
    if (Number.isNaN(numId)) continue;
    if (seenIds.has(numId)) continue;
    seenIds.add(numId);

    const name: string = ev.matchName ?? ev.eventName ?? '';
    const parts = name.split(/\s*[·x]\s*/i);
    const homeTeam = parts[0]?.trim() ?? '';
    const awayTeam = parts[1]?.trim() ?? '';

    if (!homeTeam || !awayTeam) continue;

    const evTournamentId = Number(ev.tournamentId ?? 0);
    if (comp.filterTournamentId && evTournamentId !== comp.filterTournamentId) continue;

    allMatches.push({
      id: numId,
      homeTeam,
      awayTeam,
      dateTime: new Date(ev.matchDate ?? ev.startDate ?? ev.utcDate ?? Date.now()),
      tournamentId: Number(ev.tournamentId ?? 0),
      competition: competitionKey,
    });
  }

  logger.info(`[Superbet] ${competitionKey}: ${allMatches.length} jogos encontrados.`);
  return allMatches;
}

/**
 * Busca mercados de jogador (desarmes, faltas, finalizações) para um jogo via BetBuilder API.
 * Retorna null se não houver mercados relevantes.
 */
async function fetchMatchPlayerMarkets(match: TournamentMatch, competitionKey: string): Promise<ScrapedMatch | null> {
  const url = new URL(`${BMB_BASE}/betbuilder/v2/getBetbuilderMarketsForMatch`);
  url.searchParams.set('match_id', String(match.id));
  url.searchParams.set('lang', 'pt-BR');
  url.searchParams.set('target', 'SB_BR');

  const res = await fetch(url.toString(), { headers: BASE_HEADERS });
  if (!res.ok) {
    logger.warn(`[Superbet] BetBuilder status ${res.status} para match ${match.id}`);
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { markets?: any[] };
  const allMarkets = data?.markets ?? [];
  if (allMarkets.length === 0) {
    logger.warn(
      `[Superbet] ${match.homeTeam} vs ${match.awayTeam} [id ${match.id}]: BetBuilder retornou 0 mercados.`,
    );
    return null;
  }

  const odds: ScrapedOdd[] = [];
  const eventUrl = `https://superbet.bet.br/sport/futebol/evento/${match.id}`;

  for (const market of allMarkets) {
    const marketKey = resolveSuperbetMarketKey(market.name ?? '');
    if (!marketKey) continue;

    for (const outcome of (market.odds ?? [])) {
      const spec: Record<string, string> = outcome.specifiers ?? {};

      let playerName: string = spec.player_name ?? outcome.name ?? '';
      if (!playerName) continue;

      if (playerName.includes(' - ')) {
        playerName = playerName.split(' - ')[0].trim();
      }
      playerName = normalizePlayerNameFormat(playerName);

      const price = Number(outcome.price ?? outcome.odd ?? 0);
      if (price <= 1) continue;

      const line = resolveSuperbetLine(spec.total ?? null, outcome.name ?? '');

      odds.push({
        playerName,
        team: '',
        line,
        value: price,
        house: 'superbet',
        market: marketKey,
        url: eventUrl,
        competition: competitionKey,
      });
    }
  }

  if (odds.length === 0) {
    logger.warn(
      `[Superbet] ${match.homeTeam} vs ${match.awayTeam} [id ${match.id}]: ${allMarkets.length} mercados, 0 relevantes.`,
    );
    // Retorna match "somente data" para que o merge preencha a dateTime real
    // (a Superbet traz a data do jogo mesmo sem odds de jogador). Isso evita
    // que outra fonte (ex: Pitaco) marque o jogo com a hora do scrape.
    return {
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      dateTime: match.dateTime,
      stage: COMPETITION_TOURNAMENTS[competitionKey]?.name ?? competitionKey,
      competition: competitionKey,
      odds: [],
      dateOnly: true,
    };
  }

  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    dateTime: match.dateTime,
    stage: COMPETITION_TOURNAMENTS[competitionKey]?.name ?? competitionKey,
    competition: competitionKey,
    odds,
  };
}

/** Nomes de sub-mercados que NÃO devem ser mapeados como finalizacao ou chutes_ao_gol. */
const SUB_MARKET_KEYWORDS = ['pé esquerdo', 'pe esquerdo', 'pé direito', 'pe direito', 'cabeceio', 'fora da área', 'fora da area', 'cabeça', 'cabeca'];

function isSubMarket(name: string): boolean {
  const lower = name.toLowerCase();
  return SUB_MARKET_KEYWORDS.some(kw => lower.includes(kw));
}

/** Resolve o marketKey a partir do nome do mercado Superbet. */
function resolveSuperbetMarketKey(marketName: string): string | null {
  const lower = marketName.toLowerCase();

  // Ignora sub-mercados (Pé Esquerdo, Pé Direito, Cabeceio, Fora da Área)
  if (isSubMarket(marketName)) return null;

  if (
    lower.includes('total de desarmes') ||
    (lower.includes('jogador') && lower.includes('desarme'))
  ) return 'desarmes';

  if (
    lower.includes('faltas cometidas') ||
    (lower.includes('jogador') && lower.includes('faltas cometidas'))
  ) return 'faltas_cometidas';

  if (
    lower.includes('faltas sofridas') ||
    (lower.includes('jogador') && lower.includes('faltas sofridas'))
  ) return 'faltas_sofridas';

  // Chutes no gol (shots on target) — mercado mais restritivo, odds mais altas
  if (
    lower.includes('chutes no gol') ||
    lower.includes('chutes ao gol') ||
    lower.includes('chute no gol') ||
    lower.includes('chute ao gol')
  ) return 'chutes_ao_gol';

  // Finalizações = total de chutes — mercado mais amplo, odds mais baixas
  // Apenas o mercado PRINCIPAL "Jogador - Finalizações" deve ser mapeado,
  // NÃO os sub-mercados (Pé Esquerdo, Pé Direito, Cabeceio, Fora da Área)
  if (
    lower === 'jogador - finalizações' ||
    lower === 'jogador - finalizacoes' ||
    lower.includes('finalizações') ||
    lower.includes('finalizacao')
  ) return 'finalizacao';

  // Fallback: mercado com 'chutes' sem ser sub-mercado e sem ser 'chutes no gol'
  if (lower.includes('chutes') && !isSubMarket(marketName)) return 'finalizacao';

  return null;
}

/**
 * Resolve a linha de apostas a partir do especificador `total` ou do nome do outcome.
 * A Superbet usa "total": "0.5" para 1+, "1.5" para 2+, etc.
 */
function resolveSuperbetLine(total: string | null, outcomeName: string): string {
  if (total !== null) {
    const t = parseFloat(total);
    if (!Number.isNaN(t)) {
      if (t <= 0.5) return '1+';
      if (t <= 1.5) return '2+';
      if (t <= 2.5) return '3+';
      if (t <= 3.5) return '4+';
      return `${Math.ceil(t)}+`;
    }
  }
  return normalizeLine(outcomeName);
}
