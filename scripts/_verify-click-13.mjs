import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const MATCH =
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

const shotTypes = new Set();
page.on('response', async (res) => {
  try {
    if (res.status() !== 200) return;
    if (!/bff-gql|graphql/i.test(res.url())) return;
    const txt = await res.text();
    for (const m of txt.matchAll(/"(PLAYER_TO_HAVE_[A-Z0-9_]*SHOT[A-Z0-9_]*)"/g)) {
      shotTypes.add(m[1]);
    }
  } catch {
    /* */
  }
});

await page.goto(MATCH, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
for (let i = 0; i < 18; i++) {
  await page.evaluate(() => {
    window.scrollBy(0, 800);
    for (const btn of document.querySelectorAll('button,span,a')) {
      if ((btn.innerText || '').toLowerCase().includes('mostrar mais')) {
        try {
          btn.click();
        } catch {
          /* */
        }
      }
    }
  });
  await page.waitForTimeout(220);
}

console.log('before click types', [...shotTypes]);

// same click logic as adapter (no named fns)
const clickRes = await page.evaluate(({ labels: labs, prefer: pref, avoid: av }) => {
  const roots = [];
  const allEls = Array.from(document.querySelectorAll('*'));
  for (let i = 0; i < allEls.length; i++) {
    const el = allEls[i];
    const parts = [];
    const kids = el.childNodes;
    for (let ki = 0; ki < kids.length; ki++) {
      const n = kids[ki];
      if (n.nodeType === 3) {
        const t = (n.textContent || '').trim();
        if (t) parts.push(t);
      } else if (n.nodeType === 1) {
        const t = (n.innerText || '').trim();
        if (t && t.length < 80) parts.push(t);
      }
    }
    const ot = parts.join(' ').toLowerCase();
    if (ot.length < 5 || ot.length > 60) continue;
    let hitKw = false;
    for (let pi = 0; pi < pref.length; pi++) {
      if (ot.includes(pref[pi].toLowerCase())) {
        hitKw = true;
        break;
      }
    }
    if (!hitKw) continue;
    let root = el;
    for (let d = 0; d < 10 && root && root !== document.body; d++) {
      const cls = String(root.className || '');
      const tag = root.tagName;
      const big = (root.innerText || '').length;
      if (
        tag === 'SECTION' ||
        tag === 'ARTICLE' ||
        /card|Card|market|Market|pebble|Pebble/i.test(cls) ||
        (big > 200 && big < 12000)
      ) {
        if (big >= 150 && big < 8000) break;
      }
      root = root.parentElement;
    }
    if (root && root !== document.body && roots.indexOf(root) < 0) roots.push(root);
  }

  const searchRoots = roots.length > 0 ? roots : [document];
  const cands = [];
  for (let ri = 0; ri < searchRoots.length; ri++) {
    const qroot = searchRoots[ri];
    const nodes = qroot.querySelectorAll
      ? Array.from(
          qroot.querySelectorAll('button, span, a, div, [role="tab"], [role="button"], label, li'),
        )
      : [];
    const rootBlob = (qroot.innerText || '').toLowerCase().slice(0, 400);
    let base = 10;
    for (let pi = 0; pi < pref.length; pi++) if (rootBlob.includes(pref[pi].toLowerCase())) base += 20;
    for (let ai = 0; ai < av.length; ai++) if (rootBlob.includes(av[ai].toLowerCase())) base -= 12;
    for (let ni = 0; ni < nodes.length; ni++) {
      const el = nodes[ni];
      const t = (el.innerText || el.textContent || '').trim();
      if (!t || t.length > 28) continue;
      const tl = t.toLowerCase();
      let matched = null;
      for (let li = 0; li < labs.length; li++) {
        const lab = labs[li].toLowerCase();
        if (tl === lab || tl === lab + ' tempo') {
          matched = labs[li];
          break;
        }
      }
      if (!matched) continue;
      let score = base;
      if (roots.length > 0) score += 30;
      cands.push({ el, label: matched, score, rootPreview: rootBlob.slice(0, 80) });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  let clicks = 0;
  for (let ci = 0; ci < Math.min(4, cands.length); ci++) {
    try {
      cands[ci].el.scrollIntoView({ block: 'center' });
      cands[ci].el.click();
      clicks++;
    } catch {
      /* */
    }
  }
  return {
    roots: roots.length,
    clicks,
    top: cands.slice(0, 5).map((c) => ({ label: c.label, score: c.score, preview: c.rootPreview })),
  };
}, {
  labels: ['1+ até 3+', '1+ a 3+', '1+ - 3+'],
  prefer: ['chutes por jogador', 'total de chutes', 'finaliz'],
  avoid: ['comete uma falta', 'faltas comet', 'falta sofr', 'cartão', 'marcador'],
});

console.log('clickRes', JSON.stringify(clickRes, null, 2));
await page.waitForTimeout(2500);

console.log('after click types', [...shotTypes]);

const dump = await page.evaluate(() => {
  const body = document.body.innerText || '';
  const contexts = [];
  let idx = 0;
  const lower = body.toLowerCase();
  while ((idx = lower.indexOf('kaio', idx)) >= 0 && contexts.length < 8) {
    contexts.push(body.slice(idx, idx + 100).replace(/\s+/g, ' '));
    idx += 4;
  }
  // try extract multi-col near Chutes por jogador
  const i = lower.indexOf('chutes por jogador');
  return {
    hasPor: i >= 0,
    around: i >= 0 ? body.slice(i, i + 600).replace(/\s+/g, ' ') : null,
    kaio: contexts,
    bodyLen: body.length,
  };
});
console.log(JSON.stringify(dump, null, 2));

await browser.close();
