/**
 * Scraper de stats de time via Flashscore.
 * Usa busca para encontrar o time, depois pega stats dos jogos da Copa.
 */
import { chromium, BrowserContext } from 'playwright';
import { logger } from '../lib/logger';

interface TeamStatResult {
  team: string;
  market: string;
  avgValue: number;
  gamesPlayed: number;
}

const statCache = new Map<string, TeamStatResult>();

export async function getTeamStatsFromFlashscore(
  context: BrowserContext,
  teamName: string,
  market: 'desarmes' | 'faltas_cometidas' | 'faltas_sofridas',
): Promise<TeamStatResult | null> {
  const cacheKey = `${teamName}::${market}`;
  if (statCache.has(cacheKey)) return statCache.get(cacheKey)!;

  const page = await context.newPage();
  try {
    // 1) Busca o time no Flashscore
    await page.goto('https://www.flashscore.com.br/', { waitUntil: 'load', timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const accept = btns.find(b => (b.textContent || '').toLowerCase().includes('aceitar'));
      if (accept) accept.click();
    });
    await page.waitForTimeout(2000);

    // Clica no ícone de busca
    const searchBtn = page.locator('[class*="search"], [aria-label*="busca"], [aria-label*="search"]').first();
    if (await searchBtn.count() > 0) {
      await searchBtn.click();
      await page.waitForTimeout(1000);
    }

    // Preenche busca
    const searchInput = page.locator('input[type="search"], input[placeholder*="buscar"], input[placeholder*="Buscar"]').first();
    if (await searchInput.count() > 0) {
      await searchInput.fill(teamName);
      await page.waitForTimeout(2000);

      // Clica no primeiro resultado do time
      const teamLink = page.locator(`a:has-text("${teamName}")`).first();
      if (await teamLink.count() > 0) {
        await teamLink.click();
        await page.waitForTimeout(5000);

        // 2) Clica em "Resultados"
        await page.locator('text=/Resultados/i').first().click().catch(() => null);
        await page.waitForTimeout(5000);

        // 3) Encontra jogos da Copa
        const allLinks = await page.locator('a').all();
        const gameUrls: string[] = [];
        for (const link of allLinks) {
          const href = await link.getAttribute('href');
          if (href && href.includes('/jogo/') && href.includes('futebol')) {
            const fullUrl = href.startsWith('http') ? href : `https://www.flashscore.com.br${href}`;
            gameUrls.push(fullUrl);
          }
        }

        logger.info(`[Flashscore] ${gameUrls.length} jogos encontrados para ${teamName}`);

        // 4) Para cada jogo, pega stats
        let totalValue = 0;
        let gamesWithStats = 0;

        for (const gameUrl of gameUrls.slice(0, 5)) {
          try {
            const statsUrl = gameUrl.includes('estatisticas') ? gameUrl : gameUrl.replace('/resumo/', '/resumo/estatisticas/total/');
            await page.goto(statsUrl, { waitUntil: 'load', timeout: 15000 });
            await page.waitForTimeout(8000);

            const statsText = await page.evaluate(() => document.body.innerText);
            const lines = statsText.split('\n').map(l => l.trim());

            let value = 0;
            if (market === 'desarmes') {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i] === 'Desarmes' && i >= 2) {
                  const m = lines[i - 1]?.match(/\((\d+)\/(\d+)\)/);
                  if (m) value = parseInt(m[2]);
                  break;
                }
              }
            } else if (market === 'faltas_cometidas') {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i] === 'Faltas' && i >= 1) {
                  value = parseInt(lines[i - 1]);
                  break;
                }
              }
            } else if (market === 'faltas_sofridas') {
              for (let i = 0; i < lines.length; i++) {
                if (lines[i] === 'Faltas' && i + 1 < lines.length) {
                  value = parseInt(lines[i + 1] ?? '0');
                  break;
                }
              }
            }

            if (value > 0) {
              totalValue += value;
              gamesWithStats++;
            }
          } catch {}
        }

        const avgValue = gamesWithStats > 0 ? Math.round(totalValue / gamesWithStats * 10) / 10 : 0;
        const result: TeamStatResult = { team: teamName, market, avgValue, gamesPlayed: gamesWithStats };
        statCache.set(cacheKey, result);
        logger.info(`[Flashscore] ${teamName} ${market}: ${avgValue} (${gamesWithStats} jogos)`);
        return result;
      }
    }

    logger.warn(`[Flashscore] Não encontrou time "${teamName}"`);
    return null;

  } catch (error) {
    logger.error(`[Flashscore] Erro para ${teamName}:`, { error: String(error) });
    return null;
  } finally {
    await page.close().catch(() => null);
  }
}
