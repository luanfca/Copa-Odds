import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const names = ['wallisson', 'luighi', 'fernando sobral', 'jhon arias'];
const rows = await p.oddSnapshot.findMany({
  where: {
    house: 'betfair',
    market: 'faltas_cometidas',
    collectedAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) },
  },
  include: { player: { include: { match: true } } },
  orderBy: { collectedAt: 'desc' },
  take: 8000,
});
const by = {};
for (const o of rows) {
  const n = (o.player?.name || '').toLowerCase();
  if (!names.some((t) => n.includes(t))) continue;
  const key =
    n +
    '|' +
    (o.player?.match?.homeTeam || '') +
    '|' +
    (o.player?.match?.awayTeam || '');
  if (!by[key]) {
    by[key] = {
      match:
        (o.player?.match?.homeTeam || '') +
        ' x ' +
        (o.player?.match?.awayTeam || ''),
      player: o.player?.name,
      lines: {},
      newest: o.collectedAt,
    };
  }
  if (by[key].lines[o.line] == null) {
    by[key].lines[o.line] = { v: o.value, at: o.collectedAt };
  }
}
console.log('=== newest betfair faltas (last 24h) for key players ===');
console.log(JSON.stringify(Object.values(by), null, 2));

// Also dump any non-monotonic recent faltas
let bad = 0;
const seen = new Map();
for (const o of rows) {
  const pk = o.playerId + '|' + o.player?.name;
  if (!seen.has(pk)) seen.set(pk, {});
  const L = seen.get(pk);
  if (L[o.line] == null) L[o.line] = o.value;
}
for (const [pk, L] of seen) {
  if (L['1+'] && L['2+'] && L['1+'] >= L['2+']) {
    bad++;
    if (bad <= 8) console.log('BAD mono', pk, L);
  }
}
console.log('players with 1+>=2+ among recent sample:', bad);
const c2h = await p.oddSnapshot.count({
  where: {
    house: 'betfair',
    market: 'faltas_cometidas',
    collectedAt: { gte: new Date(Date.now() - 2 * 3600 * 1000) },
  },
});
console.log('count last 2h', c2h);
await p.$disconnect();
