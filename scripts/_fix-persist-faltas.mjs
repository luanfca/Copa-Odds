/**
 * Scrape Betfair (1 match) → persist → purge old → verify Wallisson/Luighi faltas in DB.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { PrismaClient } from '@prisma/client';

const ROOT = path.resolve('.');
process.env.BETFAIR_MAX_MATCHES = '1';
process.env.BETFAIR_PROFILE = 'full';
process.env.BETFAIR_CONCURRENCY = '1';

const { scrapeBetfair } = await import(
  pathToFileURL(path.join(ROOT, 'src/scraping/betfairAdapter.ts')).href
);
const { persistScrapedData } = await import(
  pathToFileURL(path.join(ROOT, 'src/scraping/index.ts')).href
);

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--lang=pt-BR'],
});
const sessionPath = path.join(ROOT, '.playwright-sessions', 'betfair-session.json');
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

console.log('=== scrape ===');
const results = await scrapeBetfair(ctx, ['brasileirao']);

// In-memory faltas for Coritiba-ish
const mem = {};
for (const m of results) {
  for (const o of m.odds || []) {
    if (o.market !== 'faltas_cometidas' || o.house !== 'betfair') continue;
    const n = o.playerName;
    if (!mem[n]) mem[n] = {};
    mem[n][o.line] = o.value; // last wins within results order
  }
}
const pick = (re) => Object.entries(mem).find(([n]) => re.test(n));
console.log('MEM Wallisson', pick(/wallisson/i));
console.log('MEM Luighi', pick(/luighi/i));
console.log('MEM Fernando', pick(/sobral/i));

console.log('=== persist ===');
const started = new Date();
const stats = await persistScrapedData(results);
console.log('persisted', stats);

const p = new PrismaClient();
// Remove betfair faltas older than this scrape for players we care about
const cutoff = new Date(started.getTime() - 1000);
const old = await p.oddSnapshot.deleteMany({
  where: {
    house: 'betfair',
    market: 'faltas_cometidas',
    collectedAt: { lt: cutoff },
  },
});
console.log('deleted old betfair faltas', old.count);

// Rebuild ranking cache
try {
  const { clearApiSnapshots, rebuildApiSnapshots } = await import(
    pathToFileURL(path.join(ROOT, 'src/lib/apiSnapshot.ts')).href
  );
  await clearApiSnapshots();
  await rebuildApiSnapshots();
  console.log('api snapshots rebuilt');
} catch (e) {
  console.log('snapshot rebuild warn', e?.message || e);
}

const rows = await p.oddSnapshot.findMany({
  where: {
    house: 'betfair',
    market: 'faltas_cometidas',
    collectedAt: { gte: cutoff },
  },
  include: { player: true },
  orderBy: { collectedAt: 'desc' },
});
const db = {};
for (const o of rows) {
  const n = o.player?.name || '';
  if (!db[n]) db[n] = {};
  if (db[n][o.line] == null) db[n][o.line] = o.value;
}
const w = Object.entries(db).find(([n]) => /wallisson/i.test(n));
const l = Object.entries(db).find(([n]) => /luighi/i.test(n));
const f = Object.entries(db).find(([n]) => /sobral/i.test(n));
console.log('DB Wallisson', w);
console.log('DB Luighi', l);
console.log('DB Fernando', f);

// Expected shape from live UI
const okW =
  w &&
  w[1]['1+'] > 1 &&
  w[1]['1+'] < w[1]['2+'] &&
  w[1]['2+'] < w[1]['3+'] &&
  Math.abs(w[1]['1+'] - 1.06) < 0.05 &&
  Math.abs(w[1]['2+'] - 1.36) < 0.15 &&
  Math.abs(w[1]['3+'] - 2.3) < 0.3;

console.log(okW ? 'ASSERT DB Wallisson-like PASS' : 'ASSERT DB Wallisson-like FAIL');
console.log('Wallisson detail', w?.[1]);

await p.$disconnect();
try {
  await ctx.storageState({ path: sessionPath });
} catch {
  /* */
}
await browser.close();
process.exit(okW ? 0 : 1);
