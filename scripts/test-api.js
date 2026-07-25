// Test the API endpoint to see what history looks like
const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 120000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

(async () => {
  // Get the Coritiba vs Palmeiras match ID
  const matchId = 'cmrtahzcc16xvu8a7zj0raggs';

  console.log('Fetching desarmes data for Coritiba vs Palmeiras...');
  try {
    const r = await fetch(`http://127.0.0.1:3000/api/desarmes?matchId=${matchId}&maxGames=5&year=2026`);
    console.log('Status:', r.status);
    const j = JSON.parse(r.body);

    if (j.players) {
      // Find Palmeiras players
      const palmeiras = j.players.filter((p) => p.team === 'Palmeiras');
      const emptyTeam = j.players.filter((p) => !p.team || p.team === '');

      console.log('\nPalmeiras players (team=Palmeiras):', palmeiras.length);
      for (const p of palmeiras.slice(0, 5)) {
        console.log(`  ${p.displayName} team=${p.team} history=${JSON.stringify(p.history)}`);
      }

      console.log('\nEmpty team players:', emptyTeam.length);
      for (const p of emptyTeam.slice(0, 5)) {
        console.log(`  ${p.displayName} team="${p.team}" history=${JSON.stringify(p.history)}`);
      }
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
})().catch(console.error);
