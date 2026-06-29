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

/** Copa do Mundo (masculino) no 365scores. */
export const COMP_WC = '5930';

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

function initialCompatible(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
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
    if (initialCompatible(pl[0], cl[0])) return true;
    if (pl.length === 1 || cl.length === 1) return true; // ex.: "Vitinha"
    
    // Fuzzy match first names when last name matches exactly (ex.: Andy vs Andrew)
    const simFirst = 1 - levenshtein.get(pl[0], cl[0]) / Math.max(pl[0].length, cl[0].length);
    if (simFirst >= 0.5) return true;
  }

  // Todos os tokens do jogador contidos no candidato
  if (pl.every((t) => cl.includes(t))) return true;

  // Jogador de um único token (len>=4) presente no candidato
  if (pl.length === 1 && pl[0].length >= 4 && cl.includes(pl[0])) return true;

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
    if (/confirm/i.test(String(lineups.status ?? ''))) anyConfirmed = true;
    for (const lm of lineups.members) {
      if (!lm || lm.status !== 1) continue; // status 1 = titular
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

  const data = await webwsJson(
    '/web/games/?' +
      baseParams({
        competitions: COMP_WC,
        startDate: fmtDate(start),
        endDate: fmtDate(end),
        showOdds: 'false',
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
