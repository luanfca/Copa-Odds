/**
 * Cache compartilhado de histórico de jogadores.
 *
 * L1: Map in-memory com TTL e limite de tamanho
 * L2: SQLite (persistente entre restarts)
 */

import type { PlayerHistory } from './sofascoreStats';
import { getCachePlayerHistory, setCachePlayerHistory } from './sqliteCache';

// L1 só acelera o processo; a verdade está no SQLite (permanente)
const L1_TTL_MS = 2 * 60 * 60_000; // 2h
const L1_MAX = 2500;

interface L1Entry {
  data: PlayerHistory;
  t: number;
}

const SHARED_HISTORY_CACHE = new Map<string, L1Entry>();

function pruneL1(): void {
  const now = Date.now();
  for (const [k, v] of SHARED_HISTORY_CACHE) {
    if (now - v.t > L1_TTL_MS) SHARED_HISTORY_CACHE.delete(k);
  }
  if (SHARED_HISTORY_CACHE.size > L1_MAX) {
    const sorted = Array.from(SHARED_HISTORY_CACHE.entries()).sort((a, b) => a[1].t - b[1].t);
    const remove = SHARED_HISTORY_CACHE.size - L1_MAX;
    for (let i = 0; i < remove; i++) SHARED_HISTORY_CACHE.delete(sorted[i][0]);
  }
}

/** @deprecated use getSharedHistory — export mantido para compat */
export { SHARED_HISTORY_CACHE };

export async function getSharedHistory(key: string): Promise<PlayerHistory | null> {
  const l1 = SHARED_HISTORY_CACHE.get(key);
  if (l1) {
    if (Date.now() - l1.t < L1_TTL_MS) return l1.data;
    SHARED_HISTORY_CACHE.delete(key);
  }

  const l2 = await getCachePlayerHistory(key);
  if (l2) {
    SHARED_HISTORY_CACHE.set(key, { data: l2, t: Date.now() });
    pruneL1();
    return l2;
  }

  return null;
}

export async function setSharedHistory(key: string, data: PlayerHistory): Promise<void> {
  SHARED_HISTORY_CACHE.set(key, { data, t: Date.now() });
  pruneL1();
  await setCachePlayerHistory(key, data);
}

export function clearSharedHistoryL1(): void {
  SHARED_HISTORY_CACHE.clear();
}
