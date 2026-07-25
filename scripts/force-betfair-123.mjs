/**
 * Force-load Betfair finalizacao 1+/2+/3+ with the proven click sequence:
 * scroll → Mostrar mais → click all range tabs → 1+ até 3+ → Mostrar mais → dump.
 * Persists odds if any 1+/2+/3+ finalizacao found.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';
import { fromBetfairMarketType, mapMultiColumnOdds } from '../src/scraping/marketMap.ts';
import { normalizeLine, isLikelyPlayerName } from '../src/lib/normalize.ts';

const SCRATCH =
  process.env.GOAL_SCRATCH ||
  'C:/Users/LuanADM/AppData/Local/Temp/grok-goal-cb5f7204be54/implementer';
fs.mkdirSync(SCRATCH, { recursive: true });
const logf = path.join(SCRATCH, 'betfair-force123.log');
const log = (m) => {
  const s = typeof m === 'string' ? m : JSON.stringify(m, null, 2);
  fs.appendFileSync(logf, s + '\n');
  console.log(s);
};
fs.writeFileSync(logf, `=== force-betfair-123 ${new Date().toISOString()} ===\n`);

const MATCH =
  process.env.BF_URL ||
  'https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/internacional-x-cruzeiro/e-35688904?tab=jogador';

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
const page = await ctx.newPage();

const shotTypes = new Map();
const cardTitles = new Set();
const marketNames = new Set();
const payloads = [];

page.on('response', async (res) => {
  try {
    if (res.status() !== 200) return;
    const u = res.url();
    if (!/bff-gql|graphql/i.test(u)) return;
    const txt = await res.text();
    if (!/SHOT|chute|finaliz|Chutes por/i.test(txt)) return;
    payloads.push(txt);
    for (const m of txt.matchAll(/"marketType"\s*:\s*"([^"]*SHOT[^"]*)"/g)) {
      shotTypes.set(m[1], (shotTypes.get(m[1]) || 0) + 1);
    }
    for (const m of txt.matchAll(/"translated"\s*:\s*"([^"]{3,60})"/g)) {
      if (/chute|shot|finaliz/i.test(m[1])) cardTitles.add(m[1]);
    }
    for (const m of txt.matchAll(/"name"\s*:\s*"([^"]*(?:chute|shot|finaliz|Chutes)[^"]*)"/gi)) {
      marketNames.add(m[1]);
    }
  } catch {
    /* */
  }
});

log(`GOTO ${MATCH}`);
await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

for (let i = 0; i < 20; i++) {
  await page.evaluate(() => {
    window.scrollBy(0, 900);
    document.querySelectorAll('div').forEach((el) => {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        try {
          el.scrollBy(0, 900);
        } catch {
          /* */
        }
      }
    });
  });
  await page.waitForTimeout(220);
  if (i % 4 === 3) {
    await page.evaluate(() => {
      for (const btn of document.querySelectorAll('button,span,a')) {
        const t = (btn.innerText || '').toLowerCase();
        if (t.includes('mostrar mais')) {
          try {
            btn.click();
          } catch {
            /* */
          }
        }
      }
    });
    await page.waitForTimeout(500);
  }
}

// Click ALL range/column tabs (proven to load 1/2/3 SHOTS)
await page.evaluate(() => {
  for (const el of document.querySelectorAll('button,span,a,div,[role=tab],label,li')) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 28) continue;
    if (
      /^[1-6]\+$/.test(t) ||
      /^[1-6]\+\s*(até|a|e|-)/i.test(t) ||
      /até\s*3|a\s*6|e\s*2|e\s*4/i.test(t)
    ) {
      try {
        el.click();
      } catch {
        /* */
      }
    }
  }
});
await page.waitForTimeout(2000);

// Focus 1+ até 3+
for (const lab of ['1+ até 3+', '1+ a 3+']) {
  try {
    const loc = page.getByText(lab, { exact: true });
    const n = await loc.count();
    for (let i = 0; i < Math.min(n, 5); i++) {
      await loc.nth(i).click({ force: true, timeout: 500 }).catch(() => null);
    }
  } catch {
    /* */
  }
}
await page.waitForTimeout(1500);

// Mostrar mais AFTER range
for (let r = 0; r < 8; r++) {
  const n = await page.evaluate(() => {
    let c = 0;
    for (const el of document.querySelectorAll('button,span,a,div,[role=button]')) {
      const t = (el.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (t.includes('mostrar mais') && t.length < 40) {
        try {
          el.click();
          c++;
        } catch {
          /* */
        }
      }
    }
    return c;
  });
  log(`mostrar mais round ${r}: ${n}`);
  if (n === 0) break;
  await page.waitForTimeout(600);
}

// Re-focus 1+ até 3+
await page.getByText('1+ até 3+', { exact: true }).first().click({ force: true }).catch(() => null);
await page.waitForTimeout(1000);

log({ shotTypes: Object.fromEntries(shotTypes), cardTitles: [...cardTitles], marketNames: [...marketNames] });

// Extract from BFF payloads using shipped mappers
const extracted = [];
for (const txt of payloads) {
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    continue;
  }
  const walk = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const mt = obj.marketType || obj.market?.marketType;
    const mname = obj.name || obj.market?.name || '';
    const runners = obj.runners || obj.market?.runners;
    const live = obj.liveData?.runners || obj.market?.liveData?.runners || [];
    if (mt && Array.isArray(runners)) {
      const info = fromBetfairMarketType(String(mt));
      let market = info.market;
      let line = info.line || normalizeLine(String(mname));
      if (!market && /chute/i.test(mname)) {
        market = /gol/i.test(mname) ? 'chutes_ao_gol' : 'finalizacao';
      }
      if (market && line) {
        for (const r of runners) {
          const name = r.name || r.displayName?.name;
          if (!name || !isLikelyPlayerName(name)) continue;
          const lr = live.find((x) => x.selectionId === r.selectionId);
          const val = parseFloat(lr?.odds?.decimal || lr?.displayOdds?.decimal || 0);
          if (val > 1 && val < 200) {
            extracted.push({ playerName: name, market, line, value: val, house: 'betfair' });
          }
        }
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(data);
}

// DOM multi-col body extract for finalizacao
const domOdds = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const lower = body.toLowerCase();
  const start = lower.indexOf('chutes por jogador');
  if (start < 0) return { hasPor: false, odds: [], slice: '' };
  let end = body.length;
  for (const sw of ['chutes no gol', 'jogador comete', 'desarmes', 'cartões']) {
    const j = lower.indexOf(sw, start + 20);
    if (j > start && j < end) end = j;
  }
  const slice = body.slice(start, end);
  const lines = slice.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!/^[A-ZÀ-Ü]/.test(raw) || raw.length > 50) continue;
    if (/mostrar|chutes|1\+|2\+|3\+|4\+|a - z/i.test(raw)) continue;
    const odds = [];
    // same line
    const re = /\d+[.,]\d+/g;
    let m;
    const nameOnly = raw.replace(re, '').trim();
    re.lastIndex = 0;
    while ((m = re.exec(raw))) odds.push(parseFloat(m[0].replace(',', '.')));
    for (let j = i + 1; j < Math.min(i + 8, lines.length) && odds.length < 3; j++) {
      const t = lines[j];
      if (/^[A-ZÀ-Ü]/.test(t) && t.length > 2 && !/\d[.,]\d/.test(t)) break;
      const v = parseFloat(t.replace(',', '.'));
      if (!isNaN(v) && v > 1.01 && v < 80) odds.push(v);
    }
    if (odds.length >= 2 && nameOnly.length >= 3) {
      out.push({ name: nameOnly, odds });
    }
  }
  return { hasPor: true, odds: out.slice(0, 30), slice: slice.slice(0, 400) };
});

log({ domHasPor: domOdds.hasPor, domPlayers: domOdds.odds?.length, sampleDom: domOdds.odds?.slice(0, 5) });

const finFromBff = extracted.filter((o) => o.market === 'finalizacao');
const byLine = {};
for (const o of finFromBff) byLine[o.line] = (byLine[o.line] || 0) + 1;
log({ bffFinalizacao: finFromBff.length, byLine, sample: finFromBff.filter((o) => /kaio/i.test(o.playerName)).slice(0, 10) });

// Merge DOM mapped
const domMapped = [];
for (const row of domOdds.odds || []) {
  const mapped = mapMultiColumnOdds(row.odds, [1, 2, 3]);
  for (const m of mapped) {
    if (isLikelyPlayerName(row.name)) {
      domMapped.push({
        playerName: row.name,
        market: 'finalizacao',
        line: m.line,
        value: m.value,
        house: 'betfair',
      });
    }
  }
}
const domByLine = {};
for (const o of domMapped) domByLine[o.line] = (domByLine[o.line] || 0) + 1;
log({ domMapped: domMapped.length, domByLine, kaioDom: domMapped.filter((o) => /kaio/i.test(o.playerName)) });

const has123 =
  ((byLine['1+'] || 0) > 0 || (domByLine['1+'] || 0) > 0) &&
  ((byLine['2+'] || 0) > 0 || (domByLine['2+'] || 0) > 0) &&
  ((byLine['3+'] || 0) > 0 || (domByLine['3+'] || 0) > 0);
log(`ASSERT finalizacao 1+/2+/3+: ${has123 ? 'PASS' : 'FAIL'}`);

// Persist if we have odds
const allOdds = [...finFromBff, ...domMapped];
if (allOdds.length > 0) {
  const { persistScrapedData } = await import(
    pathToFileURL(path.resolve('src/scraping/index.ts')).href
  );
  const match = {
    homeTeam: 'Internacional',
    awayTeam: 'Cruzeiro',
    dateTime: new Date('2026-07-23T00:30:00.000Z'),
    stage: 'Brasileirão',
    competition: 'brasileirao',
    odds: allOdds,
  };
  const st = await persistScrapedData([match]);
  log({ persisted: st });
}

try {
  await ctx.storageState({ path: sessionPath });
} catch {
  /* */
}
await browser.close();
process.exit(has123 ? 0 : 1);
