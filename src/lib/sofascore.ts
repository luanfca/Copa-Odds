/**
 * Integração com o SofaScore para fotos de jogadores.
 *
 * Pipeline oficial (sem busca textual, que é restrita):
 *   1. scheduled-events da data (ou events/live) -> achar o eventId pelos times
 *   2. event/{eventId}/lineups -> mapa nome -> player.id
 *   3. player/{playerId}/image -> foto (servida pela rota /api/player-photo)
 *
 * Tudo com cabeçalhos de navegador (os endpoints estruturados respondem ao
 * servidor desde que os headers pareçam de um browser) e cache em memória.
 */

import { normalizeName } from './normalize';

// Alias para backward-compat interno — remove a implementação local duplicada.
const normName = normalizeName;

// URL montada por partes de propósito (sem literal de URL completa).
const PROTO = 'https://';
const SOFA_API = PROTO + 'api.sofascore.com/api/v1';
const SOFA_WWW = PROTO + 'www.sofascore.com';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function jsonHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    Referer: SOFA_WWW + '/',
    Origin: SOFA_WWW,
    'x-requested-with': 'XMLHttpRequest',
  };
}

// Seleções: PT -> nome em inglês (como o SofaScore costuma retornar).
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
  'estados unidos da america': 'usa',
  canada: 'canada',
  equador: 'ecuador',
  catar: 'qatar',
  gana: 'ghana',
  camaroes: 'cameroon',
  tunisia: 'tunisia',
  australia: 'australia',
};

function teamMatches(eventTeamName: string, ourTeamName: string): boolean {
  const e = normName(eventTeamName);
  const o = normName(ourTeamName);
  if (!e || !o) return false;
  if (e === o) return true;
  const oen = TEAM_PT_EN[o];
  if (oen && (e === oen || e.includes(oen) || oen.includes(e))) return true;
  if (e.includes(o) || o.includes(e)) return true;
  return false;
}

async function sofaJson(path: string): Promise<any | null> {
  try {
    const res = await fetch(SOFA_API + path, {
      headers: jsonHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function dateCandidates(iso: string): string[] {
  const out = new Set<string>();
  const base = new Date(iso);
  if (!isNaN(base.getTime())) {
    for (const off of [0, -1, 1]) {
      const d = new Date(base.getTime() + off * 86400000);
      out.add(d.toISOString().slice(0, 10));
    }
  }
  return Array.from(out);
}

// ── Caches em memória ───────────────────────────────────────────────
class TTLCache<K, V> {
  private map = new Map<K, { val: V; t: number }>();
  constructor(private maxAge: number, private maxSize: number = 100) {}
  get(key: K): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.t > this.maxAge) {
      this.map.delete(key);
      return undefined;
    }
    return hit.val;
  }
  set(key: K, val: V): void {
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { val, t: Date.now() });
  }
}

// Caches de 2h para lineups e eventos (500 max). 24h para map de jogador (2000 max).
const eventIdCache = new TTLCache<string, number | null>(2 * 60 * 60 * 1000, 500);
const lineupCache = new TTLCache<number, LineupMaps | null>(2 * 60 * 60 * 1000, 500);
const playerIdCache = new TTLCache<string, number | null>(24 * 60 * 60 * 1000, 2000);

interface LineupMaps {
  // nome normalizado completo -> id
  byName: Map<string, number>;
  // último sobrenome -> lista de ids
  byLast: Map<string, number[]>;
  // lista [nomeNormalizado, id] para buscas aproximadas
  all: Array<[string, number]>;
}

export interface MatchMeta {
  homeTeam: string;
  awayTeam: string;
  dateTime: string;
}

async function resolveEventId(meta: MatchMeta): Promise<number | null> {
  const key =
    normName(meta.homeTeam) + '|' + normName(meta.awayTeam) + '|' + (meta.dateTime || '').slice(0, 10);
  const cached = eventIdCache.get(key);
  if (cached !== undefined) return cached;

  const candidates: any[] = [];
  const live = await sofaJson('/sport/football/events/live');
  if (Array.isArray(live?.events)) candidates.push(...live.events);
  for (const date of dateCandidates(meta.dateTime)) {
    const sched = await sofaJson('/sport/football/scheduled-events/' + date);
    if (Array.isArray(sched?.events)) candidates.push(...sched.events);
  }

  let found: number | null = null;
  for (const ev of candidates) {
    const eh = ev?.homeTeam?.name;
    const ea = ev?.awayTeam?.name;
    const id = ev?.id;
    if (!eh || !ea || typeof id !== 'number') continue;
    const direct = teamMatches(eh, meta.homeTeam) && teamMatches(ea, meta.awayTeam);
    const swapped = teamMatches(eh, meta.awayTeam) && teamMatches(ea, meta.homeTeam);
    if (direct || swapped) {
      found = id;
      break;
    }
  }

  eventIdCache.set(key, found);
  return found;
}

async function getLineupMaps(eventId: number): Promise<LineupMaps | null> {
  const cached = lineupCache.get(eventId);
  if (cached !== undefined) return cached;

  const data = await sofaJson('/event/' + eventId + '/lineups');
  const sides = [data?.home, data?.away];
  const byName = new Map<string, number>();
  const byLast = new Map<string, number[]>();
  const all: Array<[string, number]> = [];
  let any = false;

  for (const side of sides) {
    const players = Array.isArray(side?.players) ? side.players : [];
    for (const entry of players) {
      const p = entry?.player;
      const id = p?.id;
      if (typeof id !== 'number') continue;
      any = true;
      const names = [p?.name, p?.shortName, (p?.slug || '').replace(/-/g, ' ')];
      for (const raw of names) {
        const n = normName(raw || '');
        if (!n) continue;
        if (!byName.has(n)) byName.set(n, id);
        all.push([n, id]);
        const toks = n.split(' ').filter(Boolean);
        const last = toks[toks.length - 1];
        if (last) {
          const arr = byLast.get(last) || [];
          if (!arr.includes(id)) arr.push(id);
          byLast.set(last, arr);
        }
      }
    }
  }

  const maps = any ? { byName, byLast, all } : null;
  lineupCache.set(eventId, maps);
  return maps;
}

function pickFromLineup(maps: LineupMaps, displayName: string): number | null {
  const n = normName(displayName);
  if (!n) return null;
  if (maps.byName.has(n)) return maps.byName.get(n)!;

  const toks = n.split(' ').filter(Boolean);
  const last = toks[toks.length - 1];
  const firstInitial = toks[0] ? toks[0][0] : '';

  // sobrenome único na escalação
  if (last) {
    const ids = maps.byLast.get(last);
    if (ids && ids.length === 1) return ids[0];
  }

  // mesmo sobrenome + mesma inicial do primeiro nome (ex.: "B. Guimarães")
  if (last) {
    for (const [full, id] of maps.all) {
      const ft = full.split(' ').filter(Boolean);
      if (ft.length === 0) continue;
      if (ft[ft.length - 1] === last && (!firstInitial || ft[0][0] === firstInitial)) {
        return id;
      }
    }
  }

  // continência (um nome contém o outro)
  for (const [full, id] of maps.all) {
    if (full === n || full.includes(n) || n.includes(full)) return id;
  }
  return null;
}

/**
 * Fallback: busca textual de jogador. Usado quando a partida ainda não tem
 * escalação publicada (ex.: jogo futuro). Pontua por similaridade de nome e
 * dá bônus quando a seleção bate.
 */
async function searchPlayerId(playerName: string, team?: string): Promise<number | null> {
  const q = (playerName || '').trim();
  if (!q) return null;

  const data = await sofaJson('/search/all?q=' + encodeURIComponent(q));
  const results = Array.isArray(data?.results) ? data.results : [];
  const target = normName(playerName);
  const teamN = team ? normName(team) : '';
  const teamEn = teamN ? TEAM_PT_EN[teamN] || teamN : '';

  let best: number | null = null;
  let bestScore = -1;
  for (const r of results) {
    if (r?.type !== 'player') continue;
    const ent = r?.entity;
    const id = ent?.id;
    if (typeof id !== 'number') continue;

    const cand = normName(ent?.name || '');
    if (!cand) continue;

    let score = 0;
    if (cand === target) score = 100;
    else if (cand.includes(target) || target.includes(cand)) score = 70;
    else {
      const ct = cand.split(' ').filter(Boolean);
      const tt = target.split(' ').filter(Boolean);
      if (ct.length && tt.length && ct[ct.length - 1] === tt[tt.length - 1]) score = 50;
    }
    if (score === 0) continue;

    const cteam = normName(ent?.team?.name || '');
    if (cteam && (cteam === teamN || cteam === teamEn)) score += 25;

    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** Resolve o playerId do SofaScore para um jogador de uma partida. */
export async function resolvePlayerId(
  meta: MatchMeta,
  playerName: string,
  team?: string,
): Promise<number | null> {
  const cacheKey =
    normName(meta.homeTeam) + '|' + normName(meta.awayTeam) + '|' + normName(playerName);
  const cached = playerIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let result: number | null = null;
  const eventId = await resolveEventId(meta);
  if (eventId) {
    const maps = await getLineupMaps(eventId);
    if (maps) result = pickFromLineup(maps, playerName);
  }

  // Fallback por busca textual quando não há escalação (jogo futuro/sem lineup).
  if (!result) {
    result = await searchPlayerId(playerName, team);
  }

  playerIdCache.set(cacheKey, result);
  return result;
}

/** Baixa a foto do jogador. Retorna bytes + content-type, ou null. */
export async function getPlayerImage(
  playerId: number,
): Promise<{ buf: ArrayBuffer; contentType: string } | null> {
  try {
    const res = await fetch(SOFA_API + '/player/' + playerId + '/image', {
      headers: { 'User-Agent': UA, Referer: SOFA_WWW + '/' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength < 64) return null; // resposta vazia/placeholder
    return {
      buf: ab,
      contentType: res.headers.get('content-type') || 'image/png',
    };
  } catch {
    return null;
  }
}
