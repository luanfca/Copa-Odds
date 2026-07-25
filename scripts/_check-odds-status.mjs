import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
const since = new Date(Date.now() - 12 * 3600 * 1000);
const odds = await p.oddSnapshot.findMany({
  where: { collectedAt: { gte: since } },
  select: {
    house: true,
    market: true,
    line: true,
    value: true,
    player: { select: { name: true } },
  },
  take: 20000,
});
const by = {};
for (const o of odds) {
  const k = `${o.house}|${o.market || 'null'}`;
  by[k] = (by[k] || 0) + 1;
}
console.log('=== counts house|market (last 12h) ===');
for (const [k, v] of Object.entries(by).sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(k + ': ' + v);
}
const markets = ['desarmes', 'faltas_cometidas', 'finalizacao', 'chutes_ao_gol', 'faltas_sofridas'];
const houses = ['betfair', 'betmgm', 'superbet', 'pitaco'];
console.log('\n=== matrix ===');
for (const m of markets) {
  const row = houses.map((h) => `${h}:${odds.filter((o) => o.house === h && o.market === m).length}`);
  console.log(m, row.join(' '));
}
console.log('\n=== betfair faltas_cometidas sample ===');
console.log(
  odds
    .filter((o) => o.house === 'betfair' && o.market === 'faltas_cometidas')
    .slice(0, 20)
    .map((o) => ({ p: o.player?.name, line: o.line, v: o.value })),
);
console.log('\n=== pitaco desarmes sample ===');
console.log(
  odds
    .filter((o) => o.house === 'pitaco' && o.market === 'desarmes')
    .slice(0, 10)
    .map((o) => ({ p: o.player?.name, line: o.line, v: o.value })),
);
console.log('\n=== betmgm desarmes sample ===');
console.log(
  odds
    .filter((o) => o.house === 'betmgm' && o.market === 'desarmes')
    .slice(0, 10)
    .map((o) => ({ p: o.player?.name, line: o.line, v: o.value })),
);
await p['$disconnect']();
