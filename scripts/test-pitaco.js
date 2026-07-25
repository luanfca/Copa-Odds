// Test Pitaco API directly
const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    }).on('error', reject);
  });
}

(async () => {
  console.log('Testing Pitaco API...');

  // Try to fetch Coritiba vs Palmeiras from Pitaco
  // Pitaco typically uses bet IDs
  try {
    const r = await fetch('https://www.pitaco.com/api/cotacoes?campeonato=brasileirao');
    console.log('Pitaco status:', r.status);
    console.log('Body length:', r.body.length);
    console.log('First 500 chars:', r.body.substring(0, 500));
  } catch (e) {
    console.log('Pitaco fetch error:', e.message);
  }

  // Also check if the scraper is running
  try {
    const r = await fetch('http://127.0.0.1:3000/api/admin/health');
    if (r.status === 200) {
      const j = JSON.parse(r.body);
      console.log('\nHealth check:');
      console.log('  Last scrape:', j.lastScrape ? JSON.stringify(j.lastScrape) : 'none');
    }
  } catch (e) {
    console.log('Health check error:', e.message);
  }
})().catch(console.error);
