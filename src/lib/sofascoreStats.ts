/**
 * Estatísticas do SofaScore — desarmes, faltas, chutes, posse, etc.
 *
 * Adapta a lógica do sofascore_api.py (curl_cffi) para TypeScript.
 * Usa fetch nativo com headers de navegador; o módulo sofascore.ts existente
 * já prova que esses headers funcionam para a API do SofaScore.
 */

import { normalizeName, isSamePlayer } from './normalize';
import {
  getCacheTeamEvents,
  setCacheTeamEvents,
  getCachePlayerStats,
  setCachePlayerStats,
  getCachePlayerHistory,
  setCachePlayerHistory,
} from './sqliteCache';
import { COMPETITIONS } from './competitions';
import {
  getFotmobEventPlayerStats,
  getFotmobTeamFinishedEvents,
} from './fotmobHistory';

// ── Constantes ───────────────────────────────────────────────────────────────

// Servidor Python local que usa curl_cffi para bypass do Cloudflare
const SOFA_SERVER = process.env.SOFA_SERVER_URL || 'http://127.0.0.1:54545';

// ── Cache TTL genérico ───────────────────────────────────────────────────────

class TTLCache<V> {
  private map = new Map<string, { val: V; t: number }>();
  constructor(private maxAge: number, private maxSize: number = 200) {}

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.t > this.maxAge) {
      this.map.delete(key);
      return undefined;
    }
    return hit.val;
  }

  set(key: string, val: V): void {
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { val, t: Date.now() });
  }

  clear(): void {
    this.map.clear();
  }
}

// 2 min para jogos ao vivo, 10 min para finalizados
const STATS_TTL_LIVE = 2 * 60 * 1000;
const STATS_TTL_FINISHED = 10 * 60 * 1000;
const LIVE_EVENTS_TTL = 60 * 1000; // 1 min

const matchStatsCache = new TTLCache<SofaScoreMatchStats>(STATS_TTL_FINISHED, 100);
const liveEventsCache = new TTLCache<SofaScoreLiveEvent[]>(LIVE_EVENTS_TTL, 5);
const eventIdCache = new TTLCache<number | null>(2 * 60 * 60 * 1000, 500);

// ── Fetch helper via servidor Python local ────────────────────────────────────

export async function sofaJson(path: string): Promise<any | null> {
  const url = SOFA_SERVER + path;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (res.status === 200) return await res.json();
      console.error(`[SofaScore] ${res.status} for ${url.slice(0, 80)}`);
      return null;
    } catch (err) {
      console.error(`[SofaScore] ${attempt === 0 ? 'retry' : 'fail'} fetch ${url.slice(0, 80)}:`, String(err));
      if (attempt === 1) return null;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface SofaScoreLiveEvent {
  id: number;
  homeTeam: { name: string; id: number };
  awayTeam: { name: string; id: number };
  homeScore: { current: number };
  awayScore: { current: number };
  status: { description: string; type: string };
  startTimestamp: number;
  tournament: { uniqueName: string; category: { name: string } };
}

export interface SofaScoreMatchStats {
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  // Stats por time
  homeTackles: number;
  awayTackles: number;
  homeFouls: number;
  awayFouls: number;
  homeWasFouled: number;
  awayWasFouled: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homePossession: number;
  awayPossession: number;
  homeInterceptions: number;
  awayInterceptions: number;
  homePasses: number;
  awayPasses: number;
  homeRecoveries: number;
  awayRecoveries: number;
  homeClearances: number;
  awayClearances: number;
  homeYellowCards: number;
  awayYellowCards: number;
  homeRedCards: number;
  awayRedCards: number;
}

// ── Match name normalization ─────────────────────────────────────────────────

const TEAM_PT_EN: Record<string, string> = {
  brasil: 'brazil',
  franca: 'france',
  alemanha: 'germany',
  espanha: 'spain',
  inglaterra: 'england',
  italia: 'italy',
  marrocos: 'morocco',
  argentina: 'argentina',
  portugal: 'portugal',
  holanda: 'netherlands',
  'paises baixos': 'netherlands',
  croacia: 'croatia',
  belgica: 'belgium',
  mexico: 'mexico',
  'estados unidos': 'usa',
  japao: 'japan',
  'coreia do sul': 'south korea',
  uruguai: 'uruguay',
  colombia: 'colombia',
  suica: 'switzerland',
  dinamarca: 'denmark',
  servia: 'serbia',
  polonia: 'poland',
  senegal: 'senegal',
  canada: 'canada',
  equador: 'ecuador',
  catar: 'qatar',
  gana: 'ghana',
  camaroes: 'cameroon',
  tunisia: 'tunisia',
  australia: 'australia',
  noruega: 'norway',
  irlanda: 'ireland',
  escocia: 'scotland',
  gales: 'wales',
  'pais de gales': 'wales',
  turquia: 'turkiye',
  'nova zelandia': 'new zealand',
  paraguai: 'paraguay',
  peru: 'peru',
  'costa rica': 'costa rica',
  egito: 'egypt',
  'arabia saudita': 'saudi arabia',
  'coreia do norte': 'north korea',
  cameroon: 'cameroon',
  'rd congo': 'dr congo',
  'republica dominicana': 'dominican republic',
};

function teamMatches(eventTeamName: string, ourTeamName: string): boolean {
  const e = normalizeName(eventTeamName);
  const o = normalizeName(ourTeamName);
  if (!e || !o) return false;
  if (e === o) return true;
  const oen = TEAM_PT_EN[o];
  if (oen && (e === oen || e.includes(oen) || oen.includes(e))) return true;
  if (e.includes(o) || o.includes(e)) return true;
  return false;
}

// ── Cache de eventos por data ───────────────────────────────────────────────

const dayEventsCache = new TTLCache<any[]>(30 * 60 * 1000, 30);

async function getEventsForDate(date: string): Promise<any[]> {
  const cached = dayEventsCache.get(date);
  if (cached) return cached;
  const data = await sofaJson('/sport/football/scheduled-events/' + date);
  const events = data?.events ?? [];
  if (events.length > 0) dayEventsCache.set(date, events);
  return events;
}

/**
 * Resolve o eventId do SofaScore para um jogo.
 * Delega para o servidor Python que usa curl_cffi.
 */
async function findEventId(
  homeTeam: string,
  awayTeam: string,
  dateTime: string,
): Promise<number | null> {
  // Tenta jogos ao vivo primeiro (rápido, sem Python)
  const live = await getLiveSofascoreEvents();
  for (const ev of live) {
    const eh = ev?.homeTeam?.name;
    const ea = ev?.awayTeam?.name;
    if (!eh || !ea) continue;
    if (
      (teamMatches(eh, homeTeam) && teamMatches(ea, awayTeam)) ||
      (teamMatches(eh, awayTeam) && teamMatches(ea, homeTeam))
    ) return ev.id;
  }

  // Delega para o servidor Python (curl_cffi bypass)
  const data = await sofaJson(
    `/resolve?home=${encodeURIComponent(homeTeam)}&away=${encodeURIComponent(awayTeam)}&date=${encodeURIComponent(dateTime)}`,
  );
  return data?.eventId ?? null;
}

/**
 * Busca jogos ao vivo do SofaScore.
 */
export async function getLiveSofascoreEvents(): Promise<SofaScoreLiveEvent[]> {
  const cached = liveEventsCache.get('live');
  if (cached) return cached;
  const data = await sofaJson('/sport/football/events/live');
  const events: SofaScoreLiveEvent[] = data?.events ?? [];
  liveEventsCache.set('live', events);
  return events;
}

/**
 * Resolve o eventId do SofaScore para um jogo.
 */
export async function resolveSofascoreEventId(
  homeTeam: string,
  awayTeam: string,
  dateTime: string,
): Promise<number | null> {
  const key = `${normalizeName(homeTeam)}|${normalizeName(awayTeam)}|${(dateTime || '').slice(0, 10)}`;
  const cached = eventIdCache.get(key);
  if (cached !== undefined) return cached;
  const found = await findEventId(homeTeam, awayTeam, dateTime);
  eventIdCache.set(key, found);
  return found;
}

/**
 * Busca estatísticas agregadas de um jogo (home x away).
 * Mapeia as chaves da API do SofaScore para campos legíveis.
 */
export async function getSofascoreMatchStats(
  eventId: number,
): Promise<SofaScoreMatchStats | null> {
  const cacheKey = `match_${eventId}`;
  const cached = matchStatsCache.get(cacheKey);
  if (cached) return cached;

  const [eventData, statsData] = await Promise.all([
    sofaJson(`/event/${eventId}`),
    sofaJson(`/event/${eventId}/statistics`),
  ]);

  if (!eventData) return null;

  const event = eventData?.event ?? eventData;
  const matchStats: SofaScoreMatchStats = {
    eventId,
    homeTeam: event?.homeTeam?.name ?? 'N/A',
    awayTeam: event?.awayTeam?.name ?? 'N/A',
    homeScore: event?.homeScore?.current ?? 0,
    awayScore: event?.awayScore?.current ?? 0,
    status: event?.status?.description ?? 'N/A',
    homeTackles: 0,
    awayTackles: 0,
    homeFouls: 0,
    awayFouls: 0,
    homeWasFouled: 0,
    awayWasFouled: 0,
    homeShots: 0,
    awayShots: 0,
    homeShotsOnTarget: 0,
    awayShotsOnTarget: 0,
    homePossession: 0,
    awayPossession: 0,
    homeInterceptions: 0,
    awayInterceptions: 0,
    homePasses: 0,
    awayPasses: 0,
    homeRecoveries: 0,
    awayRecoveries: 0,
    homeClearances: 0,
    awayClearances: 0,
    homeYellowCards: 0,
    awayYellowCards: 0,
    homeRedCards: 0,
    awayRedCards: 0,
  };

  if (statsData?.statistics) {
    for (const period of statsData.statistics) {
      if (period.period !== 'ALL') continue;
      for (const group of period.groups ?? []) {
        for (const item of group.statisticsItems ?? []) {
          const key = item.key as string;
          const hv = Number(item.homeValue) || 0;
          const av = Number(item.awayValue) || 0;
          switch (key) {
            case 'totalTackle':
              matchStats.homeTackles = hv;
              matchStats.awayTackles = av;
              break;
            case 'fouls':
              matchStats.homeFouls = hv;
              matchStats.awayFouls = av;
              break;
            case 'wasFouled':
              matchStats.homeWasFouled = hv;
              matchStats.awayWasFouled = av;
              break;
            case 'totalShotsOnGoal':
              matchStats.homeShots = hv;
              matchStats.awayShots = av;
              break;
            case 'shotsOnGoal':
              matchStats.homeShotsOnTarget = hv;
              matchStats.awayShotsOnTarget = av;
              break;
            case 'ballPossession':
              matchStats.homePossession = hv;
              matchStats.awayPossession = av;
              break;
            case 'interceptionWon':
              matchStats.homeInterceptions = hv;
              matchStats.awayInterceptions = av;
              break;
            case 'passes':
              matchStats.homePasses = hv;
              matchStats.awayPasses = av;
              break;
            case 'ballRecovery':
              matchStats.homeRecoveries = hv;
              matchStats.awayRecoveries = av;
              break;
            case 'totalClearance':
              matchStats.homeClearances = hv;
              matchStats.awayClearances = av;
              break;
            case 'yellowCards':
              matchStats.homeYellowCards = hv;
              matchStats.awayYellowCards = av;
              break;
            case 'redCards':
              matchStats.homeRedCards = hv;
              matchStats.awayRedCards = av;
              break;
          }
        }
      }
    }
  }

  matchStatsCache.set(cacheKey, matchStats);
  return matchStats;
}

/**
 * Invalida todos os caches.
 */
export function invalidateSofascoreStatsCache(): void {
  matchStatsCache.clear();
  liveEventsCache.clear();
}

// ── Team finished events (substituto do 365scores) ───────────────────────────

export interface SofaTeamEvent {
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  startDate: string; // ISO date
  startTimestamp: number;
  /** ID do torneio (ex: 325 = Brasileirão, 242 = MLS). 0 = desconhecido. */
  tournamentId: number;
  /** Nome do torneio (ex: "Brasileirão Série A"). Usado como fallback de filtro. */
  tournamentName: string;
}

// Cache agora é SQLite (ver sqliteCache.ts)

/**
 * Busca jogos finalizados recentes de um time via SofaScore.
 * Usa o servidor Python local que tem curl_cffi + TEAM_ID_CACHE.
 *
 * @param teamName - Nome do time
 * @param competitionName - Opcional. Nome da competição para filtrar (ex: "Brasileirão Série A").
 *                          Quando informado, apenas eventos DESTA competição são retornados.
 * @param tournamentId - Opcional. ID do torneio no SofaScore (uniqueTournament.id).
 *                        Usado quando disponível, é mais confiável que o nome.
 */
export async function getTeamFinishedEvents(
  teamName: string,
  competitionName?: string,
  tournamentId?: number,
): Promise<SofaTeamEvent[]> {
  const cacheKey = `tev-v3_${normalizeName(teamName)}_${tournamentId ?? (competitionName ? normalizeName(competitionName) : 'all')}`;
  
  // Cache SQLite: evita refetching eventos do mesmo time+torneio
  const cached = await getCacheTeamEvents(cacheKey);
  if (cached) return cached;

  try {
    // FotMob/Opta é a fonte principal dos jogos finalizados: os endpoints
    // funcionam em datacenter e conferem com os números do SofaScore.
    const fotmobEvents = await getFotmobTeamFinishedEvents(teamName, tournamentId);
    if (fotmobEvents.length > 0) {
      await setCacheTeamEvents(cacheKey, fotmobEvents).catch(() => null);
      return fotmobEvents;
    }

    // Constrói URL com filtro de competição opcional
    let url = `/team-events?team=${encodeURIComponent(teamName)}`;
    if (tournamentId) {
      url += `&tournament=${tournamentId}`;
    } else if (competitionName) {
      url += `&competitionName=${encodeURIComponent(competitionName)}`;
    }

    const data = await sofaJson(url);
    if (!data?.events) {
      console.log(`[getTeamFinishedEvents DEBUG] ${teamName}: sofaJson retornou null/sem events. URL: ${url}`);
      return [];
    }

    console.log(`[getTeamFinishedEvents DEBUG] ${teamName}: ${data.events.length} eventos brutos do Python. tournamentId=${tournamentId}, competitionName=${competitionName}`);

    const now = Date.now() / 1000;
    const results: SofaTeamEvent[] = [];
    for (const ev of data.events) {
      // Inclui qualquer evento com timestamp passado (já começou ou terminou)
      const ts = ev.startTimestamp ?? 0;
      if (ts <= 0 || ts > now) continue;

      results.push({
        eventId: ev.id,
        homeTeam: ev.homeTeam?.name ?? '',
        awayTeam: ev.awayTeam?.name ?? '',
        startDate: new Date(ts * 1000).toISOString(),
        startTimestamp: ts,
        tournamentId: ev.tournament?.uniqueTournament?.id ?? 0,
        tournamentName: ev.tournament?.uniqueTournament?.name ?? ev.tournament?.name ?? '',
      });
    }

    // Debug: loga torneios dos resultados
    const tournamentSummary: Record<string, number> = {};
    for (const r of results) {
      const key = `${r.tournamentName} (id=${r.tournamentId})`;
      tournamentSummary[key] = (tournamentSummary[key] || 0) + 1;
    }
    console.log(`[getTeamFinishedEvents DEBUG] ${teamName}: ${results.length} eventos passados. Torneios: ${JSON.stringify(tournamentSummary)}`);

    if (results.length > 0) setCacheTeamEvents(cacheKey, results).catch(() => {});
    return results;
  } catch (err) {
    console.error(`[SofaScore] getTeamFinishedEvents(${teamName}):`, String(err));
    return [];
  }
}

// ── Stats por jogador via lineups ────────────────────────────────────────────

export interface SofaScorePlayerGameStat {
  name: string;
  team: string;
  tackles: number;
  foulsCommitted: number;
  foulsSuffered: number;
  shots: number;
  shotsOnTarget: number;
  minutes: number;
}

const playerGameStatsCache = new TTLCache<SofaScorePlayerGameStat[]>(60 * 60 * 1000, 200);

/**
 * Busca stats individuais dos jogadores de um jogo via servidor Python.
 * Retorna nome, time, desarmes, faltas cometidas/sofridas e minutos.
 */
export async function getSofascorePlayerGameStats(
  homeTeam: string,
  awayTeam: string,
  dateTime: string,
): Promise<SofaScorePlayerGameStat[]> {
  const cacheKey = `pgs_${normalizeName(homeTeam)}_${normalizeName(awayTeam)}_${(dateTime || '').slice(0, 10)}`;
  const cached = playerGameStatsCache.get(cacheKey);
  if (cached) return cached;

  const eventId = await resolveSofascoreEventId(homeTeam, awayTeam, dateTime);
  if (!eventId) return [];

  const data = await sofaJson(`/player_stats?event_id=${eventId}`);
  const players = mapPlayerStatsPayload(data);

  if (players.length > 0) playerGameStatsCache.set(cacheKey, players);
  return players;
}

/**
 * Cache antigo lia `shotsOnTarget` (sempre 0 no lineups do SofaScore).
 * O campo correto é `onTargetScoringAttempt` — se há chutes e zero no gol
 * em todos, o cache está sujo e precisa re-buscar.
 */
function looksLikeBrokenShotsOnTarget(players: SofaScorePlayerGameStat[]): boolean {
  const withShots = players.filter((p) => (p.shots ?? 0) > 0);
  if (withShots.length < 2) return false;
  return withShots.every((p) => (p.shotsOnTarget ?? 0) === 0);
}

function mapPlayerStatsPayload(data: any): SofaScorePlayerGameStat[] {
  return (data?.players ?? []).map((p: any) => ({
    name: p.name ?? '',
    team: p.team ?? '',
    tackles: p.tackles ?? 0,
    foulsCommitted: p.foulsCommitted ?? 0,
    foulsSuffered: p.foulsSuffered ?? 0,
    shots: p.shots ?? 0,
    // Aceita nome novo (servidor) e aliases legados
    shotsOnTarget:
      p.shotsOnTarget ?? p.onTargetScoringAttempt ?? p.onTarget ?? 0,
    minutes: p.minutes ?? 0,
  }));
}

/** Stats de um evento por ID — memória + SQLite permanente (jogo finalizado não muda). */
export async function getEventPlayerStats(eventId: number): Promise<SofaScorePlayerGameStat[]> {
  const memKey = `evps_${eventId}`;
  const mem = playerGameStatsCache.get(memKey);
  if (mem && !looksLikeBrokenShotsOnTarget(mem)) return mem;

  const db = await getCachePlayerStats(eventId);
  if (Array.isArray(db) && db.length > 0) {
    const cached = db as SofaScorePlayerGameStat[];
    if (!looksLikeBrokenShotsOnTarget(cached)) {
      playerGameStatsCache.set(memKey, cached);
      return cached;
    }
    // Cache sujo (shotsOnTarget sempre 0): re-busca e sobrescreve
  }

  const players =
    eventId < 0
      ? await getFotmobEventPlayerStats(eventId)
      : mapPlayerStatsPayload(await sofaJson(`/player_stats?event_id=${eventId}`));

  if (players.length > 0) {
    playerGameStatsCache.set(memKey, players);
    await setCachePlayerStats(eventId, players).catch(() => null);
  }
  return players;
}

// ── Histórico de jogador (SofaScore) — permanente no SQLite ─────────────────

export interface HistoryEntry {
  date: string;
  opponent: string;
  value: number;
  minutes: number | null;
  /** ID do evento SofaScore (merge incremental). */
  eventId?: number;
}

export interface PlayerHistory {
  market: string;
  entries: HistoryEntry[];
  total: number;
  average: number;
  /** Data ISO do jogo mais recente no histórico (invalidação). */
  latestGameDate?: string;
  /** Eventos já processados. */
  eventIds?: number[];
  /** Quando gravamos no banco. */
  savedAt?: string;
}

export interface PlayerHistoryOpts {
  maxGames?: number;
  year?: number;
  /** Chave em COMPETITIONS (ex: brasileirao, mls) */
  competition?: string;
  /**
   * league = só a liga do contexto (BR ou MLS)
   * all = todos os jogos (Liberta, copas, etc.)
   */
  historyScope?: 'league' | 'all';
}

const MARKET_FIELD: Record<string, keyof SofaScorePlayerGameStat> = {
  desarmes: 'tackles',
  faltas_cometidas: 'foulsCommitted',
  faltas_sofridas: 'foulsSuffered',
  finalizacao: 'shots',
  chutes: 'shots',
  chutes_ao_gol: 'shotsOnTarget',
};

/** Máximo de jogos no banco por jogador (UI pede no máx. 10). */
const STORE_MAX = 10;

function teamNamesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Chave estável no SQLite — compartilhada com historyEnrich. */
export function historyDbKey(
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
    // v14: histórico finalizado via FotMob/Opta, com SofaScore como reserva.
    'hist-v14',
    normalizeName(team),
    normalizeName(playerName),
    market,
    scope,
    opts?.year ?? 'cur',
  ].join('::');
}

function finalizeHistory(market: string, entries: HistoryEntry[]): PlayerHistory {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Mantém os mais recentes STORE_MAX
  const kept = sorted.length > STORE_MAX ? sorted.slice(-STORE_MAX) : sorted;
  const total = kept.reduce((s, e) => s + e.value, 0);
  const eventIds = kept.map((e) => e.eventId).filter((id): id is number => typeof id === 'number');
  return {
    market,
    entries: kept,
    total,
    average: kept.length ? total / kept.length : 0,
    latestGameDate: kept.length ? kept[kept.length - 1].date : undefined,
    eventIds,
    savedAt: new Date().toISOString(),
  };
}

function sliceWant(h: PlayerHistory, want: number): PlayerHistory {
  if (want <= 0 || h.entries.length <= want) return h;
  const entries = h.entries.slice(-want);
  const total = entries.reduce((s, e) => s + e.value, 0);
  return {
    ...h,
    entries,
    total,
    average: entries.length ? total / entries.length : 0,
  };
}

async function entryFromEvent(
  ev: SofaTeamEvent,
  playerName: string,
  team: string,
  field: keyof SofaScorePlayerGameStat,
): Promise<HistoryEntry | null> {
  try {
    const players = await getEventPlayerStats(ev.eventId);
    if (!players.length) return null;
    // Só conta se o jogador está no time pedido — NÃO fallback para o elenco
    // adversário (isso atribuía stats de visitante ao time da casa, ex.: Badwal/Vancouver → Cincinnati).
    const onTeam = players.filter((p) => teamNamesMatch(p.team, team));
    const hit = onTeam.find((p) => isSamePlayer(playerName, p.name));
    if (!hit) return null;
    if (hit.minutes != null && hit.minutes <= 0) return null;
    const raw = hit[field];
    const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
    const homeIsTeam = teamNamesMatch(ev.homeTeam, team);
    const opponent = homeIsTeam ? ev.awayTeam : ev.homeTeam;
    return {
      date: ev.startDate || new Date((ev.startTimestamp || 0) * 1000).toISOString(),
      opponent,
      value,
      minutes: hit.minutes ?? null,
      eventId: ev.eventId,
    };
  } catch {
    return null;
  }
}

/**
 * Histórico do jogador via SofaScore.
 * - Grava no SQLite e **não apaga**.
 * - Só consulta SofaScore de novo quando o time tem **jogo a mais** (ex.: rodada da semana).
 */
export async function getPlayerHistory(
  playerName: string,
  team: string,
  market: string,
  allComps = false,
  opts?: PlayerHistoryOpts,
): Promise<PlayerHistory | null> {
  const field = MARKET_FIELD[market];
  if (!field || !playerName || !team) return null;

  const want = Math.min(
    opts?.maxGames != null && opts.maxGames > 0 ? opts.maxGames : STORE_MAX,
    STORE_MAX,
  );
  const dbKey = historyDbKey(playerName, team, market, allComps, opts);

  // historyScope=all | allComps → todos os torneios (Liberta etc.)
  // historyScope=league (default) → só a liga (BR 325 ou MLS 242)
  let tournamentId: number | undefined;
  const scopeAll = opts?.historyScope === 'all' || (opts?.historyScope == null && allComps);
  if (scopeAll) {
    tournamentId = undefined;
  } else if (opts?.competition && COMPETITIONS[opts.competition]?.idSofaScore) {
    tournamentId = COMPETITIONS[opts.competition]!.idSofaScore;
  } else {
    tournamentId = COMPETITIONS.brasileirao?.idSofaScore;
  }

  let events = await getTeamFinishedEvents(team, undefined, tournamentId);
  if (!events.length && tournamentId != null) {
    events = await getTeamFinishedEvents(team);
  }
  if (!events.length) {
    const cachedEmpty = await getCachePlayerHistory(dbKey);
    if (cachedEmpty?.entries?.length) return sliceWant(cachedEmpty, want);
    return null;
  }

  let list = [...events].sort((a, b) => (b.startTimestamp || 0) - (a.startTimestamp || 0));
  if (opts?.year != null && Number.isFinite(opts.year)) {
    list = list.filter((e) => new Date((e.startTimestamp || 0) * 1000).getFullYear() === opts.year);
  }

  const stored = await getCachePlayerHistory(dbKey);
  const knownIds = new Set<number>(stored?.eventIds ?? []);
  // Backfill ids a partir das entries se faltar
  for (const e of stored?.entries ?? []) {
    if (e.eventId != null) knownIds.add(e.eventId);
  }

  const latestStoredTs = stored?.latestGameDate
    ? Date.parse(stored.latestGameDate)
    : stored?.entries?.length
      ? Date.parse(stored.entries[stored.entries.length - 1].date)
      : 0;

  // Só jogos REALMENTE novos (mais recentes que o último salvo / eventId desconhecido)
  const newEvents = list.filter((ev) => {
    if (knownIds.has(ev.eventId)) return false;
    const ts = (ev.startTimestamp || 0) * 1000;
    if (latestStoredTs > 0) return ts > latestStoredTs + 60_000;
    return true; // cold: todos são “novos” para o fluxo de fill abaixo
  });

  // Cache quente e sem jogo novo → devolve do banco (só fatia maxGames)
  if (stored?.entries?.length && newEvents.length === 0) {
    // Ainda pode faltar aparições se o want subiu e temos menos entries que o ideal
    if (stored.entries.length >= want || list.length <= knownIds.size) {
      return sliceWant(stored, want);
    }
  }

  // Cold start ou precisa preencher: monta a partir do zero / merge
  let baseEntries: HistoryEntry[] = stored?.entries?.length ? [...stored.entries] : [];

  if (!baseEntries.length) {
    // Primeira carga: varre jogos recentes
    const scan = list.slice(0, Math.min(list.length, Math.max(want * 3, 24)));
    const found: HistoryEntry[] = [];
    const BATCH = 4;
    for (let i = 0; i < scan.length && found.length < STORE_MAX; i += BATCH) {
      const batch = scan.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((ev) => entryFromEvent(ev, playerName, team, field)),
      );
      for (const e of results) {
        if (e) found.push(e);
      }
    }
    if (!found.length) {
      // Miss: grava vazio curto no DB (TTL 12h) para não martelar
      await setCachePlayerHistory(dbKey, {
        market,
        entries: [],
        total: 0,
        average: 0,
        savedAt: new Date().toISOString(),
      }).catch(() => null);
      return null;
    }
    const full = finalizeHistory(market, found);
    await setCachePlayerHistory(dbKey, full).catch(() => null);
    return sliceWant(full, want);
  }

  // Incremental: só processa jogos novos (ex.: Palmeiras jogou no fim de semana)
  if (newEvents.length > 0) {
    // Ordena novos do mais antigo ao mais recente entre os novos
    const toFetch = [...newEvents]
      .sort((a, b) => (a.startTimestamp || 0) - (b.startTimestamp || 0))
      .slice(-12); // no máximo 12 jogos novos de uma vez

    const BATCH = 4;
    const added: HistoryEntry[] = [];
    for (let i = 0; i < toFetch.length; i += BATCH) {
      const batch = toFetch.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((ev) => entryFromEvent(ev, playerName, team, field)),
      );
      for (const e of results) {
        if (e) added.push(e);
      }
    }

    if (added.length) {
      // Merge por eventId / date
      const byKey = new Map<string, HistoryEntry>();
      for (const e of baseEntries) {
        byKey.set(e.eventId != null ? `id:${e.eventId}` : `d:${e.date}`, e);
      }
      for (const e of added) {
        byKey.set(e.eventId != null ? `id:${e.eventId}` : `d:${e.date}`, e);
      }
      const full = finalizeHistory(market, Array.from(byKey.values()));
      await setCachePlayerHistory(dbKey, full).catch(() => null);
      return sliceWant(full, want);
    }

    // Novos jogos existem mas o jogador não entrou — atualiza latestGameDate
    // para não reprocessar os mesmos eventIds
    const newest = list[0];
    const touched: PlayerHistory = {
      ...finalizeHistory(market, baseEntries),
      latestGameDate: newest?.startDate || stored?.latestGameDate,
      eventIds: [
        ...new Set([
          ...(stored?.eventIds ?? []),
          ...baseEntries.map((e) => e.eventId).filter((x): x is number => x != null),
          ...newEvents.map((e) => e.eventId),
        ]),
      ],
      savedAt: new Date().toISOString(),
    };
    await setCachePlayerHistory(dbKey, touched).catch(() => null);
    return sliceWant(touched, want);
  }

  // Sem novos, mas precisa mais aparições (want maior)
  if (stored?.entries?.length) {
    return sliceWant(stored, want);
  }
  return null;
}
