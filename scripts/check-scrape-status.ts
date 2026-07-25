import { prisma } from '../src/lib/prisma';

async function main() {
  // Check latest scrape log
  const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log('=== LAST SCRAPE ===');
    console.log(`Status: ${log.status}`);
    console.log(`Started: ${log.startedAt?.toISOString()}`);
    console.log(`Finished: ${log.finishedAt?.toISOString() || 'N/A'}`);
    console.log(`Errors: ${log.errorMsg || 'none'}`);
    console.log(`betfair: ${log.betfairOk}, betmgm: ${log.betmgmOk}, superbet: ${log.superbetOk}, pitaco: ${log.pitacoOk}`);
    console.log(`matches: ${log.matchCount}, odds: ${log.oddCount}`);
  }

  // Check if there is ANY finalizacao data from Pitaco at all
  const pitacoFinal = await prisma.oddSnapshot.count({ where: { house: 'pitaco', market: 'finalizacao' } });
  console.log(`\nPitaco finalizacao ALL TIME: ${pitacoFinal}`);

  // Check BetMGM finalizacao ALL TIME
  const mgmFinal = await prisma.oddSnapshot.count({ where: { house: 'betmgm', market: 'finalizacao' } });
  console.log(`BetMGM finalizacao ALL TIME: ${mgmFinal}`);

  // Check ALL Pitaco markets available
  const pitacoMarkets = await prisma.oddSnapshot.findMany({
    where: { house: 'pitaco' },
    distinct: ['market'],
    select: { market: true }
  });
  console.log(`\nPitaco ALL markets ever collected:`);
  for (const m of pitacoMarkets) console.log(`  - ${m.market}`);

  // Check for any "Pulga" named players more broadly
  const allPulga = await prisma.player.findMany({
    where: { displayName: { contains: 'Pulga' } },
    select: { id: true, displayName: true, name: true, team: true }
  });
  console.log(`\nPlayers with 'Pulga' in name: ${allPulga.length}`);
  for (const p of allPulga) {
    console.log(`  ID: ${p.id}, displayName: "${p.displayName}", name: "${p.name}", team: ${p.team}`);
    // Check all snaps for this player
    const snaps = await prisma.oddSnapshot.findMany({
      where: { playerId: p.id },
      orderBy: { collectedAt: 'desc' },
      take: 20
    });
    for (const s of snaps) {
      console.log(`    ${s.house} | mkt=${s.market} | line=${s.line} | val=${s.value} | collected=${s.collectedAt.toISOString()}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
