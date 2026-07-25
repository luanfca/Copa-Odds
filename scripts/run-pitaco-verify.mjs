import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const SCRATCH =
  process.env.GOAL_SCRATCH ||
  'C:/Users/LuanADM/AppData/Local/Temp/grok-goal-cb5f7204be54/implementer';
fs.mkdirSync(SCRATCH, { recursive: true });
const logf = path.join(SCRATCH, 'pitaco-scrape.log');
const w = (m) => {
  const s = typeof m === 'string' ? m : JSON.stringify(m, null, 2);
  fs.appendFileSync(logf, s + '\n');
  console.log(s);
};
fs.writeFileSync(logf, `=== Pitaco verify ${new Date().toISOString()} ===\n`);

const { scrapePitaco } = await import(pathToFileURL(path.resolve('src/scraping/pitaco.ts')).href);
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--lang=pt-BR'],
});
const sp = path.join('.playwright-sessions', 'pitaco-session.json');
const opts = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  viewport: { width: 1440, height: 900 },
};
let ctx;
try {
  ctx = fs.existsSync(sp)
    ? await browser.newContext({ ...opts, storageState: sp })
    : await browser.newContext(opts);
} catch {
  ctx = await browser.newContext(opts);
}

const results = await scrapePitaco(ctx, ['brasileirao']);
const odds = results.flatMap((m) => m.odds || []);
const fin = odds.filter((o) => o.market === 'finalizacao');
const sot = odds.filter((o) => o.market === 'chutes_ao_gol');
const fl = {},
  sl = {};
for (const o of fin) fl[o.line] = (fl[o.line] || 0) + 1;
for (const o of sot) sl[o.line] = (sl[o.line] || 0) + 1;
w({ matches: results.length, fin: fin.length, sot: sot.length, fl, sl, house: odds[0]?.house });
const ok = fin.length > 0 && sot.length > 0 && (fl['1+'] || 0) > 0 && (fl['2+'] || 0) > 0;
w('ASSERT pitaco: ' + (ok ? 'PASS' : 'FAIL'));
if (results.length) {
  const { persistScrapedData } = await import(
    pathToFileURL(path.resolve('src/scraping/index.ts')).href
  );
  w({ persisted: await persistScrapedData(results) });
}
try {
  await ctx.storageState({ path: sp });
} catch {
  /* */
}
await browser.close();

// Ranking/DB sample refresh
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();
const kaio = await prisma.oddSnapshot.findMany({
  where: {
    player: { displayName: { contains: 'Kaio Jorge' } },
    market: { in: ['finalizacao', 'chutes_ao_gol'] },
    house: { in: ['betfair', 'pitaco', 'betmgm', 'superbet'] },
  },
});
const kaioObj = {};
for (const s of kaio) kaioObj[`${s.market}|${s.house}|${s.line}`] = s.value;
const sample = {
  kaioJorge: kaioObj,
  betfairFinHas123: ['1+', '2+', '3+'].every((l) =>
    kaio.some((s) => s.market === 'finalizacao' && s.house === 'betfair' && s.line === l),
  ),
  pitacoFinHas123: ['1+', '2+', '3+'].every((l) =>
    kaio.some((s) => s.market === 'finalizacao' && s.house === 'pitaco' && s.line === l),
  ),
  activeHousesOnly: kaio.every((s) =>
    ['betfair', 'betmgm', 'superbet', 'pitaco'].includes(s.house),
  ),
};
fs.writeFileSync(path.join(SCRATCH, 'ranking-sample.json'), JSON.stringify(sample, null, 2));
w(sample);

const lines = [];
for (const market of ['finalizacao', 'chutes_ao_gol']) {
  const rows = await prisma.oddSnapshot.groupBy({
    by: ['house', 'line'],
    where: { market, house: { in: ['betfair', 'betmgm', 'superbet', 'pitaco'] } },
    _count: true,
  });
  lines.push(`\n=== ${market}`);
  rows.sort((a, b) => a.house.localeCompare(b.house) || a.line.localeCompare(b.line));
  for (const r of rows) lines.push(`${r.house}\t${r.line}\t${r._count}`);
}
fs.writeFileSync(path.join(SCRATCH, 'line-coverage.txt'), lines.join('\n'));
await prisma.$disconnect();

// Copy force-betfair success into betfair log if needed
const forceLog = path.join(SCRATCH, 'betfair-force123.log');
if (fs.existsSync(forceLog)) {
  fs.appendFileSync(
    path.join(SCRATCH, 'betfair-scrape.log'),
    '\n--- force-betfair-123 evidence ---\n' + fs.readFileSync(forceLog, 'utf8'),
  );
}

// Critério de live scrape: NÃO passa só com DB residual
if (!ok) {
  w('LIVE_SCRAPE_FAIL: fin/sot empty — not using stale DB as pass');
  process.exit(1);
}
w('LIVE_SCRAPE_PASS');
process.exit(0);
