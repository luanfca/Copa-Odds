// Escalação (provável/confirmada) via 365scores — mesma fonte das fotos.
// Usado para marcar "provável titular" nos cards/tabela.
//
// Observação: o 365scores não tem endpoint por atleta; a escalação vem dentro
// do payload do jogo (/web/game) e da listagem de jogos (/web/games).

import { normalizeName, normalizeTeamName, isSamePlayer } from './normalize';
import levenshtein from 'fast-levenshtein';

const PROTO = 'https://';
const WEBWS_HOST = 'webws.365scores.com';

const APP_TYPE = '5';
const LANG_ID = '31'; // pt-BR
const TZ = 'America/Sao_Paulo';
const USER_COUNTRY = '21'; // Brasil

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/** Copa do Mundo (masculino) no 365scores — legado; app foca em clubes. */
export const COMP_WC = '5930';

/**
 * Competições de clube ativas no app (IDs 365scores /web/search).
 * IDs antigos (44/55) pararam de retornar jogos em 2026 — histórico zerou.
 * Confirmados via search: Brasileirão A=113, Série B=116, MLS=104.
 */
export const COMP_BRASILEIRAO = '113';
export const COMP_SERIEB = '116';
export const COMP_MLS = '104';
/** Lista padrão: Brasileirão A + Série B + MLS (fonte de stats/histórico). */
export const COMP_DEFAULT_CLUBS = `${COMP_BRASILEIRAO},${COMP_SERIEB},${COMP_MLS}`;

function jsonHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    Referer: 'https://www.365scores.com/',
    Origin: 'https://www.365scores.com',
  };
}

class Semaphore {
  private count = 0;
  private queue: (() => void)[] = [];
  constructor(private max: number) {}
  async acquire() {
    if (this.count < this.max) {
      this.count++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }
  release() {
    if (this.queue.length > 0) {
      const resolve = this.queue.shift()!;
      resolve();
    } else {
      this.count--;
    }
  }
}
const apiSem = new Semaphore(5);

export async function webwsJson(path: string): Promise<any | null> {
  const url = PROTO + WEBWS_HOST + path;
  for (let attempt = 0; attempt < 2; attempt++) {
    await apiSem.acquire();
    let res;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      res = await fetch(url, { headers: jsonHeaders(), signal: controller.signal });
    } catch {
      clearTimeout(timeout);
      apiSem.release();
      continue;
    }
    clearTimeout(timeout);
    apiSem.release();

    if (res.ok) {
      try {
        return await res.json();
      } catch {
        return null; // Ignore JSON parse errors
      }
    }
    
    // Se for rate limit, espera um pouco e tenta de novo.
    if (res.status === 429 || res.status === 403) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return null;
}

export function baseParams(extra: Record<string, string>): string {
  return new URLSearchParams({
    appTypeId: APP_TYPE,
    langId: LANG_ID,
    timezoneName: TZ,
    userCountryId: USER_COUNTRY,
    ...extra,
  }).toString();
}

// ─── Helpers de slug/nome (reutilizados pelo playerStats365) ───────────────

/** Slug normalizado da seleção (resolve apelidos via normalizeTeamName). */
export function teamSlug(team: string): string {
  return normalizeName(normalizeTeamName(team || ''));
}

/** Compara duas seleções de forma tolerante. */
export function teamSlugMatch(a: string, b: string): boolean {
  const sa = teamSlug(a);
  const sb = teamSlug(b);
  if (!sa || !sb) return false;
  return sa === sb || sa.includes(sb) || sb.includes(sa);
}

interface NameEntry {
  norm: string;
  tokens: string[];
}

function toEntry(name: string): NameEntry {
  const norm = normalizeName(name || '');
  return { norm, tokens: norm.split(' ').filter(Boolean) };
}

// Mapa de iniciais/apelidos → iniciais reais do nome completo
// Ex.: "z" (de Zé) → ["j"] (José)
const INITIAL_ALIASES: Record<string, string[]> = {
  z: ['j'],   // Zé → José, Z. Guilherme → José Guilherme
};

function initialCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1) {
    if (b.startsWith(a)) return true;
    // Checa aliases: a="z" → compara com b.startswith("j")
    const aliases = INITIAL_ALIASES[a];
    if (aliases && aliases.some((alias) => b.startsWith(alias))) return true;
  }
  if (b.length === 1) {
    if (a.startsWith(b)) return true;
    // Checa aliases reverso: b="z" → compara com a.startswith("j")
    const aliases = INITIAL_ALIASES[b];
    if (aliases && aliases.some((alias) => a.startsWith(alias))) return true;
  }
  return false;
}

function nameMatches(player: NameEntry, candidate: NameEntry): boolean {
  if (!player.norm || !candidate.norm) return false;
  if (player.norm === candidate.norm) return true;

  const pl = player.tokens;
  const cl = candidate.tokens;
  if (pl.length === 0 || cl.length === 0) return false;

  // Mesmo último sobrenome + primeiro nome compatível ("C." ↔ "Cristiano")
  const pLast = pl[pl.length - 1];
  const cLast = cl[cl.length - 1];
  if (pLast === cLast) {
    if (pl.length === 1 || cl.length === 1) return true; // ex.: "Vitinha"

    // Inicial em um lado → tenta casar contra QUALQUER token (não só o primeiro)
    // Ex.: "R. Mingo" → ["r","mingo"] vs "Santiago Ramos Mingo" → ["santiago","ramos","mingo"]
    //      Precisa testar "r" contra "ramos" (token do meio), não só "santiago"
    const pSingleInit = pl.length === 2 && pl[0].length === 1;
    const cSingleInit = cl.length === 2 && cl[0].length === 1;
    if (pSingleInit) {
      if (cl.slice(0, -1).some((t) => initialCompatible(pl[0], t))) return true;
    }
    if (cSingleInit) {
      if (pl.slice(0, -1).some((t) => initialCompatible(cl[0], t))) return true;
    }

    if (initialCompatible(pl[0], cl[0])) return true;

    // Fuzzy match first names when last name matches exactly (ex.: Andy vs Andrew)
    const simFirst = 1 - levenshtein.get(pl[0], cl[0]) / Math.max(pl[0].length, cl[0].length);
    if (simFirst >= 0.5) return true;
  }

  // Todos os tokens do nome mais curto contidos no mais longo
  // "Arthur Gabriel" ↔ "Arthur Gabriel Santana Marcolino"
  if (pl.every((t) => cl.includes(t))) return true;
  if (cl.every((t) => pl.includes(t))) return true;

  // Jogador de um único token (len>=4) presente no candidato
  if (pl.length === 1 && pl[0].length >= 4 && cl.includes(pl[0])) return true;
  if (cl.length === 1 && cl[0].length >= 4 && pl.includes(cl[0])) return true;

  // Primeiro + segundo nome iguais (nome composto curto vs completo)
  if (pl.length >= 2 && cl.length >= 2 && pl[0] === cl[0] && pl[1] === cl[1]) {
    return true;
  }

  return false;
}

/** Casa dois nomes de jogador de forma tolerante (acentos, abreviações). */
export function isNameMatch(a: string, b: string): boolean {
  if (nameMatches(toEntry(a), toEntry(b))) return true;
  return isSamePlayer(a, b);
}

// ─── Tipos públicos ───────────────────────────────────────────────

export interface MatchStarters {
  status: 'confirmed' | 'probable';
  count: number;
  isStarter(name: string, team?: string): boolean;
}

interface StarterRec {
  name: string;
  teamSlug: string;
}

function makeMatchStarters(
  status: 'confirmed' | 'probable',
  recs: StarterRec[],
): MatchStarters {
  const entries = recs.map((r) => ({ entry: toEntry(r.name), teamSlug: r.teamSlug }));
  return {
    status,
    count: recs.length,
    isStarter(name: string, team?: string): boolean {
      const pe = toEntry(name);
      const tslug = team ? teamSlug(team) : '';
      const pool = tslug ? entries.filter((e) => teamSlugMatch(e.teamSlug, tslug)) : entries;
      const search = pool.length ? pool : entries;
      return search.some((e) => nameMatches(pe, e.entry));
    },
  };
}

// ─── Escalação por gameId ───────────────────────────────────────

interface CacheVal<T> {
  value: T;
  t: number;
}
const STARTERS_TTL = 5 * 60_000;
const startersByGameCache = new Map<string, CacheVal<MatchStarters | null>>();

export async function getStartersByGameId(
  gameId: string | number,
): Promise<MatchStarters | null> {
  const key = String(gameId);
  const cached = startersByGameCache.get(key);
  if (cached && Date.now() - cached.t < STARTERS_TTL) return cached.value;

  const data = await webwsJson('/web/game/?' + baseParams({ gameId: key }));
  const game = data?.game;
  if (!game) {
    startersByGameCache.set(key, { value: null, t: Date.now() });
    return null;
  }

  const nameById = new Map<number, string>();
  for (const m of game.members ?? []) {
    if (m && typeof m.id === 'number') nameById.set(m.id, m.name ?? m.shortName ?? '');
  }

  const recs: StarterRec[] = [];
  let anyConfirmed = false;
  let anyData = false;
  for (const side of ['homeCompetitor', 'awayCompetitor'] as const) {
    const comp = game[side];
    if (!comp) continue;
    const tslug = teamSlug(comp.name ?? '');
    const lineups = comp.lineups;
    if (!lineups || !Array.isArray(lineups.members)) continue;
    anyData = true;
    // "Não confirmado" contém "confirm" — não tratar como oficial
    const st = String(lineups.status ?? '');
    if (
      /confirm/i.test(st) &&
      !/n[aã]o\s*confirm|not\s*confirm|unconfirm|provis[oó]r/i.test(st)
    ) {
      anyConfirmed = true;
    }
    for (const lm of lineups.members) {
      // status 1 = titular (previsto ou confirmado); 2 = banco
      if (!lm || lm.status !== 1) continue;
      const nm = nameById.get(lm.id) ?? '';
      if (nm) recs.push({ name: nm, teamSlug: tslug });
    }
  }

  if (!anyData || recs.length === 0) {
    startersByGameCache.set(key, { value: null, t: Date.now() });
    return null;
  }

  const ms = makeMatchStarters(anyConfirmed ? 'confirmed' : 'probable', recs);
  startersByGameCache.set(key, { value: ms, t: Date.now() });
  return ms;
}

// ─── Listagem de jogos (para achar o gameId pelo confronto) ───────────────

function fmtDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

interface Fixture {
  id: string;
  homeName: string;
  awayName: string;
  startTime: string;
}
const FIXTURES_TTL = 5 * 60_000;
const fixturesCache = new Map<string, CacheVal<Fixture[]>>();

export async function getFixtures(centerDate: Date): Promise<Fixture[]> {
  const center = isNaN(centerDate.getTime()) ? new Date() : centerDate;
  const start = new Date(center.getTime() - 2 * 86_400_000);
  const end = new Date(center.getTime() + 2 * 86_400_000);
  const key = fmtDate(start) + '_' + fmtDate(end);
  const cached = fixturesCache.get(key);
  if (cached && Date.now() - cached.t < FIXTURES_TTL) return cached.value;

  // Brasileirão + Série B + MLS — IDs atualizados; janela curta (API zera se >~30d)
  const data = await webwsJson(
    '/web/games/?' +
      baseParams({
        competitions: COMP_DEFAULT_CLUBS,
        startDate: fmtDate(start),
        endDate: fmtDate(end),
        showOdds: 'false',
        onlyMajorGames: 'false',
      }),
  );
  const games = data?.games ?? [];
  const fixtures: Fixture[] = games.map((g: any) => ({
    id: String(g.id),
    homeName: g.homeCompetitor?.name ?? '',
    awayName: g.awayCompetitor?.name ?? '',
    startTime: g.startTime ?? '',
  }));
  fixturesCache.set(key, { value: fixtures, t: Date.now() });
  return fixtures;
}

/**
 * Corrige dateTime dos jogos no SQLite usando o horário oficial do 365scores
 * (ex.: evita 22:30 quando o jogo é 19:30 por timezone errado no scrape).
 * Retorna quantos matches foram atualizados.
 */
export async function syncKickoffsFrom365(
  matches: Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    dateTime: Date | string;
  }>,
): Promise<number> {
  if (!matches?.length) return 0;
  // Usa o meio da janela dos jogos para buscar fixtures
  const times = matches
    .map((m) => new Date(m.dateTime).getTime())
    .filter((t) => Number.isFinite(t));
  const center = times.length
    ? new Date(times.reduce((a, b) => a + b, 0) / times.length)
    : new Date();

  let fixtures: Fixture[] = [];
  try {
    fixtures = await getFixtures(center);
  } catch {
    return 0;
  }
  if (!fixtures.length) return 0;

  const { prisma } = await import('./prisma');
  let updated = 0;
  const TOL_MS = 8 * 60 * 60 * 1000; // até 8h de erro de timezone

  for (const m of matches) {
    const hs = teamSlug(m.homeTeam);
    const as = teamSlug(m.awayTeam);
    const cur = new Date(m.dateTime).getTime();
    if (!Number.isFinite(cur)) continue;

    // Preferir fixture com mesmo par de times e horário mais próximo
    let best: Fixture | null = null;
    let bestDiff = Infinity;
    for (const f of fixtures) {
      const fh = teamSlug(f.homeName);
      const fa = teamSlug(f.awayName);
      const same =
        (teamSlugMatch(fh, hs) && teamSlugMatch(fa, as)) ||
        (teamSlugMatch(fh, as) && teamSlugMatch(fa, hs));
      if (!same) continue;
      const ft = new Date(f.startTime).getTime();
      if (!Number.isFinite(ft)) continue;
      const diff = Math.abs(ft - cur);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = f;
      }
    }
    if (!best || bestDiff < 2 * 60 * 1000) continue; // já ok (<2 min)
    if (bestDiff > TOL_MS) continue;

    const fixed = new Date(best.startTime);
    try {
      await prisma.match.update({
        where: { id: m.id },
        data: { dateTime: fixed },
      });
      updated++;
      console.log(
        `[Kickoff] ${m.homeTeam} vs ${m.awayTeam}: ${new Date(m.dateTime).toISOString()} → ${fixed.toISOString()}`,
      );
    } catch {
      /* ignore */
    }
  }
  return updated;
}

export async function getStartersForMatch(
  home: string,
  away: string,
  dateTime: string | Date,
): Promise<MatchStarters | null> {
  const center = typeof dateTime === 'string' ? new Date(dateTime) : dateTime;
  const fixtures = await getFixtures(center);
  const hs = teamSlug(home);
  const as = teamSlug(away);
  const match = fixtures.find((f) => {
    const fh = teamSlug(f.homeName);
    const fa = teamSlug(f.awayName);
    return (
      (teamSlugMatch(fh, hs) && teamSlugMatch(fa, as)) ||
      (teamSlugMatch(fh, as) && teamSlugMatch(fa, hs))
    );
  });
  if (!match) return null;
  return getStartersByGameId(match.id);
}

/**
 * Aplica escalação prevista/confirmada (365scores) nos players do ranking.
 * Fonte primária do filtro "Titulares" — sobrescreve heurística de odds/histórico.
 * Timeout global evita travar a API se o 365scores falhar.
 */
export async function applyPredictedLineups(
  players: Array<{
    id: string;
    displayName?: string;
    name?: string;
    team: string;
    matchId: string;
    match?: {
      homeTeam?: string;
      awayTeam?: string;
      dateTime?: string;
    };
    isStarter?: boolean;
    starterSource?: string;
  }>,
  timeoutMs = 10_000,
): Promise<{ matchesWithLineup: number; totalMatches: number }> {
  if (!players?.length) return { matchesWithLineup: 0, totalMatches: 0 };

  const matchById = new Map<
    string,
    { homeTeam: string; awayTeam: string; dateTime: string }
  >();
  for (const p of players) {
    if (matchById.has(p.matchId) || !p.match?.homeTeam || !p.match?.awayTeam) continue;
    matchById.set(p.matchId, {
      homeTeam: p.match.homeTeam,
      awayTeam: p.match.awayTeam,
      dateTime: p.match.dateTime || new Date().toISOString(),
    });
  }

  const startersByMatch = new Map<string, MatchStarters | null>();
  await Promise.race([
    Promise.all(
      Array.from(matchById.entries()).map(async ([matchId, m]) => {
        try {
          const ms = await getStartersForMatch(m.homeTeam, m.awayTeam, m.dateTime);
          startersByMatch.set(matchId, ms);
        } catch {
          startersByMatch.set(matchId, null);
        }
      }),
    ),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);

  let matchesWithLineup = 0;
  for (const ms of startersByMatch.values()) {
    if (ms && ms.count > 0) matchesWithLineup++;
  }

  for (const p of players) {
    const ms = startersByMatch.get(p.matchId);
    if (!ms || ms.count === 0) continue;
    const name = p.displayName || p.name || '';
    p.isStarter = ms.isStarter(name, p.team);
    p.starterSource = ms.status; // 'probable' | 'confirmed'
  }

  return { matchesWithLineup, totalMatches: matchById.size };
}
