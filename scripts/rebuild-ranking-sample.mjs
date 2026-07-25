import path from 'path';
import fs from 'fs';
import { pathToFileURL } from 'url';

const SCRATCH =
  process.env.GOAL_SCRATCH ||
  'C:/Users/LuanADM/AppData/Local/Temp/grok-goal-cb5f7204be54/implementer';
fs.mkdirSync(SCRATCH, { recursive: true });

const { buildLightRanking, setApiSnapshot, rankingSnapshotKey } = await import(
  pathToFileURL(path.resolve('src/lib/apiSnapshot.ts')).href
);
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

for (const market of ['finalizacao', 'chutes_ao_gol']) {
  const light = await buildLightRanking(market, false, undefined);
  await setApiSnapshot(rankingSnapshotKey(market, false, undefined), 'ranking', light);
  const kaio = (light.players || []).filter((p) => /kaio jorge/i.test(p.displayName));
  const sample = kaio.slice(0, 2).map((p) => ({
    name: p.displayName,
    houses: [...new Set((p.odds || []).map((o) => o.house))],
    odds: (p.odds || []).map((o) => `${o.house}:${o.line}=${o.value}`),
  }));
  console.log(market, 'players', light.players?.length, 'kaio', JSON.stringify(sample, null, 2));
  fs.writeFileSync(
    path.join(SCRATCH, `ranking-${market}.json`),
    JSON.stringify({ total: light.players?.length, kaio: sample }, null, 2),
  );
}

const kaio = await prisma.oddSnapshot.findMany({
  where: {
    player: { displayName: { contains: 'Kaio Jorge' } },
    market: { in: ['finalizacao', 'chutes_ao_gol'] },
    house: { in: ['betfair', 'pitaco', 'betmgm', 'superbet'] },
  },
});
const kaioObj = {};
for (const s of kaio) kaioObj[`${s.market}|${s.house}|${s.line}`] = s.value;
const sample = {
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
};
fs.writeFileSync(path.join(SCRATCH, 'ranking-sample.json'), JSON.stringify(sample, null, 2));
console.log('ranking-sample', sample);

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
fs.writeFileSync(path.join(SCRATCH, 'line-coverage.txt'), lines.join('\n'));
await prisma.$disconnect();

const ok = sample.betfairFinHas123 && sample.pitacoFinHas123 && sample.activeHousesOnly;
console.log(ok ? 'RANKING SAMPLE PASS' : 'RANKING SAMPLE FAIL');
process.exit(ok ? 0 : 1);
