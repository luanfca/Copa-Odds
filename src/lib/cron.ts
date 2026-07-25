/**
 * Gerenciamento de estado do scraping (memória + lock em DB).
 *
 * O flag in-memory cobre o processo atual; o lock em scrapeLog cobre
 * multi-worker Next.js e restart no meio de um scrape.
 */

import { prisma } from './prisma';

let isRunning = false;

/** Stale lock: se um scrape ficou "running" por mais de 45 min, libera. */
const STALE_LOCK_MS = 45 * 60 * 1000;

export function isScrapeRunning() {
  return isRunning;
}

export function setScrapeRunning(val: boolean) {
  isRunning = val;
}

/**
 * Tenta adquirir lock global via último ScrapeLog.
 * Retorna false se já houver scrape "running" recente.
 */
export async function tryAcquireScrapeLock(): Promise<boolean> {
  try {
    const last = await prisma.scrapeLog.findFirst({
      orderBy: { startedAt: 'desc' },
      select: { id: true, status: true, startedAt: true },
    });

    if (last?.status === 'running') {
      const age = Date.now() - last.startedAt.getTime();
      if (age < STALE_LOCK_MS) {
        isRunning = true;
        return false;
      }
      // Stale: marca como failed e permite novo scrape
      await prisma.scrapeLog.update({
        where: { id: last.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMsg: 'Lock expirado (stale running)',
        },
      }).catch(() => null);
    }
    return true;
  } catch {
    // Se o DB falhar, ainda permite (o flag in-memory continua)
    return true;
  }
}

export async function releaseScrapeLock(): Promise<void> {
  // O próprio scrapeAll atualiza o log final; nada a limpar aqui.
  // Mantido para API simétrica e futura extensão (file lock, redis, etc.).
}
