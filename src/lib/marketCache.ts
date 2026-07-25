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
// TTL curto: após scrape o ranking precisa atualizar sem hard refresh
const TTL_MS = 60_000; // 60s
// Bump invalida cache client de sessões antigas (evita colunas bet365/betsson e mercado trocado)
const CACHE_VER = 'v10-bf-3plus';

function buildKey(
  market: string,
  allComps: boolean,
  opts?: { maxGames?: number; year?: number; historyScope?: string },
): string {
  return `${CACHE_VER}_${market}_${allComps}_${opts?.maxGames ?? 10}_${opts?.year ?? 'cur'}_${opts?.historyScope ?? 'league'}`;
}

export function getCachedMarket(
  market: string,
  allComps: boolean,
  opts?: { maxGames?: number; year?: number; historyScope?: string },
): unknown | null {
  const key = buildKey(market, allComps, opts);
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.allComps !== allComps) return null;
  if (Date.now() - entry.t > TTL_MS) return null;
  return entry.data;
}

export function setCachedMarket(
  market: string,
  data: unknown,
  allComps: boolean,
  opts?: { maxGames?: number; year?: number; historyScope?: string },
): void {
  const key = buildKey(market, allComps, opts);
  store.set(key, { data, t: Date.now(), allComps });
}

export function invalidateMarket(market?: string): void {
  if (!market) {
    store.clear();
    return;
  }
  // Keys são `${CACHE_VER}_${marketKey}_...` — procura o trecho do mercado
  for (const k of store.keys()) {
    if (k.includes(`_${market}_`) || k.includes(market)) store.delete(k);
  }
}

export function clearAllMarketCache(): void {
  store.clear();
}
