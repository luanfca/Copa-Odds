/**
 * Cache client-side de respostas de mercado por tipo.
 * Evita re-buscar a API ao trocar entre abas (desarmes, faltas, etc.).
 */

interface CacheEntry {
  data: unknown;
  t: number;
  allComps: boolean;
}

const store = new Map<string, CacheEntry>();
const TTL_MS = 60_000; // 60s — alinhado com DES_TTL do server-side

export function getCachedMarket(market: string, allComps: boolean): unknown | null {
  const entry = store.get(market);
  if (!entry) return null;
  if (entry.allComps !== allComps) return null;
  if (Date.now() - entry.t > TTL_MS) return null;
  return entry.data;
}

export function setCachedMarket(market: string, data: unknown, allComps: boolean): void {
  store.set(market, { data, t: Date.now(), allComps });
}

export function invalidateMarket(market?: string): void {
  if (market) {
    store.delete(market);
  } else {
    store.clear();
  }
}
