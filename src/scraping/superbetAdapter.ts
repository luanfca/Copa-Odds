/**
 * Adaptador de scraping para Superbet Brasil — via API REST direta.
 *
 * Estratégia (sem browser):
 * 1. Busca jogos da Copa do Mundo em múltiplos torneios via CDN da Superbet.
 *    ANTES: loop serial com delay(300) por torneio.
 *    AGORA: Promise.allSettled paralelizado — ~8x mais rápido.
 * 2. Para cada jogo, busca mercados via BetBuilder API.
 * 3. Filtra mercados de desarmes, faltas cometidas e faltas sofridas.
 *
 * APIs descobertas via análise de tráfego real:
 * - CDN:        https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date
 * - BetBuilder: https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2/getBetbuilderMarketsForMatch
 *
 * MUDANÇAS vs versão anterior:
 * - REMOVIDO: `scrapeSuperbet_browserFallback` — dead code (função nunca usada)
 * - REMOVIDO: interfaces ScrapedOdd/ScrapedMatch locais → usa src/types/scraping.ts
 * - ALTERADO: busca de torneios de serial (for loop) para paralela (Promise.allSettled)
 * - ADICIONADO: tipagem estrita ao longo do módulo (sem `any` implícito)
 */

import { logger } from '../lib/logger';
import { normalizePlayerNameFormat, normalizeLine } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';

// ─── Configuração ─────────────────────────────────────────────────────────────

/**
 * Copa do Mundo FIFA 2026 na Superbet = categoryId 102 (futebol = sportId 5).
 * Buscamos a competição INTEIRA por categoria numa única request, em vez de
 * listar IDs de torneio (grupo) na mão. Assim TODOS os grupos entram
 * automaticamente — inclusive os que ficam em IDs de torneio não-sequenciais
 * (ex.: Inglaterra/Croácia, Portugal, Argentina, França ficavam de fora
 * quando dependíamos da lista fixa 1432-1439).
 */
const COPA_CATEGORY_ID = 102;
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
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping Superbet.
 *
 * Fluxo:
 * 1. Busca todos os jogos da Copa em paralelo (8 torneios simultaneamente).
 * 2. Para cada jogo, busca mercados de jogador via BetBuilder (sequencial com delay
 *    para respeitar o rate limit da API de betbuilder).
 */
export async function scrapeSuperbet(): Promise<ScrapedMatch[]> {
  logger.info('[Superbet] Iniciando scraping direto via API...');
  const results: ScrapedMatch[] = [];

  try {
    // ── PASSO 1: Busca paralela de todos os torneios ──
    const matchIds = await fetchCopaMatchIds();
    logger.info(`[Superbet] ${matchIds.length} jogos da Copa encontrados.`);

    if (matchIds.length === 0) {
      logger.warn('[Superbet] Nenhum jogo da Copa encontrado.');
      return results;
    }

    // ── PASSO 2: Busca de mercados de jogador (sequential — rate limiting) ──
    for (const match of matchIds) {
      try {
        await delay(MATCH_PLAYER_DELAY_MS);
        const matchData = await fetchMatchPlayerMarkets(match);
        if (matchData) {
          results.push(matchData);
          logger.info(
            `[Superbet] ${match.homeTeam} vs ${match.awayTeam}: ${matchData.odds.length} odds coletadas.`,
          );
        } else {
          logger.warn(
            `[Superbet] ${match.homeTeam} vs ${match.awayTeam} [id ${match.id}]: SEM odds de desarmes/faltas (ver motivo no log acima).`,
          );
        }
      } catch (err) {
        logger.warn(
          `[Superbet] Falha ao buscar odds de ${match.homeTeam} vs ${match.awayTeam}:`,
          { error: String(err) },
        );
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
 * Busca jogos da Copa do Mundo em todos os torneios configurados.
 *
 * Paraleliza as 8 requests de torneio com Promise.allSettled para que
 * a falha de um torneio não bloqueie os demais.
 */
async function fetchCopaMatchIds(): Promise<TournamentMatch[]> {
  // Janela de busca: 1 dia atrás até o futuro (inclui jogos em andamento)
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1);
  const startStr = startDate.toISOString().replace('T', ' ').slice(0, 19);

  // ── Busca a Copa INTEIRA por categoria (1 request, pega todos os grupos) ──
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let events: any[] = [];
  try {
    events = await fetchCopaEvents(startStr);
  } catch (err) {
    logger.warn('[Superbet] Falha ao buscar eventos da Copa por categoria:', {
      error: String(err),
    });
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
    const parts = name.split(/\s+vs\s+|\s+x\s+|\s+[-–·]\s*|·/i);
    const homeTeam = parts[0]?.trim() ?? '';
    const awayTeam = parts[1]?.trim() ?? '';

    // Descarta eventos sem time visitante reconhecível
    if (!homeTeam || !awayTeam) {
      logger.warn(`[Superbet] Ignorando evento sem separador reconhecível: "${name}" [id ${numId}]`);
      continue;
    }

    allMatches.push({
      id: numId,
      homeTeam,
      awayTeam,
      dateTime: new Date(ev.matchDate ?? ev.startDate ?? ev.utcDate ?? Date.now()),
      tournamentId: Number(ev.tournamentId ?? 0),
    });
  }

  logger.info(
    `[Superbet] Jogos encontrados (${allMatches.length}): ` +
      allMatches.map(m => `${m.homeTeam} vs ${m.awayTeam} [id ${m.id}/t${m.tournamentId}]`).join('  |  '),
  );
  return allMatches;
}

/**
 * Busca TODOS os eventos da Copa do Mundo (categoryId 102 + futebol sportId 5)
 * numa única request por categoria. Assim todos os grupos entram de uma vez,
 * sem depender de uma lista fixa de IDs de torneio.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchCopaEvents(startStr: string): Promise<any[]> {
  const url = new URL(`${CDN_BASE}/v2/pt-BR/events/by-date`);
  url.searchParams.set('currentStatus', 'active');
  url.searchParams.set('sportId', String(SPORT_ID_FUTEBOL));
  url.searchParams.set('categoryId', String(COPA_CATEGORY_ID));
  url.searchParams.set('startDate', startStr);

  const res = await fetch(url.toString(), { headers: BASE_HEADERS });
  if (!res.ok) {
    logger.warn(
      `[Superbet] events by-date (categoria ${COPA_CATEGORY_ID}) retornou status ${res.status}`,
    );
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await res.json() as { data?: any; events?: any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = Array.isArray(data?.data)
    ? data.data
    : (data?.data?.events ?? data?.events ?? []);
  return events;
}

/**
 * Busca mercados de jogador (desarmes e faltas) para um jogo via BetBuilder API.
 * Retorna null se não houver mercados relevantes.
 */
async function fetchMatchPlayerMarkets(match: TournamentMatch): Promise<ScrapedMatch | null> {
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
      `[Superbet] ${match.homeTeam} vs ${match.awayTeam} [id ${match.id}]: BetBuilder retornou 0 mercados (HTTP ${res.status}).`,
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

      // Remove sufixo " - Mais de X.5" se presente
      if (playerName.includes(' - ')) {
        playerName = playerName.split(' - ')[0].trim();
      }
      playerName = normalizePlayerNameFormat(playerName);

      const price = Number(outcome.price ?? outcome.odd ?? 0);
      if (price <= 1) continue;

      const line = resolveSuperbetLine(spec.total ?? null, outcome.name ?? '');

      // A API BetBuilder da Superbet não informa o time do jogador.
      // O time será preenchido no merge com dados do BetMGM/Betfair.
      odds.push({
        playerName,
        team: '',
        line,
        value: price,
        house: 'superbet',
        market: marketKey,
        url: eventUrl,
      });
    }
  }

  if (odds.length === 0) {
    logger.warn(
      `[Superbet] ${match.homeTeam} vs ${match.awayTeam} [id ${match.id}]: ${allMarkets.length} mercados, 0 de desarmes/faltas. Nomes: ` +
        allMarkets.map((m: any) => m?.name).filter(Boolean).slice(0, 25).join(' | '),
    );
    return null;
  }

  return {
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    dateTime: match.dateTime,
    stage: 'Copa do Mundo 2026',
    odds,
  };
}

/** Resolve o marketKey a partir do nome do mercado Superbet. */
function resolveSuperbetMarketKey(marketName: string): string | null {
  const lower = marketName.toLowerCase();

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
