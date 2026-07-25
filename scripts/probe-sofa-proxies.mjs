#!/usr/bin/env node

const target =
  'https://www.sofascore.com/api/v1/sport/football/events/live';

const candidates = [
  ['workers-test', `https://test.cors.workers.dev/?${target}`],
  ['cors-sh', `https://proxy.cors.sh/${target}`],
  ['allorigins', `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`],
  ['corsproxy-io', `https://corsproxy.io/?url=${encodeURIComponent(target)}`],
  ['codetabs', `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(target)}`],
  ['cors-lol', `https://api.cors.lol/?url=${encodeURIComponent(target)}`],
  ['cors-x2u', `https://cors.x2u.in/${target}`],
  ['everyorigin', `https://everyorigin.jwvbremen.nl/get?url=${encodeURIComponent(target)}`],
  ['isomorphic-git', `https://cors.isomorphic-git.org/${target}`],
];

async function probe([name, url]) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        Origin: 'https://copa-odds.onrender.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
      },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
      if (typeof data?.contents === 'string') data = JSON.parse(data.contents);
    } catch {
      data = null;
    }
    const count = Array.isArray(data?.events) ? data.events.length : -1;
    console.log(
      JSON.stringify({
        name,
        status: response.status,
        ms: Date.now() - startedAt,
        bytes: text.length,
        events: count,
        sample: count >= 0 ? undefined : text.slice(0, 80),
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        name,
        ms: Date.now() - startedAt,
        error: String(error),
      }),
    );
  }
}

await Promise.all(candidates.map(probe));
