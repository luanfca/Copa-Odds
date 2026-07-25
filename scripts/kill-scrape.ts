import { prisma } from '../src/lib/prisma';

async function main() {
  // Kill stuck scrape
  const logs = await prisma.scrapeLog.findMany({ orderBy: { startedAt: 'desc' }, take: 3 });
  for (const log of logs) {
    console.log(`Scrape #${log.id}: status=${log.status} started=${log.startedAt?.toISOString()} finished=${log.finishedAt?.toISOString() || 'N/A'} error=${log.errorMsg || 'none'}`);
    console.log(`  bf=${log.betfairOk} mgm=${log.betmgmOk} sb=${log.superbetOk} pt=${log.pitacoOk} matches=${log.matchCount} odds=${log.oddCount}`);
  }

  // Kill the stuck one
  const stuck = logs.find(l => l.status === 'running');
  if (stuck) {
    await prisma.scrapeLog.update({
      where: { id: stuck.id },
      data: { status: 'error', errorMsg: 'Killed - stuck', finishedAt: new Date() }
    });
    console.log(`\nKilled stuck scrape #${stuck.id}`);
  }

  // Check data per house and market
  console.log('\n=== DATA PER HOUSE ===');
  const houses = ['betfair', 'betmgm', 'superbet', 'pitaco'];
  for (const h of houses) {
    const total = await prisma.oddSnapshot.count({ where: { house: h } });
    const markets = await prisma.oddSnapshot.findMany({
      where: { house: h },
      distinct: ['market'],
      select: { market: true }
    });
    const byMarket: string[] = [];
    for (const m of markets) {
      const cnt = await prisma.oddSnapshot.count({ where: { house: h, market: m.market } });
      byMarket.push(`${m.market}=${cnt}`);
    }
    console.log(`${h}: ${total} total — ${byMarket.join(', ')}`);
  }

  // Check Erick Pulga specifically ALL odds
  console.log('\n=== ERICK PULGA — ALL ODDS ===');
  const pulga = await prisma.player.findFirst({
    where: { displayName: { contains: 'Pulga' } },
    select: { id: true, displayName: true, team: true }
  });
  if (pulga) {
    const snaps = await prisma.oddSnapshot.findMany({
      where: { playerId: pulga.id },
      orderBy: [{ house: 'asc' }, { market: 'asc' }, { line: 'asc' }],
      take: 50
    });
    let lastKey = '';
    for (const s of snaps) {
      const key = `${s.house}::${s.market}`;
      if (key !== lastKey) {
        console.log(`\n${s.house} — ${s.market}:`);
        lastKey = key;
      }
      console.log(`  ${s.line} = ${s.value}`);
    }
  } else {
    console.log('Pulga not found!');
    // Search for the player
    const all = await prisma.player.findMany({
      where: { displayName: { contains: 'Pulga' } },
      select: { displayName: true, team: true }
    });
    console.log('Players with Pulga:', all);
  }

  console.log('\n=== RECENT SCRAPES ===');
  const recents = await prisma.scrapeLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: { startedAt: true, status: true, matchCount: true, oddCount: true, errorMsg: true }
  });
  for (const r of recents) {
    console.log(`${r.startedAt?.toISOString().slice(0, 19)} | ${r.status} | matches=${r.matchCount} | odds=${r.oddCount} | ${r.errorMsg || ''}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
