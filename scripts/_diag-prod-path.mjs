/**
 * Diagnose why production path fails while force-betfair-123 works.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const MATCH =
  process.env.BF_URL ||
  'https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/atl%C3%A9tico-mg-x-bahia/e-35682828?tab=jogador';

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
const page = await ctx.newPage();

const shot = new Map();
const captured = [];
page.on('response', async (res) => {
  try {
    if (res.status() !== 200) return;
    const u = res.url();
    if (!/bff-gql|graphql/i.test(u)) return;
    const txt = await res.text();
    if (!/SHOT|chute|finaliz|Cards|marketType|runners/i.test(txt)) return;
    captured.push(txt);
    for (const m of txt.matchAll(/"marketType"\s*:\s*"([^"]*SHOT[^"]*)"/g)) {
      shot.set(m[1], (shot.get(m[1]) || 0) + 1);
    }
  } catch {
    /* */
  }
});

console.log('GOTO', MATCH);
await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2000);

// Production-like: click jogador keywords
await page.evaluate(() => {
  try {
    const targetKeywords = ['jogador', 'estatísticas', 'faltas', 'desarmes', 'especiais'];
    const allElements = Array.from(document.querySelectorAll('*'));
    const leaves = allElements.filter((el) => {
      if (el.children.length > 0) return false;
      const txt = el.textContent?.trim().toLowerCase() || '';
      return targetKeywords.some((kw) => txt === kw || (txt.includes(kw) && txt.length < 25));
    });
    if (leaves.length > 0) (leaves[0]).click();
  } catch {
    /* */
  }
});
await page.waitForTimeout(800);

// Production early scroll
for (let i = 0; i < 10; i++) {
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
  await page.waitForTimeout(250);
}

// expand sections like production
await page.evaluate(() => {
  const headers = [
    'chutes por jogador',
    'chutes no gol',
    'finalização',
    'faltas cometidas',
    'desarmes',
  ];
  for (const el of document.querySelectorAll('button, [role="button"], a, label, h2, h3, h4, span, div')) {
    const txt = (el.textContent || '').trim().toLowerCase();
    if (txt.length > 0 && txt.length < 40 && headers.some((h) => txt === h || txt.includes(h))) {
      try {
        (el.closest('button, [role="button"], a, label, [tabindex]') || el).click();
      } catch {
        /* */
      }
    }
  }
});
await page.waitForTimeout(800);

const snap = async (label) => {
  const s = await page.evaluate(() => {
    const b = document.body?.innerText || '';
    const lower = b.toLowerCase();
    let sm = 0;
    for (const el of document.querySelectorAll('button,span,a,div,[role=button]')) {
      const t = (el.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
      if (t.includes('mostrar mais') && t.length < 40) sm++;
    }
    const i = lower.indexOf('chutes por jogador');
    return {
      hasPor: lower.includes('chutes por jogador'),
      hasMostrar: lower.includes('mostrar mais'),
      mostrarButtons: sm,
      has13: b.includes('1+ até 3+') || b.includes('1+ a 3+'),
      bodyLen: b.length,
      slice: i >= 0 ? b.slice(i, i + 600) : 'NONE',
    };
  });
  console.log('---', label, JSON.stringify({ ...s, slice: s.slice.slice(0, 200) }, null, 2));
  return s;
};

await snap('after expand');

// force scroll + show more
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
    console.log('scroll showMore round', i, n);
  }
}

await snap('after force scroll');

// click all tabs
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

const smAfter = await page.evaluate(() => {
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
console.log('showMore after 1+ até 3+', smAfter);
await page.waitForTimeout(1000);

const final = await snap('final');
console.log('shotTypes', Object.fromEntries(shot));
console.log('api1', (JSON.stringify(captured).match(/PLAYER_TO_HAVE_1_OR_MORE_SHOTS"/g) || []).length);
console.log('api2', (JSON.stringify(captured).match(/PLAYER_TO_HAVE_2_OR_MORE_SHOTS"/g) || []).length);
console.log('api3', (JSON.stringify(captured).match(/PLAYER_TO_HAVE_3_OR_MORE_SHOTS"/g) || []).length);

// Try body harvest like force
const domOdds = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const lower = body.toLowerCase();
  const start = lower.indexOf('chutes por jogador');
  if (start < 0) return { hasPor: false, odds: [] };
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
    if (odds.length >= 2 && nameOnly.length >= 3) out.push({ name: nameOnly, odds });
  }
  return { hasPor: true, odds: out.slice(0, 10) };
});
console.log('domOdds', JSON.stringify(domOdds, null, 2));

// Now run production scrapeMatch via adapter import for same URL only
await browser.close();
process.exit(0);
