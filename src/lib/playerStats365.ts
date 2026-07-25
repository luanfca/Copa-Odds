// Histórico do jogador na Copa por mercado (desarmes / faltas), via 365scores.
//
// Não existe endpoint por atleta no 365scores, então varremos os jogos já
// FINALIZADOS da competição e lemos as stats por jogador dentro de cada jogo.
// Cada jogo finalizado é imutável → cache forte (promise-cache) por gameId, e
// reaproveitado entre todos os jogadores daquele jogo.

import {
  COMP_DEFAULT_CLUBS,
  COMP_BRASILEIRAO,
  COMP_SERIEB,
  COMP_MLS,
  COMP_WC,
  baseParams,
  isNameMatch,
  teamSlug,
  teamSlugMatch,
  webwsJson,
} from './lineups365';
import { COMPETITIONS } from './competitions';
import { normalizeName } from './normalize';
import { setSharedHistory } from './sharedCache';

/** type da stat no 365scores para cada mercado da nossa app. */
export const MARKET_STAT_TYPE: Record<string, number> = {
  desarmes: 39,
  faltas_cometidas: 42,
  faltas_sofridas: 37,
  // Confirmados no payload /web/game: 3=chutes, 4=chutes no gol.
  // O tipo 45 é toques na bola e não pode ser usado como finalização.
  finalizacao: 3,
  chutes_ao_gol: 4,
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

// Tipos que usavam o denominador de "X/Y" (tentativas). Mercado de desarmes
// nas casas costuma ser desarmes efetuados (numerador) — NÃO usar o total.
const TOTAL_STAT_TYPES = new Set<number>(); // vazio: sempre preferir o 1º número

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

/**
 * A API /web/games do 365scores zera o retorno se a janela for > ~30 dias.
 * Por isso varremos em fatias de 28 dias e por competição (multi-ID também falha).
 */
function ingestFinishedGames(byId: Map<string, FinGame>, games: any[]): void {
  for (const g of games ?? []) {
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
}

export async function getFinishedGames(): Promise<FinGame[]> {
  if (finCache && Date.now() - finCache.t < FIN_TTL) return finCache.value;

  const now = Date.now();
  const byId = new Map<string, FinGame>();
  // Brasileirão A + B + MLS, IDs 365scores atuais (113/116/104)
  const comps = COMP_DEFAULT_CLUBS.split(',').filter(Boolean);
  // ~90 dias em janelas de 28 (limite prático da API)
  const windows = rollingWindows(90, 28);

  await Promise.all(
    comps.flatMap((comp) =>
      windows.map(async ({ start, end }) => {
        try {
          const data = await webwsJson(
            '/web/games/?' +
              baseParams({
                competitions: comp,
                startDate: start,
                endDate: end,
                showOdds: 'false',
                onlyMajorGames: 'false',
              }),
          );
          ingestFinishedGames(byId, data?.games ?? []);
        } catch {
          /* ignora falha de uma janela */
        }
      }),
    ),
  );

  const value = Array.from(byId.values()).sort((a, b) => (a.start < b.start ? -1 : 1));
  finCache = { value, t: now };
  return value;
}

// ─── Jogos de clubes em várias competições (Brasileirão + MLS + outras) ───

const FIN_ALL_TTL = 30 * 60_000;
let finAllCache: { value: FinGame[]; t: number } | null = null;

function rollingWindows(daysBack: number, windowDays = 28): Array<{ start: string; end: string }> {
  const now = Date.now();
  const out: Array<{ start: string; end: string }> = [];
  for (let offset = 0; offset < daysBack; offset += windowDays) {
    const end = new Date(now - offset * 86_400_000);
    const start = new Date(end.getTime() - windowDays * 86_400_000);
    out.push({ start: fmtDate(start), end: fmtDate(end) });
  }
  return out;
}

export async function getFinishedGamesAllComps(): Promise<FinGame[]> {
  if (finAllCache && Date.now() - finAllCache.t < FIN_ALL_TTL) return finAllCache.value;

  const byId = new Map<string, FinGame>();
  // Competições de clube configuradas (+ WC legado se ainda houver seleção)
  const clubComps = [
    COMPETITIONS.brasileirao?.id365 ?? COMP_BRASILEIRAO,
    COMPETITIONS.serieb?.id365 ?? COMP_SERIEB,
    COMPETITIONS.mls?.id365 ?? COMP_MLS,
    COMP_WC,
  ].filter(Boolean) as string[];

  const windows = rollingWindows(90, 30);
  const jobs: Array<{ comp: string; start: string; end: string }> = [];
  for (const comp of clubComps) {
    for (const w of windows) jobs.push({ comp, ...w });
  }

  await Promise.all(
    jobs.map(async ({ comp, start, end }) => {
      try {
        const data = await webwsJson(
          '/web/games/?' +
            baseParams({
              competitions: comp,
              startDate: start,
              endDate: end,
              showOdds: 'false',
              onlyMajorGames: 'false',
            }),
        );
        ingestFinishedGames(byId, data?.games ?? []);
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
  /** ID imutável do jogo no 365Scores. */
  eventId?: number;
}

export interface PlayerHistory {
  market: string;
  entries: HistoryEntry[]; // do mais antigo ao mais recente
  total: number;
  average: number;
}

export interface PlayerHistoryOpts {
  /** Quantidade máxima de jogos recentes (default: todos disponíveis). */
  maxGames?: number;
  /** Filtra jogos pelo ano civil (ex: 2026). */
  year?: number;
  /** Competição pedida pelo painel. */
  competition?: string;
  /** Liga principal ou todas as competições disponíveis. */
  historyScope?: 'league' | 'all';
}

/**
 * Mantém a mesma chave histórica usada pelo restante da aplicação. Assim,
 * snapshots e rotas podem trocar a fonte sem invalidar o contrato do cache.
 */
function historyDbKey365(
  playerName: string,
  team: string,
  market: string,
  allComps: boolean,
  opts?: PlayerHistoryOpts,
): string {
  const scope =
    opts?.historyScope === 'all' || allComps
      ? 'all'
      : `league:${opts?.competition || 'brasileirao'}`;
  return [
    'hist-v12',
    normalizeName(team),
    normalizeName(playerName),
    market,
    scope,
    opts?.year ?? 'cur',
  ].join('::');
}

/**
 * Histórico do jogador via 365Scores.
 *
 * Os jogos e estatísticas são buscados uma única vez e ficam no promise-cache
 * por gameId; todos os jogadores e mercados reutilizam o mesmo payload.
 */
export async function getPlayerHistory(
  playerName: string,
  team: string,
  market: string,
  allComps = false,
  opts?: PlayerHistoryOpts,
): Promise<PlayerHistory | null> {
  const statType = MARKET_STAT_TYPE[market];
  if (statType == null || !playerName || !team) return null;

  const maxGames = Math.max(1, Math.min(opts?.maxGames ?? 10, 10));
  const tslug = teamSlug(team);
  let games = (allComps || opts?.historyScope === 'all'
    ? await getFinishedGamesAllComps()
    : await getFinishedGames()
  ).filter(
    (g) => teamSlugMatch(g.homeSlug, tslug) || teamSlugMatch(g.awaySlug, tslug),
  );

  if (opts?.year != null && Number.isFinite(opts.year)) {
    games = games.filter((g) => new Date(g.start).getFullYear() === opts.year);
  }

  // Procura até 30 jogos para encontrar as 10 aparições mais recentes.
  const scan = games
    .sort((a, b) => (a.start < b.start ? 1 : -1))
    .slice(0, Math.max(maxGames * 3, 24));
  const entries: HistoryEntry[] = [];

  // A própria webwsJson limita a concorrência global; Promise.all aqui permite
  // preencher o cache por jogo rapidamente sem sobrecarregar o 365Scores.
  await Promise.all(
    scan.map(async (game) => {
      try {
        const members = await getGameMemberStats(game.gameId);
        const player = members.find(
          (member) =>
            teamSlugMatch(member.teamSlug, tslug) &&
            isNameMatch(playerName, member.name),
        );
        if (!player) return;

        const minutes = parseStatNumber(player.statsByType.get(MINUTES_TYPE));
        if (minutes != null && minutes <= 0) return;

        const raw = player.statsByType.get(statType);
        const value =
          raw == null
            ? 0
            : TOTAL_STAT_TYPES.has(statType)
              ? parseStatTotal(raw) ?? 0
              : parseStatNumber(raw) ?? 0;
        const homeIsTeam = teamSlugMatch(game.homeSlug, tslug);
        entries.push({
          date: game.start,
          opponent: homeIsTeam ? game.awayName : game.homeName,
          value,
          minutes,
          eventId: Number(game.gameId) || undefined,
        });
      } catch {
        /* Uma partida inválida não invalida o histórico inteiro. */
      }
    }),
  );

  entries.sort((a, b) => (a.date < b.date ? -1 : 1));
  const kept = entries.length > maxGames ? entries.slice(-maxGames) : entries;
  const total = kept.reduce((sum, entry) => sum + entry.value, 0);
  const history: PlayerHistory = {
    market,
    entries: kept,
    total,
    average: kept.length ? total / kept.length : 0,
  };
  if (!kept.length) return null;

  const key = historyDbKey365(playerName, team, market, allComps, opts);
  await setSharedHistory(key, history).catch(() => null);
  return history;
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
