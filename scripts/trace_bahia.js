// Simula exatamente o fluxo da route.ts para jogadores do Bahia
const http = require('http');

function sofaJson(path) {
  return new Promise((resolve, reject) => {
    const url = `http://127.0.0.1:54545${path}`;
    http.get(url, { timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error(`JSON parse error: ${data.slice(0,200)}`)); }
      });
    }).on('error', reject).on('timeout', function() { this.destroy(); reject(new Error('timeout')); });
  });
}

function normalizeName(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').trim();
}

function isNameMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return true;
  const aTokens = na.split(' ').filter(Boolean);
  const bTokens = nb.split(' ').filter(Boolean);
  const aLast = aTokens[aTokens.length - 1] || '';
  const bLast = bTokens[bTokens.length - 1] || '';
  if (aLast !== bLast) return false;
  if (aTokens.length === 2 && aTokens[0].length === 1 && nb.startsWith(aTokens[0])) return true;
  if (bTokens.length === 2 && bTokens[0].length === 1 && na.startsWith(bTokens[0])) return true;
  return false;
}

async function main() {
  const teamName = 'Bahia';
  const tournamentId = 325;
  
  // Step 1: getTeamFinishedEvents
  console.log(`\n=== Step 1: getTeamFinishedEvents('${teamName}', tournamentId=${tournamentId}) ===`);
  let url = `/team-events?team=${encodeURIComponent(teamName)}&tournament=${tournamentId}`;
  console.log(`URL: ${url}`);
  const data = await sofaJson(url);
  if (!data?.events) { console.log('NO EVENTS'); return; }
  
  const now = Date.now() / 1000;
  const events = data.events.filter(ev => {
    const ts = ev.startTimestamp ?? 0;
    return ts > 0 && ts < now;
  });
  console.log(`Events total: ${data.events.length}, past events: ${events.length}`);
  for (const ev of events.slice(0, 5)) {
    const tName = ev.tournament?.uniqueTournament?.name ?? ev.tournament?.name ?? '???';
    const tId = ev.tournament?.uniqueTournament?.id ?? 0;
    console.log(`  ${ev.id}: ${ev.homeTeam?.name} vs ${ev.awayTeam?.name} (${tName} id=${tId}) ts=${ev.startTimestamp}`);
  }
  
  // Step 2: Filter by tournamentId
  console.log(`\n=== Step 2: Filter by tournamentId=${tournamentId} ===`);
  const filtered = events.filter(ev => (ev.tournament?.uniqueTournament?.id ?? 0) === tournamentId);
  console.log(`After filter: ${filtered.length} events`);
  
  // Step 3: For first event, get player_stats
  const firstEvent = filtered[0];
  if (!firstEvent) { console.log('NO FILTERED EVENTS'); return; }
  
  console.log(`\n=== Step 3: player_stats for event ${firstEvent.id} ===`);
  const statsData = await sofaJson(`/player_stats?event_id=${firstEvent.id}`);
  console.log(`Players returned: ${statsData?.players?.length ?? 0}`);
  
  // Bahia team name from the event
  const bahiaSide = firstEvent.homeTeam?.name === 'Bahia' ? 'home' : 'away';
  const bahiaTeamName = bahiaSide === 'home' ? firstEvent.homeTeam?.name : firstEvent.awayTeam?.name;
  console.log(`Bahia is ${bahiaSide} side: ${bahiaTeamName}`);
  
  const bahiaPlayers = (statsData?.players || []).filter(p => p.team === bahiaTeamName);
  console.log(`Bahia players in game: ${bahiaPlayers.length}`);
  for (const p of bahiaPlayers) {
    console.log(`  "${p.name}" team="${p.team}" min=${p.minutes} tackles=${p.tackles}`);
  }
  
  // Step 4: Match DB players
  console.log(`\n=== Step 4: Name matching ===`);
  const dbPlayers = ['Kanu', 'R. Mingo', 'D. Duarte', 'M. Sanabria', 'A. Veliz', 'C. Olivera', 'W. José', 'Ademir', 'Everaldo', 'K. Junior'];
  for (const dbName of dbPlayers) {
    const match = bahiaPlayers.find(sp => isNameMatch(dbName, sp.name));
    console.log(`  DB "${dbName}" -> ${match ? `MATCH "${match.name}"` : 'NO MATCH'}`);
  }
  
  // Step 5: Test all events
  console.log(`\n=== Step 5: All events player availability ===`);
  for (const ev of filtered.slice(0, 5)) {
    try {
      const sd = await sofaJson(`/player_stats?event_id=${ev.id}`);
      const evBahiaPlayers = (sd?.players || []).filter(p => p.team === 'Bahia');
      console.log(`  Event ${ev.id} (${ev.homeTeam?.name} vs ${ev.awayTeam?.name}): ${evBahiaPlayers.length} Bahia players`);
    } catch(e) {
      console.log(`  Event ${ev.id}: ERROR ${e.message}`);
    }
  }
}

main().catch(e => console.error('FATAL:', e));
