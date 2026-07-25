import { prisma } from '../src/lib/prisma';

async function main() {
  // Check Pitaco finalizacao
  const pitacoFinal = await prisma.oddSnapshot.count({
    where: { house: 'pitaco', market: 'finalizacao' }
  });
  console.log(`Pitaco finalizacao snaps: ${pitacoFinal}`);

  const pitacoFinalSample = await prisma.oddSnapshot.findFirst({
    where: { house: 'pitaco', market: 'finalizacao' },
    orderBy: { collectedAt: 'desc' },
    include: { player: { select: { displayName: true } } }
  });
  if (pitacoFinalSample) {
    console.log(`Pitaco finalizacao sample: player=${pitacoFinalSample.player.displayName} line=${pitacoFinalSample.line} val=${pitacoFinalSample.value}`);
  } else {
    console.log('No Pitaco finalizacao data found');
    
    // Check if Pitaco has ANY data for Bahia vs Chapecoense
    const pitacoBahia = await prisma.oddSnapshot.findFirst({
      where: {
        house: 'pitaco',
        player: { displayName: { contains: 'Pulga' } }
      },
      orderBy: { collectedAt: 'desc' }
    });
    console.log(`Pitaco Pulga data found: ${pitacoBahia ? 'YES - market=' + pitacoBahia.market + ' line=' + pitacoBahia.line + ' val=' + pitacoBahia.value : 'NO'}`);
    
    // Check all markets Pitaco has for any player in Bahia vs Chapecoense
    const pitacoMarkets = await prisma.oddSnapshot.findMany({
      where: {
        house: 'pitaco',
        player: { match: { homeTeam: 'Bahia', awayTeam: 'Chapecoense' } }
      },
      distinct: ['market'],
      select: { market: true }
    });
    console.log(`Pitaco markets for Bahia vs Chapecoense: ${pitacoMarkets.map(m => m.market).join(', ') || 'NONE'}`);
  }

  // Check BetMGM finalizacao
  const mgmFinal = await prisma.oddSnapshot.count({
    where: { house: 'betmgm', market: 'finalizacao' }
  });
  console.log(`\nBetMGM finalizacao snaps: ${mgmFinal}`);

  const mgmFinalSample = await prisma.oddSnapshot.findFirst({
    where: { house: 'betmgm', market: 'finalizacao' },
    orderBy: { collectedAt: 'desc' },
    include: { player: { select: { displayName: true } } }
  });
  if (mgmFinalSample) {
    console.log(`BetMGM finalizacao sample: player=${mgmFinalSample.player.displayName} line=${mgmFinalSample.line} val=${mgmFinalSample.value}`);
  } else {
    console.log('No BetMGM finalizacao data found');
  }

  // Wait for scrape and check again
  console.log('\n--- Scrape status ---');
  const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log(`Status: ${log.status}`);
    console.log(`Started: ${log.startedAt?.toISOString()}`);
    console.log(`Finished: ${log.finishedAt?.toISOString() || 'running...'}`);
    console.log(`betfair: ${log.betfairOk}, betmgm: ${log.betmgmOk}, superbet: ${log.superbetOk}, pitaco: ${log.pitacoOk}`);
    console.log(`odds: ${log.oddCount}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
