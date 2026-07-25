import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Wait up to 3 more minutes
  const deadline = Date.now() + 180_000;
  let lastChecked = '';
  
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15000));
    
    const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (!log) continue;
    
    const status = `Status: ${log.status} bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk} odds:${log.oddCount}`;
    if (status !== lastChecked) {
      console.log(status);
      lastChecked = status;
    }
    
    if (log.status !== 'running') {
      console.log('\n=== SCRAPE COMPLETE ===');
      
      // Check Pitaco + BetMGM finalizacao
      const [ptF, mgmF] = await Promise.all([
        prisma.oddSnapshot.count({ where: { house: 'pitaco', market: 'finalizacao' } }),
        prisma.oddSnapshot.count({ where: { house: 'betmgm', market: 'finalizacao' } })
      ]);
      console.log(`Pitaco finalizacao: ${ptF}`);
      console.log(`BetMGM finalizacao: ${mgmF}`);

      // Erick Pulga latest odds
      const pulga = await prisma.player.findFirst({
        where: { displayName: { contains: 'Pulga' } }
      });
      if (pulga) {
        const snaps = await prisma.oddSnapshot.findMany({
          where: { 
            playerId: pulga.id,
            collectedAt: { gte: new Date(Date.now() - 600000) }
          },
          orderBy: [{ house: 'asc' }, { market: 'asc' }, { line: 'asc' }],
          take: 30
        });
        console.log(`\nErick Pulga (${pulga.team}) — odds recentes:`);
        let g = '';
        for (const s of snaps) {
          const k = `${s.house}::${s.market}`;
          if (k !== g) { console.log(`\n  ${s.house} — ${s.market}:`); g = k; }
          console.log(`    ${s.line} = ${s.value}`);
        }
        if (snaps.length === 0) console.log('  (sem dados recentes)');
      }
      
      await prisma.$disconnect();
      return;
    }
  }
  
  console.log('\nTIMEOUT - scrape still running');
  const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) console.log(`Last: bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk} odds:${log.oddCount}`);
  await prisma.$disconnect();
}

main().catch(err => { console.error(err); prisma.$disconnect(); });
