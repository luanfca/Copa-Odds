/**
 * Cron job para agendamento diário do scraping.
 * Iniciado uma única vez ao subir o servidor (em instrumentation.ts).
 */

import cron from 'node-cron';
import { logger } from './logger';

let isInitialized = false;
let isRunning = false;

export function initCron() {
  if (isInitialized) return;
  isInitialized = true;

  const schedule = process.env.CRON_SCHEDULE || '0 11 * * *'; // 08:00 Brasília = 11:00 UTC

  logger.info(`Cron configurado: ${schedule}`);

  cron.schedule(schedule, async () => {
    if (isRunning) {
      logger.warn('Scraping já em execução, pulando...');
      return;
    }

    isRunning = true;
    logger.info('Cron disparado — iniciando scraping...');

    try {
      // Import dinâmico para evitar carregar Playwright no cliente
      const { scrapeAll } = await import('../scraping/index');
      const result = await scrapeAll();

      logger.info('Scraping concluído:', {
        success: result.success,
        matches: result.matchCount,
        players: result.playerCount,
        odds: result.oddCount,
      });
    } catch (error) {
      logger.error('Erro no scraping diário:', { error: String(error) });
    } finally {
      isRunning = false;
    }
  }, {
    timezone: 'America/Sao_Paulo',
  });

  logger.info('Cron job inicializado.');
}

export function isScrapeRunning() {
  return isRunning;
}

export function setScrapeRunning(val: boolean) {
  isRunning = val;
}
