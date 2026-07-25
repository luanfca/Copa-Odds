import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Wait up to 5 minutes for scrape
  const deadline = Date.now() + 300_000;
  let checked = false;
  
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 15000));
    
    const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (!log || log.status === 'running') continue;
    
    if (!checked) {
      checked = true;
      console.log('SCRAPE FINALIZADO');
      console.log(`bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk}`);
      console.log(`odds:${log.oddCount} matches:${log.matchCount}`);
      
      // Erick Pulga - FINALIZACAO from ALL 4 houses (latest data)
      const player = await p.player.findFirst({
        where: { displayName: { contains: 'Pulga' } }
      });
      if (!player) { console.log('Pulga not found'); break; }
      
      // Get most recent data only (last 10 min)
      const recent = new Date(Date.now() - 600000);
      const snaps = await p.oddSnapshot.findMany({
        where: { 
          playerId: player.id, 
          market: 'finalizacao',
          collectedAt: { gte: recent }
        },
        orderBy: [{ collectedAt: 'desc' }],
        take: 50
      });
      
      if (snaps.length === 0) {
        console.log('\nNO RECENT FINALIZACAO DATA (using all data)');
        const allSnaps = await p.oddSnapshot.findMany({
          where: { playerId: player.id, market: 'finalizacao' },
          orderBy: [{ house: 'asc' }, { collectedAt: 'desc' }],
          take: 50
        });
        const seen = new Set();
        let lastHouse = '';
        for (const s of allSnaps) {
          const key = s.house + '::' + s.line;
          if (seen.has(key)) continue;
          seen.add(key);
          if (s.house !== lastHouse) {
            console.log(`\n${s.house.toUpperCase()}:`);
            lastHouse = s.house;
          }
          console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
        }
        break;
      }
      
      console.log('\nERICK PULGA - FINALIZACAO (dados recentes):');
      const seen = new Set();
      let lastHouse = '';
      for (const s of snaps) {
        const key = s.house + '::' + s.line;
        if (seen.has(key)) continue;
        seen.add(key);
        if (s.house !== lastHouse) {
          console.log(`\n${s.house.toUpperCase()}:`);
          lastHouse = s.house;
        }
        console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
      }
      break;
    }
  }
  
  if (!checked) {
    console.log('TIMEOUT - scrape still running');
    const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
    if (log) console.log(`Last status: ${log.status} bf:${log.betfairOk}`);
  }
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
