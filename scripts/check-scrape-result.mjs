// Script to wait for scrape and check results
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function waitAndCheck() {
  // Wait max 3 minutes for scrape to complete
  const maxWait = Date.now() + 180_000;
  
  while (Date.now() < maxWait) {
    const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (log && log.status === 'completed') {
      console.log('SCRAPE COMPLETED');
      console.log(`Status: ${log.status}`);
      console.log(`Finished: ${log.finishedAt?.toISOString()}`);
      console.log(`betfair: ${log.betfairOk}, betmgm: ${log.betmgmOk}, superbet: ${log.superbetOk}, pitaco: ${log.pitacoOk}`);
      console.log(`matches: ${log.matchCount}, odds: ${log.oddCount}`);
      
      // Check Pitaco finalizacao
      const pitacoFinal = await prisma.oddSnapshot.count({ where: { house: 'pitaco', market: 'finalizacao' } });
      console.log(`\nPitaco finalizacao snaps: ${pitacoFinal}`);
      
      // Check BetMGM finalizacao
      const mgmFinal = await prisma.oddSnapshot.count({ where: { house: 'betmgm', market: 'finalizacao' } });
      console.log(`BetMGM finalizacao snaps: ${mgmFinal}`);
      
      // Check Erick Pulga finalizacao from Betfair
      const pulgaFinal = await prisma.oddSnapshot.findMany({
        where: { market: 'finalizacao', player: { displayName: { contains: 'Pulga' } } },
        take: 10,
        orderBy: { collectedAt: 'desc' },
        include: { player: { select: { displayName: true, team: true } } }
      });
      if (pulgaFinal.length > 0) {
        console.log(`\nErick Pulga finalizacao:`);
        for (const s of pulgaFinal) {
          console.log(`  ${s.house} | line=${s.line} | val=${s.value}`);
        }
      } else {
        console.log('\nErick Pulga: NO finalizacao data found');
      }

      // Check Pulga ALL markets from Betfair
      const pulgaAll = await prisma.oddSnapshot.findMany({
        where: { player: { displayName: { contains: 'Pulga' } }, house: 'betfair' },
        take: 20,
        orderBy: { collectedAt: 'desc' }
      });
      console.log(`\nErick Pulga Betfair ALL markets:`);
      for (const s of pulgaAll) {
        console.log(`  mkt=${s.market} | line=${s.line} | val=${s.value}`);
      }
      
      await prisma.$disconnect();
      return;
    }
    
    // Wait 5 seconds before checking again
    await new Promise(r => setTimeout(r, 5000));
  }
  
  console.log('TIMEOUT - scrape did not complete within 3 minutes');
  const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log(`Last status: ${log.status}`);
    console.log(`betfair: ${log.betfairOk}, betmgm: ${log.betmgmOk}, superbet: ${log.superbetOk}, pitaco: ${log.pitacoOk}`);
  }
  await prisma.$disconnect();
}

waitAndCheck().catch(err => {
  console.error('Error:', err);
  prisma.$disconnect();
});
