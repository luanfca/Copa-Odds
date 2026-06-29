// Histórico do jogador na Copa por mercado (desarmes / faltas), via 365scores.
//
// Não existe endpoint por atleta no 365scores, então varremos os jogos já
// FINALIZADOS da competição e lemos as stats por jogador dentro de cada jogo.
// Cada jogo finalizado é imutável → cache forte (promise-cache) por gameId, e
// reaproveitado entre todos os jogadores daquele jogo.

import {
  COMP_WC,
  baseParams,
  isNameMatch,
  teamSlug,
  teamSlugMatch,
  webwsJson,
} from './lineups365';

/** type da stat no 365scores para cada mercado da nossa app. */
export const MARKET_STAT_TYPE: Record<string, number> = {
  desarmes: 39,
  faltas_cometidas: 42,
  faltas_sofridas: 37,
};

const MINUTES_TYPE = 30;

/** Pega o primeiro número de uma string ("4/5 (80%)" -> 4, "0" -> 0). */
export function parseStatNumber(raw: unknown): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/-?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = parseFloat(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Para stats no formato "X/Y (Z%)" retorna Y (total de tentativas).
 * Para stats simples como "2" retorna o próprio valor.
 * Usado para desarmes, onde queremos o total (5) e não apenas os ganhos (3).
 */
export function parseStatTotal(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw);
  // Formato "X/Y (...)" — pega o denominador Y
  const slashMatch = s.match(/\d+\/(\d+)/);
  if (slashMatch) {
    const n = parseInt(slashMatch[1], 10);
    return Number.isFinite(n) ? n : null;
  }
  // Formato simples
  return parseStatNumber(raw);
}

// Quais tipos de stat usam o total de tentativas (denominador) em vez do 1º número
const TOTAL_STAT_TYPES = new Set([39]); // 39 = desarmes ("8/12" -> 12 = tentativas)

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ─── Jogos finalizados ────────────────────────────────────────

interface FinGame {
  gameId: string;
  homeSlug: string;
  awaySlug: string;
  homeName: string;
  awayName: string;
  start: string;
}

const FIN_TTL = 30 * 60_000;
let finCache: { value: FinGame[]; t: number } | null = null;

export async function getFinishedGames(): Promise<FinGame[]> {
  if (finCache && Date.now() - finCache.t < FIN_TTL) return finCache.value;

  const now = Date.now();
  const byId = new Map<string, FinGame>();

  // Busca todos os jogos em uma única janela de 37 dias (de hoje - 35 até hoje + 2)
  const start = new Date(now - 35 * 86_400_000);
  const end = new Date(now + 2 * 86_400_000);

  const data = await webwsJson(
    '/web/games/?' +
      baseParams({
        competitions: COMP_WC,
        startDate: fmtDate(start),
        endDate: fmtDate(end),
        showOdds: 'false',
      }),
  );

  for (const g of data?.games ?? []) {
    const finished =
      g?.statusGroup === 4 || /fim|encerr|final/i.test(String(g?.statusText ?? ''));
    if (!finished) continue;
    const id = String(g.id);
    if (byId.has(id)) continue;
    byId.set(id, {
      gameId: id,
      homeSlug: teamSlug(g.homeCompetitor?.name ?? ''),
      awaySlug: teamSlug(g.awayCompetitor?.name ?? ''),
      homeName: g.homeCompetitor?.name ?? '',
      awayName: g.awayCompetitor?.name ?? '',
      start: g.startTime ?? '',
    });
  }

  const value = Array.from(byId.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
  finCache = { value, t: now };
  return value;
}

// ─── Todos os jogos de seleções 2026 (Copa + Amistosos) ───────────

const FIN_ALL_TTL = 30 * 60_000;
let finAllCache: { value: FinGame[]; t: number } | null = null;

export async function getFinishedGamesAllComps(): Promise<FinGame[]> {
  if (finAllCache && Date.now() - finAllCache.t < FIN_ALL_TTL) return finAllCache.value;

  const byId = new Map<string, FinGame>();

  // Janelas mensais para cada competição (API limita ~31 dias)
  const windows: Array<{ comp: string; start: string; end: string }> = [
    // Copa do Mundo (jul)
    { comp: '5930', start: '01/06/2026', end: '15/06/2026' },
    { comp: '5930', start: '16/06/2026', end: '30/06/2026' },
    { comp: '5930', start: '01/07/2026', end: '31/07/2026' },
    // Amistosos Internacionais de seleções
    { comp: '570', start: '01/01/2026', end: '28/02/2026' },
    { comp: '570', start: '01/03/2026', end: '31/03/2026' },
    { comp: '570', start: '01/04/2026', end: '30/04/2026' },
    { comp: '570', start: '01/05/2026', end: '31/05/2026' },
    { comp: '570', start: '01/06/2026', end: '30/06/2026' },
  ];

  await Promise.all(
    windows.map(async ({ comp, start, end }) => {
      try {
        const data = await webwsJson(
          '/web/games/?' +
            baseParams({
              competitions: comp,
              startDate: start,
              endDate: end,
              showOdds: 'false',
            }),
        );
        for (const g of data?.games ?? []) {
          const finished =
            g?.statusGroup === 4 || /fim|encerr|final/i.test(String(g?.statusText ?? ''));
          if (!finished) continue;
          const id = String(g.id);
          if (byId.has(id)) continue;
          byId.set(id, {
            gameId: id,
            homeSlug: teamSlug(g.homeCompetitor?.name ?? ''),
            awaySlug: teamSlug(g.awayCompetitor?.name ?? ''),
            homeName: g.homeCompetitor?.name ?? '',
            awayName: g.awayCompetitor?.name ?? '',
            start: g.startTime ?? '',
          });
        }
      } catch { /* ignora falha de uma janela */ }
    }),
  );

  const value = Array.from(byId.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
  finAllCache = { value, t: Date.now() };
  return value;
}


// ─── Stats por jogador num jogo ─────────────────────────────────

interface MemberStat {
  name: string;
  teamSlug: string;
  statsByType: Map<number, string>;
}

// Promise-cache: dedupe de chamadas em voo + cache (jogo finalizado não muda).
const gameStatsCache3 = new Map<string, Promise<MemberStat[]>>();

export async function getGameMemberStats(gameId: number | string): Promise<MemberStat[]> {
  const key = String(gameId) + '-v2';
  const cached = gameStatsCache3.get(key);
  if (cached) return cached;

  const p = (async (): Promise<MemberStat[]> => {
    const data = await webwsJson('/web/game/?' + baseParams({ gameId: String(gameId) }));
    const game = data?.game;
    if (!game) return [];

    const nameById = new Map<number, string>();
    for (const m of game.members ?? []) {
      if (m && typeof m.id === 'number') nameById.set(m.id, m.name ?? m.shortName ?? '');
    }

    const out: MemberStat[] = [];
    for (const side of ['homeCompetitor', 'awayCompetitor'] as const) {
      const comp = game[side];
      if (!comp) continue;
      const tslug = teamSlug(comp.name ?? '');
      const members = comp.lineups?.members;
      if (!Array.isArray(members)) continue;
      for (const lm of members) {
        if (!lm || !Array.isArray(lm.stats)) continue;
        const nm = nameById.get(lm.id) ?? '';
        if (!nm) continue;
        const statsByType = new Map<number, string>();
        for (const st of lm.stats) {
          if (st && typeof st.type === 'number') statsByType.set(st.type, String(st.value));
        }
        out.push({ name: nm, teamSlug: tslug, statsByType });
      }
    }
    return out;
  })();

  // Só mantemos no cache se a promise resolver com dados válidos (> 0).
  // Assim evitamos cachear permanentemente um erro 429 ou falha temporária.
  p.then(res => {
    if (res.length === 0) gameStatsCache3.delete(key);
  }).catch(() => {
    gameStatsCache3.delete(key);
  });

  gameStatsCache3.set(key, p);
  return p;
}

// ─── API pública ─────────────────────────────────────────────

export interface HistoryEntry {
  /** ISO do início do jogo. */
  date: string;
  /** Seleção adversária naquele jogo. */
  opponent: string;
  /** Valor do mercado naquele jogo (ex.: desarmes feitos). */
  value: number;
  /** Minutos jogados naquele jogo (null se desconhecido). */
  minutes: number | null;
}

export interface PlayerHistory {
  market: string;
  entries: HistoryEntry[]; // do mais antigo ao mais recente
  total: number;
  average: number;
}

export async function getPlayerHistory(
  playerName: string,
  team: string,
  market: string,
  allComps = false,
): Promise<PlayerHistory | null> {
  const statType = MARKET_STAT_TYPE[market];
  if (statType == null) return null;

  const tslug = teamSlug(team);
  const games = (allComps ? await getFinishedGamesAllComps() : await getFinishedGames()).filter(
    (g) => teamSlugMatch(g.homeSlug, tslug) || teamSlugMatch(g.awaySlug, tslug),
  );
  if (games.length === 0) return null;

  const results = await Promise.all(
    games.map(async (g): Promise<HistoryEntry | null> => {
      const homeIsTeam = teamSlugMatch(g.homeSlug, tslug);
      const opponent = homeIsTeam ? g.awayName : g.homeName;
      try {
        const members = await getGameMemberStats(g.gameId);
        const pool = members.filter((m) => teamSlugMatch(m.teamSlug, tslug));
        const hit = (pool.length ? pool : members).find((m) => isNameMatch(playerName, m.name));
        if (!hit) return null; // não estava na escalação/lista do jogo

        // Só conta se o jogador realmente entrou em campo. Reserva não utilizado
        // tem 0 minutos (ou ausente) → descarta.
        const minutes = parseStatNumber(hit.statsByType.get(MINUTES_TYPE));
        if (minutes != null && minutes <= 0) return null;

        const raw = hit.statsByType.get(statType);
        // Para desarmes (type 39): "3/5 (60%)" -> total=5 (tentativas), não ganhos(3)
        const value = raw != null
          ? (TOTAL_STAT_TYPES.has(statType) ? parseStatTotal(raw) ?? 0 : parseStatNumber(raw) ?? 0)
          : 0;
        console.log(`[DEBUG] getPlayerHistory ${playerName} game=${g.gameId} statType=${statType} raw=${raw} value=${value}`);
        return { date: g.start, opponent, value, minutes: minutes ?? null };
      } catch (err) {
        return null;
      }
    }),
  );

  const entries = results
    .filter((e): e is HistoryEntry => e !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (entries.length === 0) return null;

  const total = entries.reduce((s, e) => s + e.value, 0);
  const average = total / entries.length;
  return { market, entries, total, average };
}

// ─── Histórico de TIME (soma de todos os jogadores por jogo) ──────────────

export interface TeamHistory {
  market: string;
  entries: HistoryEntry[];
  total: number;
  average: number;
}

/**
 * Busca o histórico de desarmes/faltas de um TIME inteiro.
 * Para cada jogo, soma os valores de TODOS os jogadores daquele time.
 * Retorna o total por jogo e a média.
 */
export async function getTeamHistory(
  team: string,
  market: string,
  allComps = false,
): Promise<TeamHistory | null> {
  const statType = MARKET_STAT_TYPE[market];
  if (statType == null) return null;

  const tslug = teamSlug(team);
  const games = (allComps ? await getFinishedGamesAllComps() : await getFinishedGames()).filter(
    (g) => teamSlugMatch(g.homeSlug, tslug) || teamSlugMatch(g.awaySlug, tslug),
  );
  if (games.length === 0) return null;

  const entries: HistoryEntry[] = [];

  await Promise.all(
    games.map(async (g) => {
      const homeIsTeam = teamSlugMatch(g.homeSlug, tslug);
      const opponent = homeIsTeam ? g.awayName : g.homeName;
      try {
        const members = await getGameMemberStats(g.gameId);
        const pool = members.filter((m) => teamSlugMatch(m.teamSlug, tslug));

        // Soma o stat de TODOS os jogadores do time neste jogo
        let gameTotal = 0;
        let anyPlayed = false;
        for (const m of pool) {
          const minutes = parseStatNumber(m.statsByType.get(MINUTES_TYPE));
          if (minutes != null && minutes <= 0) continue; // reserva não utilizado
          anyPlayed = true;

          const raw = m.statsByType.get(statType);
          const value = raw != null
            ? (TOTAL_STAT_TYPES.has(statType) ? parseStatTotal(raw) ?? 0 : parseStatNumber(raw) ?? 0)
            : 0;
          gameTotal += value;
        }

        if (anyPlayed) {
          entries.push({ date: g.start, opponent, value: gameTotal, minutes: null });
        }
      } catch {
        // ignora erro
      }
    }),
  );

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (entries.length === 0) return null;

  const total = entries.reduce((s, e) => s + e.value, 0);
  const average = total / entries.length;
  return { market, entries, total, average };
}
