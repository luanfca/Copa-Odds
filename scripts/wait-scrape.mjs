import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function waitAndReport() {
  console.log('Aguardando scrape...');
  const maxWait = Date.now() + 300_000; // 5 min max
  
  while (Date.now() < maxWait) {
    await new Promise(r => setTimeout(r, 10000)); // check every 10s
    
    const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (!log) continue;
    
    if (log.status !== 'running') {
      console.log('\n=== SCRAPE COMPLETED ===');
      console.log(`Status: ${log.status}`);
      console.log(`betfair: ${log.betfairOk}`);
      console.log(`betmgm: ${log.betmgmOk}`);
      console.log(`superbet: ${log.superbetOk}`);
      console.log(`pitaco: ${log.pitacoOk}`);
      console.log(`matches: ${log.matchCount}, odds: ${log.oddCount}`);
      console.log(`error: ${log.errorMsg || 'none'}`);

      // Check Pitaco finalizacao
      const pitacoFinal = await prisma.oddSnapshot.count({ where: { house: 'pitaco', market: 'finalizacao' } });
      console.log(`\nPitaco finalizacao ALL TIME: ${pitacoFinal}`);
      
      // Check BetMGM finalizacao
      const mgmFinal = await prisma.oddSnapshot.count({ where: { house: 'betmgm', market: 'finalizacao' } });
      console.log(`BetMGM finalizacao ALL TIME: ${mgmFinal}`);

      // Check Erick Pulga - ALL houses finalizacao
      const pulgaFinal = await prisma.oddSnapshot.findMany({
        where: { 
          market: 'finalizacao',
          player: { displayName: { contains: 'Pulga' } }
        },
        orderBy: [{ house: 'asc' }, { line: 'asc' }],
        take: 20
      });
      if (pulgaFinal.length > 0) {
        console.log('\nErick Pulga — Finalização (Chutes):');
        for (const s of pulgaFinal) {
          console.log(`  ${s.house} | ${s.line} = ${s.value}`);
        }
      } else {
        console.log('\nErick Pulga: NENHUM dado de finalização');
      }

      // Check Erick Pulga BETFAIR all markets (latest)
      const pulgaBetfair = await prisma.oddSnapshot.findMany({
        where: { 
          player: { displayName: { contains: 'Pulga' } },
          house: 'betfair',
          collectedAt: { gte: new Date(Date.now() - 3600000) } // last hour
        },
        orderBy: [{ market: 'asc' }, { line: 'asc' }],
        take: 20
      });
      if (pulgaBetfair.length > 0) {
        console.log('\nErick Pulga — Betfair (dados recentes):');
        for (const s of pulgaBetfair) {
          console.log(`  ${s.market} | ${s.line} = ${s.value}`);
        }
      }

      await prisma.$disconnect();
      return;
    }
  }
  
  console.log('\nTIMEOUT - scrape still running');
  const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log(`Status: ${log.status}`);
    console.log(`bf: ${log.betfairOk}, mgm: ${log.betmgmOk}, sb: ${log.superbetOk}, pt: ${log.pitacoOk}`);
  }
  await prisma.$disconnect();
}

waitAndReport().catch(err => { console.error(err); prisma.$disconnect(); });
