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
      // Se este processo sabe que há uma coleta ativa, preserva o lock.
      if (isRunning && age < STALE_LOCK_MS) {
        return false;
      }

      // Memória livre + DB "running" significa que o contêiner que iniciou
      // aquela coleta foi reiniciado. Recupera imediatamente; esperar 45 min
      // faria a agenda diária falhar depois de qualquer deploy.
      await prisma.scrapeLog.update({
        where: { id: last.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          errorMsg:
            age >= STALE_LOCK_MS
              ? 'Lock expirado (stale running)'
              : 'Coleta interrompida por reinicialização do serviço',
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
