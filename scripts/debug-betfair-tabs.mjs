/**
 * Debug: abre um jogo, clica "1+ até 3+" e dumpeia DOM + respostas API.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const MATCH =
  process.env.BF_URL ||
  'https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/internacional-x-cruzeiro/e-35688904?tab=jogador';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR'],
});

const sessionPath = path.join(process.cwd(), '.playwright-sessions', 'betfair-session.json');
const contextOptions = {
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  viewport: { width: 1440, height: 900 },
};

const ctx = fs.existsSync(sessionPath)
  ? await browser.newContext({ ...contextOptions, storageState: sessionPath })
  : await browser.newContext(contextOptions);

const page = await ctx.newPage();
const apiSnippets = [];

page.on('response', async (res) => {
  try {
    if (res.status() !== 200) return;
    const u = res.url();
    if (!u.includes('bff-gql') && !u.includes('graphql') && !u.includes('getMarket')) return;
    const txt = await res.text();
    if (!/Kaio|chute|shot|finaliz|OR_MORE/i.test(txt)) return;
    apiSnippets.push({
      url: u.slice(0, 120),
      len: txt.length,
      hasKaio: /Kaio/i.test(txt),
      sample: txt.slice(0, 500),
      // extract marketTypes with SHOT
      types: [...txt.matchAll(/"[A-Z0-9_]*(?:SHOT|FINAL|TACKLE|FOUL)[A-Z0-9_]*"/gi)]
        .map((m) => m[0])
        .slice(0, 40),
      lines: [...txt.matchAll(/"label"\s*:\s*"[^"]*\+"|"name"\s*:\s*"[^"]*\+"/gi)]
        .map((m) => m[0])
        .slice(0, 40),
    });
  } catch {
    /* */
  }
});

console.log('GOTO', MATCH);
await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// scroll
for (let i = 0; i < 10; i++) {
  await page.evaluate(() => window.scrollBy(0, 800));
  await page.waitForTimeout(250);
}

// mostrar mais
await page.evaluate(() => {
  for (const btn of document.querySelectorAll('button, span, a')) {
    if ((btn.innerText || '').toLowerCase().includes('mostrar mais')) {
      try {
        btn.click();
      } catch {
        /* */
      }
    }
  }
});
await page.waitForTimeout(1000);

// click section
await page.evaluate(() => {
  for (const el of document.querySelectorAll('*')) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (t === 'chutes por jogador' || t.includes('chutes por jogador')) {
      try {
        el.click();
        (el.closest('button,[role=button],a') || el).click();
      } catch {
        /* */
      }
    }
  }
});
await page.waitForTimeout(800);

async function clickLabel(label) {
  const n = await page.evaluate((want) => {
    let c = 0;
    for (const el of document.querySelectorAll('button,span,a,div,[role=tab],label,li')) {
      const t = (el.innerText || el.textContent || '').trim().toLowerCase();
      if (t === want.toLowerCase() || (t.includes(want.toLowerCase()) && t.length < 24)) {
        try {
          el.click();
          c++;
        } catch {
          /* */
        }
      }
    }
    return c;
  }, label);
  console.log(`click "${label}" => ${n}`);
  await page.waitForTimeout(1500);
}

await clickLabel('1+ até 3+');
await clickLabel('1+ a 3+');

// dump page text around Kaio / chutes
const dump = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const idx = body.toLowerCase().indexOf('chutes por jogador');
  const idx2 = body.toLowerCase().indexOf('kaio');
  const aroundChutes = idx >= 0 ? body.slice(Math.max(0, idx - 80), idx + 1200) : 'NO chutes por jogador';
  const aroundKaio = idx2 >= 0 ? body.slice(Math.max(0, idx2 - 100), idx2 + 400) : 'NO kaio in body';

  // list short interactive texts
  const tabs = [];
  for (const el of document.querySelectorAll('button,span,a,div,[role=tab],label')) {
    const t = (el.innerText || '').trim();
    if (!t || t.length > 30) continue;
    if (/[1-6]\+|até|a 6|a 3|chutes|finaliz|mostrar/i.test(t)) {
      tabs.push(t.replace(/\s+/g, ' '));
    }
  }

  // shadow roots count
  let shadows = 0;
  document.querySelectorAll('*').forEach((el) => {
    if (el.shadowRoot) shadows++;
  });

  return {
    bodyLen: body.length,
    aroundChutes,
    aroundKaio,
    tabs: [...new Set(tabs)].slice(0, 60),
    shadows,
    hasKaio: /kaio/i.test(body),
    hasChutes: /chutes por jogador/i.test(body),
  };
});

console.log('\n=== DOM DUMP ===');
console.log(JSON.stringify(dump, null, 2));

// screenshot
const shotPath = path.join(process.cwd(), 'scripts', '_bf-tabs.png');
await page.screenshot({ path: shotPath, fullPage: false });
console.log('screenshot', shotPath);

// also click 4+ a 6+ and dump kaio again
await clickLabel('4+ a 6+');
const dump2 = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const idx2 = body.toLowerCase().indexOf('kaio jorge');
  return idx2 >= 0 ? body.slice(Math.max(0, idx2 - 40), idx2 + 200) : body.toLowerCase().includes('kaio')
    ? body.slice(body.toLowerCase().indexOf('kaio') - 40, body.toLowerCase().indexOf('kaio') + 200)
    : 'NO kaio';
});
console.log('\n=== AFTER 4+ a 6+ Kaio ===\n', dump2);

console.log('\n=== API snippets ===', apiSnippets.length);
for (const s of apiSnippets.slice(-8)) {
  console.log(JSON.stringify(s, null, 2).slice(0, 800));
  console.log('---');
}

// save full last API with Kaio
const lastKaio = [...apiSnippets].reverse().find((s) => s.hasKaio);
if (lastKaio) {
  fs.writeFileSync('scripts/_bf-api-kaio-meta.json', JSON.stringify(lastKaio, null, 2));
  console.log('wrote scripts/_bf-api-kaio-meta.json');
}

await browser.close();
console.log('done');
