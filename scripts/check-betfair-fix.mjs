import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Wait up to 5 min
  const deadline = Date.now() + 300_000;
  let checked = false;
  
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15000));
    const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (!log || log.status === 'running') continue;
    
    console.log('SCRAPE COMPLETE');
    console.log(`bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk} odds:${log.oddCount}`);
    checked = true;
    break;
  }
  
  if (!checked) {
    console.log('TIMEOUT - checking latest data anyway');
  }

  // Erick Pulga - BETFAIR finalizacao
  const player = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (!player) { console.log('Pulga not found'); await p.$disconnect(); return; }
  
  // Get latest Betfair finalizacao odds
  const snaps = await p.oddSnapshot.findMany({
    where: { playerId: player.id, house: 'betfair', market: 'finalizacao' },
    orderBy: [{ collectedAt: 'desc' }],
    take: 30
  });
  
  console.log('\nBETFAIR - Finalização (Erick Pulga):');
  const seen = new Set();
  for (const s of snaps) {
    const k = s.line;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }
  if (snaps.length === 0) console.log('  (no data)');

  // Show all houses for comparison
  console.log('\nTODAS AS CASAS - Finalização (dados mais recentes):');
  const allHouses = ['betfair', 'superbet', 'betmgm', 'pitaco'];
  for (const house of allHouses) {
    const hSnaps = await p.oddSnapshot.findMany({
      where: { playerId: player.id, house, market: 'finalizacao' },
      orderBy: [{ collectedAt: 'desc' }],
      take: 20
    });
    const hSeen = new Set();
    let hasData = false;
    for (const s of hSnaps) {
      const k = s.line;
      if (hSeen.has(k)) continue;
      hSeen.add(k);
      if (!hasData) { console.log(`\n${house.toUpperCase()}:`); hasData = true; }
      console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)}`);
    }
    if (!hasData) console.log(`\n${house.toUpperCase()}: (no data)`);
  }
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
