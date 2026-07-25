import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Wait for scrape to complete (max 3 min)
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 10000));
    const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (log && log.status !== 'running') {
      console.log('SCRAPE COMPLETE');
      console.log(`bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk}`);
      console.log(`odds:${log.oddCount}`);
      break;
    }
  }

  // Check Erick Pulga
  const pulga = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (!pulga) { console.log('Pulga not found'); return; }

  // Superbet finalizacao - latest data
  const sbFinal = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'superbet', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 20
  });
  console.log('\n=== SUPERBET — Finalização (após correção) ===');
  const seen = new Set();
  for (const s of sbFinal) {
    if (seen.has(s.line)) continue;
    seen.add(s.line);
    console.log(`  ${s.line} = ${s.value} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }
  if (sbFinal.length === 0) console.log('  (no data)');

  // BetMGM finalizacao
  const mgmFinal = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'betmgm', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 20
  });
  console.log('\n=== BETMGM — Finalização ===');
  const seen2 = new Set();
  for (const s of mgmFinal) {
    if (seen2.has(s.line)) continue;
    seen2.add(s.line);
    console.log(`  ${s.line} = ${s.value} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // Pitaco finalizacao
  const ptFinal = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'pitaco', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 20
  });
  console.log('\n=== PITACO — Finalização ===');
  const seen3 = new Set();
  for (const s of ptFinal) {
    if (seen3.has(s.line)) continue;
    seen3.add(s.line);
    console.log(`  ${s.line} = ${s.value} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // Betfair finalizacao
  const bfFinal = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'betfair', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 20
  });
  console.log('\n=== BETFAIR — Finalização ===');
  const seen4 = new Set();
  for (const s of bfFinal) {
    if (seen4.has(s.line)) continue;
    seen4.add(s.line);
    console.log(`  ${s.line} = ${s.value} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
