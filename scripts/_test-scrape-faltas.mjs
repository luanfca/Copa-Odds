/**
 * Run production scrapeBetfair (1 match) and assert faltas_cometidas quality
 * matches "Jogador comete uma falta" multi-col (Luighi/Wallisson style).
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const ROOT = path.resolve('.');
const { scrapeBetfair } = await import(
  pathToFileURL(path.join(ROOT, 'src/scraping/betfairAdapter.ts')).href
);

process.env.BETFAIR_MAX_MATCHES = '1';
process.env.BETFAIR_PROFILE = 'full';
process.env.BETFAIR_CONCURRENCY = '1';

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

const results = await scrapeBetfair(ctx, ['brasileirao']);
const all = results.flatMap((m) =>
  (m.odds || [])
    .filter((o) => o.market === 'faltas_cometidas')
    .map((o) => ({ ...o, home: m.homeTeam, away: m.awayTeam })),
);

const byP = {};
for (const o of all) {
  if (!byP[o.playerName]) byP[o.playerName] = {};
  // keep best (first) per line
  if (!byP[o.playerName][o.line]) byP[o.playerName][o.line] = o.value;
}

const complete = [];
const junk = [];
for (const [name, lines] of Object.entries(byP)) {
  if (lines['1+'] && lines['2+'] && lines['3+']) {
    if (lines['1+'] < lines['2+'] && lines['2+'] < lines['3+']) {
      complete.push({ name, ...lines });
    } else {
      junk.push({ name, ...lines });
    }
  }
}

console.log('matches', results.length, 'faltas odds', all.length);
console.log('mono complete', complete.length, 'junk', junk.length);
console.log('sample complete', complete.slice(0, 8));
console.log('sample junk', junk.slice(0, 5));

const wall = complete.find((c) => /wallisson/i.test(c.name));
const luighi = complete.find((c) => /luighi/i.test(c.name));
console.log('Wallisson', wall);
console.log('Luighi', luighi);

// Quality: at least 3 mono triples; Wallisson-like if present should be ~1.06/1.36/2.3
const ok =
  complete.length >= 3 &&
  junk.length === 0 &&
  (!wall || (wall['1+'] < wall['2+'] && wall['2+'] < wall['3+'] && wall['2+'] > 1.2));

console.log(ok ? 'ASSERT PASS' : 'ASSERT FAIL');

try {
  await ctx.storageState({ path: sessionPath });
} catch {
  /* */
}
await browser.close();
process.exit(ok ? 0 : 1);
