/**
 * Force-load Betfair "Jogador comete uma falta" 1+/2+/3+ (same idea as force-betfair-123).
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { mapMultiColumnOdds } from '../src/scraping/marketMap.ts';
import { isLikelyPlayerName } from '../src/lib/normalize.ts';

const MATCH =
  process.env.BF_URL ||
  'https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/coritiba-x-palmeiras/e-35682835?tab=jogador';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--lang=pt-BR'],
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

console.log('GOTO', MATCH);
await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);

for (let i = 0; i < 16; i++) {
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
      for (const btn of document.querySelectorAll('button,span,a,div')) {
        const t = (btn.innerText || '').toLowerCase();
        if (t.includes('mostrar mais') && t.length < 40) {
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

// Click all range tabs then focus 1+ até 3+ near faltas
await page.evaluate(() => {
  for (const el of document.querySelectorAll('button,span,a,div,[role=tab],label,li')) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 28) continue;
    if (
      /^[1-6]\+$/.test(t) ||
      /^[1-6]\+\s*(até|a|e|-)/i.test(t) ||
      /até\s*3|a\s*6/i.test(t)
    ) {
      try {
        el.click();
      } catch {
        /* */
      }
    }
  }
});
await page.waitForTimeout(1500);

// Prefer click 1+ até 3+ inside card with "comete uma falta"
const clicked = await page.evaluate(() => {
  const want = ['1+ até 3+', '1+ a 3+'];
  const nodes = Array.from(
    document.querySelectorAll('button,span,a,div,[role=tab],label,li'),
  );
  const cands = [];
  for (const el of nodes) {
    const t = (el.innerText || '').trim();
    if (!want.includes(t)) continue;
    let score = 1;
    let p = el;
    for (let d = 0; d < 10 && p; d++) {
      const blob = (p.innerText || '').toLowerCase().slice(0, 300);
      if (blob.includes('comete uma falta') || blob.includes('jogador comete')) score += 30;
      if (blob.includes('chutes por') || blob.includes('desarme')) score -= 15;
      p = p.parentElement;
    }
    cands.push({ el, score });
  }
  cands.sort((a, b) => b.score - a.score);
  let n = 0;
  for (const c of cands.slice(0, 4)) {
    try {
      c.el.scrollIntoView({ block: 'center' });
      c.el.click();
      n++;
    } catch {
      /* */
    }
  }
  return { n, top: cands[0]?.score };
});
console.log('range click', clicked);
await page.waitForTimeout(1500);

for (let r = 0; r < 6; r++) {
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
  console.log('mostrar mais', r, n);
  if (n === 0) break;
  await page.waitForTimeout(500);
}

const dom = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const lower = body.toLowerCase();
  let start = lower.indexOf('jogador comete uma falta');
  if (start < 0) start = lower.indexOf('comete uma falta');
  if (start < 0) return { has: false, slice: '', odds: [] };
  let end = body.length;
  for (const sw of [
    'chutes por jogador',
    'chutes no gol',
    'faltas sofr',
    'desarmes',
    'cartões',
    'marcador',
  ]) {
    const j = lower.indexOf(sw, start + 30);
    if (j > start && j < end) end = j;
  }
  const slice = body.slice(start, end);
  const lines = slice.split(/\n+/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!/^[A-ZÀ-Ü]/.test(raw) || raw.length > 50) continue;
    if (/mostrar|chutes|faltas|jogador|comete|1\+|2\+|3\+|a - z|tempo|substitui/i.test(raw)) continue;
    const odds = [];
    const re = /\d+[.,]\d+/g;
    let m;
    const nameOnly = raw.replace(re, '').trim();
    re.lastIndex = 0;
    while ((m = re.exec(raw))) odds.push(parseFloat(m[0].replace(',', '.')));
    for (let j = i + 1; j < Math.min(i + 10, lines.length) && odds.length < 3; j++) {
      const t = lines[j];
      if (/^[A-ZÀ-Ü]/.test(t) && t.length > 2 && !/\d[.,]\d/.test(t)) break;
      const v = parseFloat(t.replace(',', '.'));
      if (!isNaN(v) && v > 1.01 && v < 80) odds.push(v);
    }
    if (odds.length >= 2 && nameOnly.length >= 3) out.push({ name: nameOnly, odds });
  }
  return { has: true, slice: slice.slice(0, 500), odds: out.slice(0, 15) };
});

console.log('has card', dom.has);
console.log('slice', dom.slice);
const mapped = [];
for (const row of dom.odds || []) {
  if (!isLikelyPlayerName(row.name)) continue;
  for (const m of mapMultiColumnOdds(row.odds, [1, 2, 3])) {
    mapped.push({ playerName: row.name, line: m.line, value: m.value });
  }
}
const byP = {};
for (const o of mapped) {
  if (!byP[o.playerName]) byP[o.playerName] = {};
  byP[o.playerName][o.line] = o.value;
}
console.log('mapped sample', Object.entries(byP).slice(0, 8));
const targets = ['luighi', 'wallisson', 'fernando sobral', 'sobral'];
for (const [name, lines] of Object.entries(byP)) {
  if (targets.some((t) => name.toLowerCase().includes(t))) {
    console.log('TARGET', name, lines);
  }
}
const mono = Object.values(byP).filter(
  (l) => l['1+'] && l['2+'] && l['3+'] && l['1+'] < l['2+'] && l['2+'] < l['3+'],
).length;
console.log('ASSERT mono triples', mono, mono >= 3 ? 'PASS' : 'FAIL');

await browser.close();
process.exit(mono >= 3 ? 0 : 1);
