/**
 * Força carregar "Chutes por jogador", clica 1+ até 3+, dump DOM + API.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const MATCH =
  'https://www.betfair.bet.br/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/internacional-x-cruzeiro/e-35688904?tab=jogador';

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR'],
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

const apis = [];
page.on('response', async (res) => {
  try {
    if (res.status() !== 200) return;
    const u = res.url();
    if (!/bff-gql|graphql|getMarketPrices|sbk/i.test(u)) return;
    const txt = await res.text();
    if (txt.length < 200) return;
    const hasTotal =
      /TOTAL_SHOT|total shots|Chutes por jogador|OR_MORE_SHOT(?!S_ON_TARGET)|PLAYER_TO_HAVE_\d_OR_MORE_SHOT[^_]/i.test(
        txt,
      ) || /"marketType":"PLAYER_TO_HAVE_[1-6]_OR_MORE_SHOTS"/i.test(txt);
    const shotTypes = [
      ...new Set([...txt.matchAll(/"(PLAYER_TO_HAVE_[A-Z0-9_]*SHOT[A-Z0-9_]*)"/g)].map((m) => m[1])),
    ];
    if (shotTypes.length || /Chutes por|totalShots|Kaio Jorge/i.test(txt)) {
      apis.push({
        t: Date.now(),
        url: u.slice(0, 100),
        len: txt.length,
        shotTypes,
        hasChutesPor: /Chutes por jogador/i.test(txt),
        titles: [
          ...new Set(
            [...txt.matchAll(/"translated":"([^"]{3,60})"/g)]
              .map((m) => m[1])
              .filter((x) => /chute|shot|finaliz/i.test(x)),
          ),
        ],
        raw: txt,
      });
    }
  } catch {
    /* */
  }
});

await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// heavy scroll + show more repeatedly
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollBy(0, 700));
    await page.waitForTimeout(180);
  }
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button, span, a')) {
      const t = (btn.innerText || '').toLowerCase();
      if (t.includes('mostrar mais') || t.includes('ver mais') || t.includes('show more')) {
        try {
          btn.click();
        } catch {
          /* */
        }
      }
    }
  });
  await page.waitForTimeout(800);
}

// find all headings with chute
const headings = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('h1,h2,h3,h4,h5,button,span,div,p')) {
    const t = (el.innerText || '').trim();
    if (t.length > 3 && t.length < 50 && /chute|finaliz|shot/i.test(t)) {
      out.push(t.replace(/\s+/g, ' '));
    }
  }
  return [...new Set(out)].slice(0, 40);
});
console.log('headings:', headings);

// click "Chutes por jogador" specifically (not "chutes no gol")
const clickedSection = await page.evaluate(() => {
  let n = 0;
  for (const el of document.querySelectorAll('*')) {
    const t = (el.innerText || '').trim().toLowerCase();
    // exact-ish: chutes por jogador without "gol"
    if (
      (t === 'chutes por jogador' ||
        t === 'chutes do jogador' ||
        t === 'total de chutes' ||
        (t.includes('chutes por jogador') && t.length < 40)) &&
      !t.includes('gol')
    ) {
      try {
        el.scrollIntoView({ block: 'center' });
        el.click();
        (el.closest('button,[role=button],a') || el).click();
        n++;
      } catch {
        /* */
      }
    }
  }
  return n;
});
console.log('clicked chutes por section:', clickedSection);
await page.waitForTimeout(1500);

// click range 1+ até 3+ near that section
const rangeClick = await page.evaluate(() => {
  const want = ['1+ até 3+', '1+ a 3+', '1+ - 3+'];
  const nodes = Array.from(
    document.querySelectorAll('button,span,a,div,[role=tab],label,li'),
  );
  const scored = [];
  for (const el of nodes) {
    const t = (el.innerText || '').trim().toLowerCase();
    if (!want.some((w) => t === w.toLowerCase() || t === w.toLowerCase() + ' tempo')) continue;
    let score = 1;
    let p = el;
    for (let d = 0; d < 10 && p; d++) {
      const pt = (p.innerText || '').toLowerCase().slice(0, 300);
      if (pt.includes('chutes por jogador') && !pt.includes('chutes no gol')) score += 20;
      if (pt.includes('chutes por')) score += 10;
      if (pt.includes('falta')) score -= 15; // avoid fouls card
      if (pt.includes('chutes no gol')) score -= 5;
      p = p.parentElement;
    }
    scored.push({ el, score, t });
  }
  scored.sort((a, b) => b.score - a.score);
  let clicked = 0;
  for (const { el, score, t } of scored.slice(0, 5)) {
    try {
      el.scrollIntoView({ block: 'center' });
      el.click();
      clicked++;
      console.log('click', t, 'score', score);
    } catch {
      /* */
    }
  }
  return { clicked, top: scored.slice(0, 5).map((s) => ({ t: s.t, score: s.score })) };
});
console.log('range click', rangeClick);
await page.waitForTimeout(2000);

// dump body for Kaio multi-odds
const dump = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const i = body.toLowerCase().indexOf('chutes por jogador');
  const j = body.toLowerCase().indexOf('kaio jorge');
  // find all Kaio Jorge occurrences with following 200 chars
  const contexts = [];
  let idx = 0;
  const lower = body.toLowerCase();
  while ((idx = lower.indexOf('kaio jorge', idx)) >= 0 && contexts.length < 5) {
    contexts.push(body.slice(idx, idx + 120).replace(/\s+/g, ' | '));
    idx += 10;
  }
  return {
    bodyLen: body.length,
    hasChutesPor: i >= 0,
    aroundChutes: i >= 0 ? body.slice(i, i + 800).replace(/\s+/g, ' ') : null,
    kaioContexts: contexts,
    // list lines like "1.04" near names pattern
  };
});
console.log(JSON.stringify(dump, null, 2));

// latest APIs with total shot types
console.log(
  '\nAPIs captured:',
  apis.map((a) => ({
    len: a.len,
    shotTypes: a.shotTypes,
    titles: a.titles,
    hasChutesPor: a.hasChutesPor,
  })),
);

// analyze best API for finalizacao lines
for (const a of apis) {
  if (!a.shotTypes.some((t) => /SHOT/i.test(t) && !/ON_TARGET/i.test(t)) && !a.hasChutesPor) continue;
  fs.writeFileSync('scripts/_bf-chutes-por.json', a.raw);
  console.log('wrote chutes por payload', a.len, a.shotTypes);
  break;
}

// also write last big
const biggest = apis.sort((x, y) => y.len - x.len)[0];
if (biggest) {
  // extract Kaio + SHOT markets from this payload
  const types = biggest.shotTypes;
  console.log('biggest shot types', types);
  try {
    const data = JSON.parse(biggest.raw);
    function findKaioShots(obj, acc = []) {
      if (!obj || typeof obj !== 'object') return acc;
      if (Array.isArray(obj)) {
        obj.forEach((v) => findKaioShots(v, acc));
        return acc;
      }
      if (obj.marketType && /SHOT/i.test(obj.marketType) && Array.isArray(obj.runners)) {
        for (const r of obj.runners) {
          if (/kaio jorge/i.test(r.name || '')) {
            const live = (obj.liveData?.runners || []).find(
              (lr) => lr.selectionId === r.selectionId,
            );
            acc.push({
              marketType: obj.marketType,
              marketName: obj.name,
              decimal: live?.odds?.decimal || live?.displayOdds?.decimal,
            });
          }
        }
      }
      for (const v of Object.values(obj)) findKaioShots(v, acc);
      return acc;
    }
    console.log('Kaio shot markets in biggest:', findKaioShots(data));
  } catch {
    /* */
  }
}

await page.screenshot({ path: 'scripts/_bf-chutes-por.png', fullPage: true });
await browser.close();
console.log('done');
