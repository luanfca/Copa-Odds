import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log('Latest scrape:');
    console.log(`  Status: ${log.status}`);
    console.log(`  Started: ${log.startedAt?.toISOString().slice(11,19)}`);
    console.log(`  Finished: ${log.finishedAt?.toISOString().slice(11,19) || 'running'}`);
    console.log(`  bf:${log.betfairOk} mgm:${log.betmgmOk} sb:${log.superbetOk} pt:${log.pitacoOk}`);
    console.log(`  odds:${log.oddCount}`);
    console.log(`  error: ${log.errorMsg || 'none'}`);
  }

  // Kill if running
  if (log && log.status === 'running') {
    await p.scrapeLog.update({
      where: { id: log.id },
      data: { status: 'error', errorMsg: 'Killed - timeout', finishedAt: new Date() }
    });
    console.log('  -> KILLED');
  }

  // Check Erick Pulga - ALL Betfair finalizacao (latest per line)
  const player = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (player) {
    const snaps = await p.oddSnapshot.findMany({
      where: { playerId: player.id, house: 'betfair', market: 'finalizacao' },
      orderBy: [{ collectedAt: 'desc' }],
      take: 30
    });
    console.log('\nBetfair finalizacao (ALL records):');
    const seen = new Set();
    for (const s of snaps) {
      const k = s.line;
      if (seen.has(k)) continue;
      seen.add(k);
      console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
    }
    if (snaps.length === 0) console.log('  (no data)');

    // Check if any betfair data was collected in the last 30 min
    const recent = new Date(Date.now() - 1800000);
    const recentBf = await p.oddSnapshot.count({
      where: { house: 'betfair', collectedAt: { gte: recent } }
    });
    console.log(`\nBetfair snaps in last 30 min: ${recentBf}`);
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
