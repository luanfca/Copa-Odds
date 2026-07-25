import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Check scrape status
  const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log('Scrape:', log.status, 'started:', log.startedAt?.toISOString().slice(11,19), 
      'finished:', (log.finishedAt?.toISOString() || 'running').slice(0, 19));
    console.log('  bf:', log.betfairOk, 'mgm:', log.betmgmOk, 'sb:', log.superbetOk, 'pt:', log.pitacoOk, 'odds:', log.oddCount);
  }

  // Erick Pulga - ALL Superbet finalizacao (most recent first)
  const pulga = await p.player.findFirst({ where: { displayName: { contains: 'Pulga' } } });
  if (pulga) {
    const sb = await p.oddSnapshot.findMany({
      where: { playerId: pulga.id, house: 'superbet', market: 'finalizacao' },
      orderBy: [{ collectedAt: 'desc' }],
      take: 20
    });
    console.log('\nSuperbet finalizacao (ALL records):');
    for (const s of sb) {
      console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
    }
    if (sb.length === 0) console.log('  (NO DATA - fix might not have been applied yet)');
    
    // Also check if ANY recent data was collected
    const recent = await p.oddSnapshot.count({
      where: { collectedAt: { gte: new Date(Date.now() - 600000) } }
    });
    console.log(`\nSnaps in last 10 min: ${recent}`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
