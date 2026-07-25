/**
 * Testa scrapeMatchPage só em Internacional x Cruzeiro (Kaio Jorge).
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { scrapeBetfair } from '../src/scraping/betfairAdapter.ts';

// Força 1 jogo via env não resolve URL específica — interceptamos patchando MAX.
// Em vez disso: roda scrape e filtra Inter.

process.env.BETFAIR_MAX_MATCHES = '8';
process.env.BETFAIR_PROFILE = 'full';
process.env.BETFAIR_CONCURRENCY = '2';

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
  viewport: { width: 1440, height: 900 },
};
const ctx = fs.existsSync(sessionPath)
  ? await browser.newContext({ ...opts, storageState: sessionPath })
  : await browser.newContext(opts);

const results = await scrapeBetfair(ctx, ['brasileirao']);

const inter = results.filter(
  (m) =>
    /internacional/i.test(m.homeTeam) ||
    /cruzeiro/i.test(m.homeTeam) ||
    /internacional/i.test(m.awayTeam) ||
    /cruzeiro/i.test(m.awayTeam),
);

console.log('\n=== Inter/Cruzeiro matches ===', inter.length);
for (const m of inter) {
  const fin = m.odds.filter((o) => o.market === 'finalizacao');
  const byLine = {};
  for (const o of fin) byLine[o.line] = (byLine[o.line] || 0) + 1;
  console.log(`${m.homeTeam} vs ${m.awayTeam} finalizacao lines:`, byLine);
  const kaio = fin.filter((o) => /kaio/i.test(o.playerName));
  console.log(
    '  Kaio finalizacao:',
    kaio.map((o) => `${o.line}=${o.value}`).join(', ') || '(none)',
  );
  const sot = m.odds.filter((o) => o.market === 'chutes_ao_gol' && /kaio/i.test(o.playerName));
  console.log(
    '  Kaio SOT:',
    sot.map((o) => `${o.line}=${o.value}`).join(', ') || '(none)',
  );
}

// all finalizacao 1+ count
const allFin13 = results.flatMap((m) =>
  m.odds.filter((o) => o.market === 'finalizacao' && ['1+', '2+', '3+'].includes(o.line)),
);
console.log('\nTotal finalizacao 1/2/3 odds across all matches:', allFin13.length);
console.log(
  'sample:',
  allFin13.slice(0, 12).map((o) => `${o.playerName} ${o.line}=${o.value}`),
);

await browser.close();
