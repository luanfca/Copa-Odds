import { chromium, type BrowserContext } from 'playwright';
import { scrapeBetfair } from '../src/scraping/betfairAdapter';
import { scrapePitaco } from '../src/scraping/pitaco';

const contextOptions = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1440, height: 900 },
};

async function run(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  name: string,
  scraper: (context: BrowserContext) => Promise<any[]>,
) {
  const context = await browser.newContext(contextOptions);
  try {
    const started = Date.now();
    const matches = await scraper(context);
    const odds = matches.flatMap((match) => match.odds ?? []);
    const byMarket = odds.reduce<Record<string, number>>((acc, odd) => {
      acc[odd.market] = (acc[odd.market] ?? 0) + 1;
      return acc;
    }, {});
    console.log(JSON.stringify({
      source: name,
      durationMs: Date.now() - started,
      matches: matches.length,
      odds: odds.length,
      byMarket,
      sample: odds.slice(0, 5),
    }));
    return matches.length > 0 && odds.length > 0;
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR'],
  });
  try {
    const only = process.env.VERIFY_SOURCE?.toLowerCase();
    const pitacoOk = only === 'betfair' || await run(
        browser,
        'Pitaco',
        (context) => scrapePitaco(context, ['brasileirao']),
      );
    const betfairOk = only === 'pitaco' || await run(
        browser,
        'Betfair',
        async (context) => {
          if (process.env.SIMULATE_BETFAIR_REDIRECT === '1') {
            await context.route('https://www.betfair.bet.br/**', (route) =>
              route.fulfill({
                status: 200,
                contentType: 'text/html',
                body: '<html><body>Central de ajuda Betfair</body></html>',
              }),
            );
          }
          return scrapeBetfair(context, ['brasileirao']);
        },
      );
    if (!pitacoOk || !betfairOk) {
      throw new Error(`Fontes sem linhas: Pitaco=${pitacoOk}, Betfair=${betfairOk}`);
    }
  } finally {
    await browser.close();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
