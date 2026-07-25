import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const pulga = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } },
    select: { id: true, displayName: true, team: true }
  });
  if (!pulga) { console.log('Pulga not found'); return; }

  console.log('=== ERICK PULGA - ALL ODDS (RAW) ===\n');

  // ALL snaps from the LATEST scrape (last 30 min)
  const recent = new Date(Date.now() - 1800000);
  const snaps = await p.oddSnapshot.findMany({
    where: {
      playerId: pulga.id,
      collectedAt: { gte: recent }
    },
    orderBy: [{ house: 'asc' }, { market: 'asc' }, { collectedAt: 'desc' }],
    take: 100
  });

  if (snaps.length === 0) {
    console.log('NO RECENT DATA - showing all-time data');
    const allSnaps = await p.oddSnapshot.findMany({
      where: { playerId: pulga.id },
      orderBy: [{ house: 'asc' }, { market: 'asc' }, { collectedAt: 'desc' }],
      take: 100
    });
    for (const s of allSnaps) {
      console.log(`${s.house} | mkt=${s.market} | line=${s.line} | val=${s.value} | ${s.collectedAt.toISOString().slice(11,19)}`);
    }
    return;
  }

  // Group by house + market, showing unique line+value pairs
  const seen = new Set();
  for (const s of snaps) {
    const key = `${s.house}::${s.market}::${s.line}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`${s.house.padEnd(10)} | ${s.market.padEnd(18)} | ${s.line.padEnd(4)} = ${s.value.toFixed(3).padStart(8)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // Also check Superbet: what raw markets exist for Bahia vs Chapecoense
  console.log('\n=== SUPERBET - ALL RAW MARKETS for Bahia vs Chapecoense ===');
  const baCha = await p.match.findFirst({
    where: { homeTeam: 'Bahia', awayTeam: 'Chapecoense' }
  });
  if (baCha) {
    const sbPlayers = await p.player.findMany({
      where: { matchId: baCha.id },
      select: { id: true, displayName: true, team: true }
    });
    for (const pl of sbPlayers) {
      const plSnaps = await p.oddSnapshot.findMany({
        where: {
          playerId: pl.id,
          house: 'superbet',
          market: 'finalizacao',
          collectedAt: { gte: recent }
        },
        orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
        take: 20
      });
      if (plSnaps.length > 0) {
        console.log(`\n  ${pl.displayName} (${pl.team}) — finalizacao:`);
        const seen2 = new Set();
        for (const s of plSnaps) {
          const k = s.line;
          if (seen2.has(k)) continue;
          seen2.add(k);
          console.log(`    ${s.line} = ${s.value.toFixed(3)}`);
        }
      }
    }
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
