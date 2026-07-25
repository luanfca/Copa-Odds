/**
 * Cache server-side compartilhado + funções de invalidação.
 * 
 * Separado dos route handlers porque o Next.js 14+ não permite exports
 * customizados (não-HTTP) em arquivos de rota app/api/.../route.ts.
 * 
 * Uso:
 *   - Route handlers IMPORTAM os caches daqui
 *   - scraping/index.ts IMPORTAM as funções de invalidação daqui
 */

// ─── Cache Desarmes / Ranking ──────────────────────────────────

export const DES_TTL = 600_000; // 10 min

export interface DesCacheEntry {
  body: unknown;
  t: number;
  allComps: boolean;
}

export const desCache = new Map<string, DesCacheEntry>();

export function invalidateDesCache(): void {
  desCache.clear();
}

// ─── Cache Match (jogo individual) ────────────────────────────

export const MATCH_TTL = 60_000;
export const MATCH_TTL_PARTIAL = 6_000;
export const MAX_CACHE_SIZE = 100;
export const VO_TTL = 60_000;
export const VO_STALE_TTL = 600_000;

export interface MatchCacheEntry {
  body: unknown;
  t: number;
  full: boolean;
}

export const matchCache = new Map<string, MatchCacheEntry>();

export function invalidateMatchCache(): void {
  matchCache.clear();
}

/**
 * Limpa entradas expiradas do matchCache.
 * Deve ser chamado periodicamente (ex: a cada scrape) para evitar
 * acúmulo de entradas stale que não são removidas pelo TTL individual.
 */
export function pruneMatchCache(): void {
  const now = Date.now();
  for (const [key, entry] of matchCache.entries()) {
    const ttl = entry.full ? MATCH_TTL : MATCH_TTL_PARTIAL;
    if (now - entry.t > ttl) {
      matchCache.delete(key);
    }
  }
  // Eviction adicional: se ainda ultrapassar MAX_CACHE_SIZE, remove as mais antigas
  if (matchCache.size > MAX_CACHE_SIZE) {
    const sorted = Array.from(matchCache.entries()).sort((a, b) => a[1].t - b[1].t);
    const toRemove = matchCache.size - MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      matchCache.delete(sorted[i][0]);
    }
  }
}

// ─── Cache Value Odds ────────────────────────────────────────

export interface VoCacheEntry {
  body: unknown;
  t: number;
}

export let voCache: VoCacheEntry | null = null;
export let voRevalidating = false;

export function invalidateVoCache(): void {
  voCache = null;
}

export function setVoCache(body: unknown, t: number): void {
  voCache = { body, t };
}

export function setVoRevalidating(v: boolean): void {
  voRevalidating = v;
}
