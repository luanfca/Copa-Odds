/**
 * Gating verification for Betfair + Pitaco finalizacao / chutes_ao_gol.
 * Writes evidence logs; exit 0 only if both houses produce required lines.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const SCRATCH =
  process.env.GOAL_SCRATCH ||
  path.join(
    process.env.LOCALAPPDATA || process.env.TEMP || '/tmp',
    'Temp',
    'grok-goal-cb5f7204be54',
    'implementer',
  );

fs.mkdirSync(SCRATCH, { recursive: true });

function log(file, msg) {
  const line = typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2);
  fs.appendFileSync(file, line + '\n');
  console.log(line);
}

async function withBrowser(sessionName, fn) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--lang=pt-BR'],
  });
  const sessionPath = path.join(ROOT, '.playwright-sessions', sessionName);
  const opts = {
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1440, height: 900 },
  };
  let ctx;
  try {
    ctx = fs.existsSync(sessionPath)
      ? await browser.newContext({ ...opts, storageState: sessionPath })
      : await browser.newContext(opts);
  } catch {
    ctx = await browser.newContext(opts);
  }
  try {
    return await fn(ctx, browser);
  } finally {
    try {
      await ctx.storageState({ path: sessionPath });
    } catch {
      /* */
    }
    await ctx.close().catch(() => null);
    await browser.close().catch(() => null);
  }
}

function isJunkPlayerName(name) {
  if (!name || typeof name !== 'string') return true;
  const n = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (/^equipe\b/.test(n) || /^time\b/.test(n) || /^clube\b/.test(n)) return true;
  if (/\bequipe\s*[ab]\b/.test(n)) return true;
  const teams = [
    'bahia', 'flamengo', 'palmeiras', 'corinthians', 'santos', 'internacional',
    'cruzeiro', 'atletico', 'botafogo', 'gremio', 'vasco', 'fluminense', 'coritiba',
  ];
  if (teams.some((t) => n === t || n.startsWith(t + ' '))) return true;
  return false;
}

/** Real club match — not empty, not e-id URL junk " e 35682828?tab=jogador". */
function isRealMatchName(home, away) {
  const h = String(home || '').trim();
  const a = String(away || '').trim();
  if (h.length < 3 || a.length < 3) return false;
  const blob = `${h} ${a}`.toLowerCase();
  if (/\be-\d+/.test(blob) || /tab=jogador/.test(blob)) return false;
  if (/^\d+$/.test(h) || /^\d+$/.test(a)) return false;
  // must look like club words, not only event id crumbs
  if (!/[a-záàâãéêíóôõúç]{3,}/i.test(h)) return false;
  if (!/[a-záàâãéêíóôõúç]{3,}/i.test(a)) return false;
  return true;
}

/** Over lines must be strictly increasing (more shots = higher odds). */
function isStrictMonotonic123(lines) {
  const a = lines['1+'];
  const b = lines['2+'];
  const c = lines['3+'];
  if (!(a > 1) || !(b > 1) || !(c > 1)) return false;
  if (a === c) return false; // always junk (even if 2+ differs a lot)
  return a < b && b < c;
}

function summarize(matches, house) {
  const byMarketLine = {};
  const playersWith123 = new Set();
  let junkCompleteRejected = 0;
  let garbageMatchRejected = 0;
  for (const m of matches) {
    const realMatch = isRealMatchName(m.homeTeam, m.awayTeam);
    const byPlayer = {};
    for (const o of m.odds || []) {
      if (o.house && o.house !== house) continue;
      if (isJunkPlayerName(o.playerName)) continue;
      const k = `${o.market}|${o.line}`;
      byMarketLine[k] = (byMarketLine[k] || 0) + 1;
      if (o.market === 'finalizacao' && ['1+', '2+', '3+'].includes(o.line)) {
        const pk = `${m.homeTeam}|${o.playerName}`;
        if (!byPlayer[pk]) byPlayer[pk] = {};
        byPlayer[pk][o.line] = o.value;
      }
    }
    for (const [pk, lines] of Object.entries(byPlayer)) {
      if (!(lines['1+'] && lines['2+'] && lines['3+'])) continue;
      if (!realMatch) {
        garbageMatchRejected++;
        continue;
      }
      if (!isStrictMonotonic123(lines)) {
        junkCompleteRejected++;
        continue;
      }
      playersWith123.add(pk + ` 1+=${lines['1+']} 2+=${lines['2+']} 3+=${lines['3+']}`);
    }
  }
  return {
    byMarketLine,
    fin123CompletePlayers: playersWith123.size,
    samplePlayers: [...playersWith123].slice(0, 8),
    junkCompleteRejected,
    garbageMatchRejected,
  };
}

// ── Betfair ──────────────────────────────────────────────────────────────
const bfLog = path.join(SCRATCH, 'betfair-scrape.log');
fs.writeFileSync(bfLog, `=== Betfair scrape ${new Date().toISOString()} ===\n`);
process.env.BETFAIR_MAX_MATCHES = process.env.BETFAIR_MAX_MATCHES || '3';
process.env.BETFAIR_PROFILE = 'full';
process.env.BETFAIR_CONCURRENCY = '1';

let betfairOk = false;
let betfairSummary = null;
try {
  const { scrapeBetfair } = await imp('src/scraping/betfairAdapter.ts');
  log(bfLog, `profile=full maxMatches=${process.env.BETFAIR_MAX_MATCHES}`);
  const results = await withBrowser('betfair-session.json', async (ctx) => {
    return scrapeBetfair(ctx, ['brasileirao']);
  });
  log(bfLog, `matches returned: ${results.length}`);
  betfairSummary = summarize(results, 'betfair');
  // also count without house filter (scraper sets house betfair)
  const allOdds = results.flatMap((m) => m.odds || []);
  const finLines = {};
  const sotLines = {};
  for (const o of allOdds) {
    if (o.market === 'finalizacao') finLines[o.line] = (finLines[o.line] || 0) + 1;
    if (o.market === 'chutes_ao_gol') sotLines[o.line] = (sotLines[o.line] || 0) + 1;
  }
  log(bfLog, { finalizacaoLines: finLines, chutesAoGolLines: sotLines, summary: betfairSummary });

  // sample REAL players with STRICT monotonic 1+<2+<3+ under real club names
  let qualityComplete = 0;
  let junkLogged = 0;
  for (const m of results) {
    if (!isRealMatchName(m.homeTeam, m.awayTeam)) continue;
    const byP = {};
    for (const o of m.odds || []) {
      if (o.market !== 'finalizacao') continue;
      if (isJunkPlayerName(o.playerName)) continue;
      if (!byP[o.playerName]) byP[o.playerName] = {};
      byP[o.playerName][o.line] = o.value;
    }
    for (const [name, lines] of Object.entries(byP)) {
      if (!(lines['1+'] && lines['2+'] && lines['3+'])) continue;
      if (!isStrictMonotonic123(lines)) {
        if (junkLogged < 5) {
          log(
            bfLog,
            `JUNK_123 ${m.homeTeam} vs ${m.awayTeam} | ${name} 1+=${lines['1+']} 2+=${lines['2+']} 3+=${lines['3+']}`,
          );
          junkLogged++;
        }
        continue;
      }
      qualityComplete++;
      log(
        bfLog,
        `COMPLETE_123 ${m.homeTeam} vs ${m.awayTeam} | ${name} 1+=${lines['1+']} 2+=${lines['2+']} 3+=${lines['3+']}`,
      );
    }
  }

  // Count lines only from non-junk players on real matches
  const finLinesReal = {};
  for (const m of results) {
    if (!isRealMatchName(m.homeTeam, m.awayTeam)) continue;
    for (const o of m.odds || []) {
      if (o.market !== 'finalizacao') continue;
      if (isJunkPlayerName(o.playerName)) continue;
      finLinesReal[o.line] = (finLinesReal[o.line] || 0) + 1;
    }
  }
  const has1 = (finLinesReal['1+'] || 0) > 0;
  const has2 = (finLinesReal['2+'] || 0) > 0;
  const has3 = (finLinesReal['3+'] || 0) > 0;
  const realComplete =
    betfairSummary.fin123CompletePlayers > 0 && qualityComplete > 0;
  betfairOk = has1 && has2 && has3 && realComplete && qualityComplete >= 3;
  log(bfLog, {
    finLinesReal,
    realCompletePlayers: betfairSummary.fin123CompletePlayers,
    qualityCompleteOnRealMatches: qualityComplete,
    junkCompleteRejected: betfairSummary.junkCompleteRejected,
    garbageMatchRejected: betfairSummary.garbageMatchRejected,
  });
  log(
    bfLog,
    `ASSERT finalizacao 1+/2+/3+ real players: ${has1}/${has2}/${has3} complete=${realComplete} qualityN=${qualityComplete} → ${betfairOk ? 'PASS' : 'FAIL'}`,
  );
  if (!betfairOk) {
    log(bfLog, 'HINT: mapMultiColumnOdds in harvest + deep BFF walk + Mostrar mais');
  }
  // Persist for ranking sample
  if (results.length > 0) {
    try {
      const { persistScrapedData } = await imp('src/scraping/index.ts');
      const stats = await persistScrapedData(results);
      log(bfLog, { persisted: stats });
    } catch (pe) {
      log(bfLog, `persist warning: ${pe}`);
    }
  }
} catch (e) {
  log(bfLog, `ERROR: ${e?.stack || e}`);
  log(bfLog, 'ENV_LIMIT or scrape failure — unit/structural tests must still pass');
}

// ── Pitaco ───────────────────────────────────────────────────────────────
const ptLog = path.join(SCRATCH, 'pitaco-scrape.log');
fs.writeFileSync(ptLog, `=== Pitaco scrape ${new Date().toISOString()} ===\n`);
let pitacoOk = false;
try {
  const { scrapePitaco } = await imp('src/scraping/pitaco.ts');
  const results = await withBrowser('pitaco-session.json', async (ctx) => {
    return scrapePitaco(ctx, ['brasileirao']);
  });
  log(ptLog, `matches returned: ${results.length}`);
  const allOdds = results.flatMap((m) => m.odds || []);
  const byMarket = {};
  const byHouse = {};
  for (const o of allOdds) {
    byMarket[o.market] = (byMarket[o.market] || 0) + 1;
    byHouse[o.house] = (byHouse[o.house] || 0) + 1;
  }
  const fin = allOdds.filter((o) => o.market === 'finalizacao');
  const sot = allOdds.filter((o) => o.market === 'chutes_ao_gol');
  const finLines = {};
  for (const o of fin) finLines[o.line] = (finLines[o.line] || 0) + 1;
  const sotLines = {};
  for (const o of sot) sotLines[o.line] = (sotLines[o.line] || 0) + 1;

  log(ptLog, { byMarket, byHouse, finLines, sotLines, sample: allOdds.slice(0, 8) });

  const houseOk = allOdds.every((o) => !o.house || o.house === 'pitaco');
  pitacoOk =
    houseOk &&
    (fin.length > 0 || sot.length > 0) &&
    (Object.keys(finLines).length > 0 || Object.keys(sotLines).length > 0);
  log(ptLog, `ASSERT pitaco finalizacao|sot: fin=${fin.length} sot=${sot.length} houseOk=${houseOk} → ${pitacoOk ? 'PASS' : 'FAIL'}`);
  if (results.length > 0) {
    try {
      const { persistScrapedData } = await imp('src/scraping/index.ts');
      const stats = await persistScrapedData(results);
      log(ptLog, { persisted: stats });
    } catch (pe) {
      log(ptLog, `persist warning: ${pe}`);
    }
  }
} catch (e) {
  log(ptLog, `ERROR: ${e?.stack || e}`);
}

// ── Ranking / DB sample ──────────────────────────────────────────────────
const rankPath = path.join(SCRATCH, 'ranking-sample.json');
const covPath = path.join(SCRATCH, 'line-coverage.txt');
try {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
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
  // Kaio Jorge
  const kaio = await prisma.oddSnapshot.findMany({
    where: {
      player: { displayName: { contains: 'Kaio Jorge' } },
      market: { in: ['finalizacao', 'chutes_ao_gol'] },
      house: { in: ['betfair', 'pitaco', 'betmgm', 'superbet'] },
    },
    include: { player: true },
  });
  const kaioObj = {};
  for (const s of kaio) {
    const k = `${s.market}|${s.house}|${s.line}`;
    kaioObj[k] = s.value;
  }
  fs.writeFileSync(covPath, lines.join('\n') + '\n\nKaio Jorge:\n' + JSON.stringify(kaioObj, null, 2));
  fs.writeFileSync(
    rankPath,
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
  console.log('Wrote', rankPath, covPath);
} catch (e) {
  fs.writeFileSync(rankPath, JSON.stringify({ error: String(e) }));
  console.error('DB sample error', e);
}

// ── Structural check on adapter source ───────────────────────────────────
const adapterSrc = fs.readFileSync(path.join(ROOT, 'src/scraping/betfairAdapter.ts'), 'utf8');
const structural = {
  has1Ate3: adapterSrc.includes('1+ até 3+') || adapterSrc.includes('1+ ate 3+'),
  hasMostrarMaisAfterRange: /1\+\s*até\s*3[\s\S]{0,2500}clickShowMoreNear|clickShowMoreNear[\s\S]{0,800}harvestShots\(\[1,\s*2,\s*3\]/.test(
    adapterSrc,
  ),
  hasHarvest123: adapterSrc.includes('harvestShots([1, 2, 3])'),
  hasHarvest456: adapterSrc.includes('harvestShots([4, 5, 6])'),
};
log(bfLog, { structural });

const structuralOk = structural.has1Ate3 && structural.hasHarvest123 && structural.hasMostrarMaisAfterRange;

console.log('\n=== SUMMARY ===');
console.log({ betfairOk, pitacoOk, structuralOk });

// Live scrape must produce real odds — structural alone is NOT enough for PASS.
// (Skeptic: do not PASS on junk Equipe B or stale DB.)
if (!betfairOk) {
  console.error('VERIFICATION FAILED: Betfair live finalizacao 1+/2+/3+ missing');
  process.exit(1);
}
if (!pitacoOk) {
  console.error('VERIFICATION FAILED: Pitaco live finalizacao|sot missing');
  process.exit(1);
}
console.log('VERIFICATION PASS');
process.exit(0);
