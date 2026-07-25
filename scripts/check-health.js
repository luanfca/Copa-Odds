const http = require('http');

function fetch(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
  });
}

(async () => {
  try {
    const r = await fetch('http://127.0.0.1:3000/api/admin/health');
    const j = JSON.parse(r.body);
    console.log(JSON.stringify(j, null, 2));
  } catch (e) {
    console.log('Error:', e.message);
  }
})();
