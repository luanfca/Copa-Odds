/**
 * Scrape Betfair (brasileirão, poucos jogos) e persiste + rebuild snapshot.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

process.env.BETFAIR_MAX_MATCHES = process.env.BETFAIR_MAX_MATCHES || '8';
process.env.BETFAIR_PROFILE = 'full';
process.env.BETFAIR_CONCURRENCY = '2';

const { scrapeBetfair } = await import('../src/scraping/betfairAdapter.ts');
const { persistScrapedData } = await import('../src/scraping/index.ts');

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--lang=pt-BR'],
});
const sessionPath = path.join(process.cwd(), '.playwright-sessions', 'betfair-session.json');
const opts = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1440, height: 1100 },
};
const ctx = fs.existsSync(sessionPath)
  ? await browser.newContext({ ...opts, storageState: sessionPath })
  : await browser.newContext(opts);

console.log('Scraping Betfair...');
const t0 = Date.now();
const results = await scrapeBetfair(ctx, ['brasileirao']);
console.log(`Scraped ${results.length} match blobs in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Sanity: count finalizacao 3+==4+
let same = 0;
let ok = 0;
for (const m of results) {
  const byP = new Map();
  for (const o of m.odds || []) {
    if (o.market !== 'finalizacao') continue;
    if (!byP.has(o.playerName)) byP.set(o.playerName, {});
    byP.get(o.playerName)[o.line] = o.value;
  }
  for (const lines of byP.values()) {
    if (lines['3+'] != null && lines['4+'] != null) {
      if (!(lines['4+'] > lines['3+'])) same++;
      else ok++;
    }
  }
}
console.log({ finalizacao_3ge4: same, finalizacao_3lt4: ok });

console.log('Persisting...');
const stats = await persistScrapedData(results);
console.log('persist', stats);

try {
  const { rebuildApiSnapshots, purgeOldOdds } = await import('../src/lib/apiSnapshot.ts');
  const purged = await purgeOldOdds(new Date(t0 - 60_000), ['betfair']);
  console.log('purged old betfair odds', purged);
  await rebuildApiSnapshots();
  console.log('snapshots rebuilt');
} catch (e) {
  console.warn('snapshot rebuild failed', e);
}

await browser.close();
console.log('DONE');
