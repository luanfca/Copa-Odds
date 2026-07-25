/**
 * Cache persistente via SQLite (Prisma).
 *
 *  1. TeamEvents   — lista de jogos do time (TTL curto: detectar jogo novo)
 *  2. PlayerStats   — stats por eventId (permanente: jogo finalizado não muda)
 *  3. PlayerHistory — histórico do jogador (permanente; só atualiza com jogo novo)
 */

import { prisma } from './prisma';
import type { SofaTeamEvent } from './sofascoreStats';
import type { PlayerHistory } from './sofascoreStats';

// ─── TTLs ──────────────────────────────────────────────────────────────────

/** Lista de jogos do time: renovar para perceber rodada nova (ex.: Palmeiras no fim de semana). */
const TEAM_EVENTS_TTL_MS = 3 * 60 * 60 * 1000; // 3h
/** Stats de jogo finalizado: permanentes (não expiram). */
const PLAYER_STATS_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 ano (prático: permanente)
/** Miss vazio de histórico: re-tenta após este tempo. Histórico COM dados nunca expira. */
const PLAYER_HISTORY_EMPTY_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const PRUNE_INTERVAL_MS = 30 * 60 * 1000; // 30 min
let lastPrune = 0;

// ─── Prune automático ──────────────────────────────────────────────────────

async function pruneExpired(): Promise<void> {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  try {
    const teamCutoff = new Date(now - TEAM_EVENTS_TTL_MS);
    // NÃO apaga cache_player_history com dados — só team events antigos.
    // Player stats / history com conteúdo ficam no banco.
    await prisma.cacheTeamEvents.deleteMany({ where: { createdAt: { lt: teamCutoff } } });
  } catch { /* best-effort */ }
}

// ─── TeamEvents ────────────────────────────────────────────────────────────

export async function getCacheTeamEvents(cacheKey: string): Promise<SofaTeamEvent[] | null> {
  try {
    const row = await prisma.cacheTeamEvents.findUnique({ where: { cacheKey } });
    if (!row) return null;
    const age = Date.now() - row.createdAt.getTime();
    if (age > TEAM_EVENTS_TTL_MS) {
      await prisma.cacheTeamEvents.delete({ where: { cacheKey } }).catch(() => {});
      return null;
    }
    return JSON.parse(row.data) as SofaTeamEvent[];
  } catch {
    return null;
  }
}

export async function setCacheTeamEvents(cacheKey: string, data: SofaTeamEvent[]): Promise<void> {
  try {
    await prisma.cacheTeamEvents.upsert({
      where: { cacheKey },
      // Renova createdAt no update para o TTL não “congelar”
      update: { data: JSON.stringify(data), createdAt: new Date() },
      create: { cacheKey, data: JSON.stringify(data) },
    });
    pruneExpired().catch(() => {});
  } catch { /* best-effort */ }
}

// ─── PlayerStats ───────────────────────────────────────────────────────────

export async function getCachePlayerStats(eventId: number): Promise<any | null> {
  try {
    const row = await prisma.cachePlayerStats.findUnique({ where: { eventId } });
    if (!row) return null;
    // Jogo finalizado: nunca expira (só limpa se absurdamente antigo)
    const age = Date.now() - row.createdAt.getTime();
    if (age > PLAYER_STATS_TTL_MS) {
      await prisma.cachePlayerStats.delete({ where: { eventId } }).catch(() => {});
      return null;
    }
    return JSON.parse(row.data);
  } catch {
    return null;
  }
}

export async function setCachePlayerStats(eventId: number, data: any): Promise<void> {
  try {
    await prisma.cachePlayerStats.upsert({
      where: { eventId },
      // NÃO renova createdAt: stats imutáveis de jogo já finalizado
      update: { data: JSON.stringify(data) },
      create: { eventId, data: JSON.stringify(data) },
    });
  } catch { /* best-effort */ }
}

// ─── PlayerHistory (permanente no banco; refresh só com jogo novo) ─────────

export async function getCachePlayerHistory(cacheKey: string): Promise<PlayerHistory | null> {
  try {
    const row = await prisma.cachePlayerHistory.findUnique({ where: { cacheKey } });
    if (!row) return null;
    const data = JSON.parse(row.data) as PlayerHistory;
    const hasEntries = Array.isArray(data?.entries) && data.entries.length > 0;
    if (hasEntries) {
      // Histórico com dados: SEMPRE válido (atualização incremental é em getPlayerHistory)
      return data;
    }
    // Miss vazio: re-tenta depois do TTL (jogador pode ter estreado)
    const age = Date.now() - row.createdAt.getTime();
    if (age > PLAYER_HISTORY_EMPTY_TTL_MS) {
      await prisma.cachePlayerHistory.delete({ where: { cacheKey } }).catch(() => {});
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export async function setCachePlayerHistory(cacheKey: string, data: PlayerHistory): Promise<void> {
  try {
    const hasEntries = Array.isArray(data?.entries) && data.entries.length > 0;
    await prisma.cachePlayerHistory.upsert({
      where: { cacheKey },
      update: {
        data: JSON.stringify(data),
        market: data.market,
        // Só renova createdAt em miss vazio (para TTL de re-tentativa)
        ...(hasEntries ? {} : { createdAt: new Date() }),
      },
      create: { cacheKey, market: data.market, data: JSON.stringify(data) },
    });
    pruneExpired().catch(() => {});
  } catch { /* best-effort */ }
}

// ─── Invalidação ───────────────────────────────────────────────────────────

export async function invalidateAllCaches(): Promise<void> {
  await Promise.all([
    prisma.cacheTeamEvents.deleteMany(),
    prisma.cachePlayerStats.deleteMany(),
    prisma.cachePlayerHistory.deleteMany(),
  ]);
}
