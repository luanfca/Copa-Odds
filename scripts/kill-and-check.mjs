import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Check latest scrape
  const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log('Latest scrape:');
    console.log(`  Status: ${log.status}`);
    console.log(`  Started: ${log.startedAt?.toISOString().slice(11,19)}`);
    console.log(`  Finished: ${log.finishedAt?.toISOString().slice(11,19) || 'running'}`);
    console.log(`  bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk}`);
    console.log(`  odds:${log.oddCount}`);
    
    // Kill if stuck
    if (log.status === 'running') {
      await p.scrapeLog.update({
        where: { id: log.id },
        data: { status: 'error', errorMsg: 'Stuck - killed', finishedAt: new Date() }
      });
      console.log('  -> KILLED');
    }
  }

  // Show last 3 scrapes for pattern
  console.log('\nLast 3 scrapes:');
  const logs = await p.scrapeLog.findMany({ orderBy: { startedAt: 'desc' }, take: 3 });
  for (const l of logs) {
    const dur = l.finishedAt ? Math.round((l.finishedAt.getTime() - l.startedAt.getTime()) / 1000) + 's' : 'N/A';
    console.log(`  ${l.startedAt.toISOString().slice(11,19)} | ${l.status.padEnd(10)} | ${dur.padEnd(6)} | bf:${String(l.betfairOk)[0]} mgm:${String(l.betmgmOk)[0]} sb:${String(l.superbetOk)[0]} pt:${String(l.pitacoOk)[0]} odds:${l.oddCount}`);
  }

  // Check Erick Pulga - latest Betfair finalizacao from LAST SUCCESSFUL scrape
  console.log('\nErick Pulga - Betfair finalizacao (ALL data):');
  const player = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (player) {
    const snaps = await p.oddSnapshot.findMany({
      where: { playerId: player.id, house: 'betfair', market: 'finalizacao' },
      orderBy: [{ collectedAt: 'desc' }],
      take: 20
    });
    const seen = new Set();
    for (const s of snaps) {
      const key = s.line;
      if (seen.has(key)) continue;
      seen.add(key);
      console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
    }
    if (snaps.length === 0) console.log('  (no data)');
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
