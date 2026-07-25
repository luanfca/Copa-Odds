#!/usr/bin/env node
const http = require('http');

const FAILING = [
  'L. Gustavo dos Santos', 'A. Veliz', 'C. Olivera', 'M. Victor',
  'Fredi', 'K. Junior', 'E. Carvalho', 'Z. Guilherme', 'R. Gomez'
];

function sofaJson(path) {
  return new Promise((resolve, reject) => {
    const url = 'http://127.0.0.1:54545' + path;
    http.get(url, { timeout: 30000 }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\./g, '').toLowerCase().trim();
}

function tokenize(s) {
  return normalize(s).split(' ').filter(Boolean);
}

function lev(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]!==b[j-1]?1:0));
  return dp[m][n];
}

function initialCompat(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

function nameMatch(pName, cName) {
  const p = tokenize(pName);
  const c = tokenize(cName);
  if (p.length === 0 || c.length === 0) return { match: false, reason: 'empty tokens' };
  const pNorm = p.join(' ');
  const cNorm = c.join(' ');
  if (pNorm === cNorm) return { match: true, reason: 'exact norm' };

  const pLast = p[p.length - 1];
  const cLast = c[c.length - 1];

  if (pLast === cLast) {
    if (p.length === 1 || c.length === 1) return { match: true, reason: `last="${pLast}" one-side-only` };
    const pSingleInit = p.length === 2 && p[0].length === 1;
    const cSingleInit = c.length === 2 && c[0].length === 1;
    if (pSingleInit) {
      for (const t of c.slice(0, -1)) {
        if (initialCompat(p[0], t)) return { match: true, reason: `init "${p[0]}" compat "${t}"` };
      }
    }
    if (cSingleInit) {
      for (const t of p.slice(0, -1)) {
        if (initialCompat(c[0], t)) return { match: true, reason: `init "${c[0]}" compat "${t}"` };
      }
    }
    if (initialCompat(p[0], c[0])) return { match: true, reason: `first init compat` };
    const sim = 1 - lev(p[0], c[0]) / Math.max(p[0].length, c[0].length);
    if (sim >= 0.5) return { match: true, reason: `fuzzy sim=${sim.toFixed(2)}` };
  }

  if (p.every(t => c.includes(t))) return { match: true, reason: 'all tokens contained' };
  if (p.length === 1 && p[0].length >= 4 && c.includes(p[0])) return { match: true, reason: 'single token in candidate' };

  return { match: false, reason: `no match: pLast="${pLast}" cLast="${cLast}"` };
}

async function main() {
  console.log('=== DIAGNÓSTICO BAHIA - 9 jogadores sem histórico ===\n');

  // 1) Buscar eventos do Bahia no Brasileirão
  const evData = await sofaJson('/team-events?team=Bahia&tournament=325');
  const events = (evData?.events || []).filter(e => e.status === 'finished' || (e.startTimestamp && e.startTimestamp * 1000 < Date.now()));
  console.log(`Eventos Bahia Brasileirão (finalizados): ${events.length}\n`);

  // 2) Para cada evento, buscar lineup/stats
  const sofaNames = new Set();
  const eventPlayers = [];

  for (const ev of events.slice(0, 5)) {
    const matchName = `${ev.homeTeam?.name || '?'} vs ${ev.awayTeam?.name || '?'}`;
    const psData = await sofaJson(`/player_stats?event_id=${ev.id}`);
    const players = psData?.players || [];
    const bahiaPlayers = players.filter(p => p.team === 'Bahia');
    console.log(`  Evento ${ev.id}: ${matchName} -> ${bahiaPlayers.length} jogadores Bahia`);
    for (const p of bahiaPlayers) {
      sofaNames.add(normalize(p.name));
      eventPlayers.push({ name: p.name, eventId: ev.id, minutes: p.minutes });
    }
  }

  console.log(`\nNomes únicos SofaScore Bahia (últimos 5 jogos):`);
  for (const n of [...sofaNames].sort()) console.log(`  ${n}`);

  // 3) Diagnosticar cada jogador que falha
  console.log(`\n=== DIAGNÓSTICO POR JOGADOR ===\n`);

  for (const failing of FAILING) {
    console.log(`--- ${failing} ---`);
    let anyMatch = false;
    for (const sp of eventPlayers) {
      const result = nameMatch(failing, sp.name);
      if (result.match) {
        console.log(`  ✓ MATCH com "${sp.name}" (${sp.eventId}) min=${sp.minutes} via: ${result.reason}`);
        anyMatch = true;
      }
    }
    if (!anyMatch) {
      // Mostrar os 3 mais próximos
      const scored = eventPlayers.map(sp => {
        const p = tokenize(failing);
        const c = tokenize(sp.name);
        const pLast = p[p.length - 1] || '';
        const cLast = c[c.length - 1] || '';
        let score = 0;
        if (pLast === cLast) score += 10;
        score += 1 - lev(normalize(failing), normalize(sp.name)) / Math.max(normalize(failing).length, normalize(sp.name).length);
        return { name: sp.name, score, reason: pLast === cLast ? 'last-name-match' : 'fuzzy' };
      }).sort((a, b) => b.score - a.score);
      console.log(`  ✗ NENHUM MATCH nos SofaScore`);
      console.log(`  Top 3 mais próximos:`);
      for (const s of scored.slice(0, 3)) {
        console.log(`    "${s.name}" (score=${s.score.toFixed(2)}, ${s.reason})`);
      }
    }
    console.log('');
  }
}

main().catch(e => console.error(e));
