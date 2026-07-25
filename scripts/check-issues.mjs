import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const player = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (!player) { console.log('NOT FOUND'); return; }
  
  console.log('ERICK PULGA (' + player.team + ')\n');

  // 1) PITACO finalizacao - ALL lines
  console.log('=== PITACO - Finalização ===');
  const pitaco = await p.oddSnapshot.findMany({
    where: { playerId: player.id, market: 'finalizacao', house: 'pitaco' },
    orderBy: [{ collectedAt: 'desc' }],
    take: 20
  });
  const seen = new Set();
  for (const s of pitaco) {
    const k = s.line;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }
  if (pitaco.length === 0) console.log('  (no data)');

  // 2) BETFAIR finalizacao - ALL lines
  console.log('\n=== BETFAIR - Finalização ===');
  const betfair = await p.oddSnapshot.findMany({
    where: { playerId: player.id, market: 'finalizacao', house: 'betfair' },
    orderBy: [{ collectedAt: 'desc' }],
    take: 20
  });
  const seen2 = new Set();
  for (const s of betfair) {
    const k = s.line;
    if (seen2.has(k)) continue;
    seen2.add(k);
    console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }
  if (betfair.length === 0) console.log('  (no data)');

  // 3) How many total Pitaco finalizacao snaps for ANY player?
  const ptCount = await p.oddSnapshot.count({ where: { house: 'pitaco', market: 'finalizacao' } });
  console.log(`\n=== PITACO finalizacao total snaps: ${ptCount}`);

  // 4) Check ALL Pitaco finalizacao lines for ANY player (sample)
  const ptSample = await p.oddSnapshot.findMany({
    where: { house: 'pitaco', market: 'finalizacao' },
    distinct: ['line'],
    select: { line: true }
  });
  console.log('\nPitaco finalizacao - ALL lines stored in DB:');
  for (const s of ptSample) console.log(`  ${s.line}`);

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
