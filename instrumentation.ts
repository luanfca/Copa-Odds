/**
 * instrumentation.ts — Executado UMA VEZ ao iniciar o servidor Next.js.
 * Inicia o cron job e roda o scraping inicial se o banco estiver vazio.
 */

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initCron } = await import('./src/lib/cron');
    initCron();

    // Scraping inicial se SCRAPE_ON_START=true
    if (process.env.SCRAPE_ON_START === 'true') {
      const { prisma } = await import('./src/lib/prisma');
      const { logger } = await import('./src/lib/logger');

      try {
        const matchCount = await prisma.match.count();

        if (matchCount === 0) {
          logger.info('Banco vazio — executando scraping inicial...');

          // Delay de 3s para o servidor inicializar completamente
          setTimeout(async () => {
            const { scrapeAll } = await import('./src/scraping/index');
            await scrapeAll().catch(err =>
              logger.error('Scraping inicial falhou:', { error: String(err) })
            );
          }, 3000);
        } else {
          logger.info(`Banco já populado (${matchCount} jogos). Scraping inicial ignorado.`);
        }
      } catch (error) {
        logger.warn('Erro ao verificar banco:', { error: String(error) });
      }
    }
  }
}
