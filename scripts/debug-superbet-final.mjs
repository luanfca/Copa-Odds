import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Find Erick Pulga
  const pulga = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (!pulga) { console.log('Pulga not found'); return; }

  // 1) ALL Superbet odds for Erick Pulga
  console.log('=== ERICK PULGA — SUPERBET ALL ODDS ===');
  const sbSnaps = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'superbet' },
    orderBy: [{ market: 'asc' }, { line: 'asc' }, { collectedAt: 'desc' }],
    take: 30
  });
  const seen = new Set();
  for (const s of sbSnaps) {
    const k = s.market + '::' + s.line;
    if (seen.has(k)) continue;
    seen.add(k);
    console.log(`  ${s.market.padEnd(18)} | ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // 2) ALL Betfair finalizacao for Erick Pulga
  console.log('\n=== ERICK PULGA — BETFAIR FINALIZACAO ===');
  const bfSnaps = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'betfair', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 10
  });
  const seen2 = new Set();
  for (const s of bfSnaps) {
    const k = s.line;
    if (seen2.has(k)) continue;
    seen2.add(k);
    console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // 3) ALL BetMGM finalizacao for Erick Pulga
  console.log('\n=== ERICK PULGA — BETMGM FINALIZACAO ===');
  const mgmSnaps = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'betmgm', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 10
  });
  const seen3 = new Set();
  for (const s of mgmSnaps) {
    const k = s.line;
    if (seen3.has(k)) continue;
    seen3.add(k);
    console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // 4) ALL Pitaco finalizacao for Erick Pulga
  console.log('\n=== ERICK PULGA — PITACO FINALIZACAO ===');
  const ptSnaps = await p.oddSnapshot.findMany({
    where: { playerId: pulga.id, house: 'pitaco', market: 'finalizacao' },
    orderBy: [{ line: 'asc' }, { collectedAt: 'desc' }],
    take: 10
  });
  const seen4 = new Set();
  for (const s of ptSnaps) {
    const k = s.line;
    if (seen4.has(k)) continue;
    seen4.add(k);
    console.log(`  ${s.line.padEnd(4)} = ${s.value.toFixed(3)} | ${s.collectedAt.toISOString().slice(11,19)}`);
  }

  // 5) Check Superbet: show ALL unique market names stored for any player in Bahia vs Chapecoense
  console.log('\n=== SUPERBET — ALL MARKET NAMES for Bahia vs Chapecoense ===');
  const match = await p.match.findFirst({
    where: { homeTeam: 'Bahia', awayTeam: 'Chapecoense' }
  });
  if (match) {
    const uniqueMarkets = await p.oddSnapshot.findMany({
      where: { 
        house: 'superbet',
        player: { matchId: match.id }
      },
      distinct: ['market'],
      select: { market: true }
    });
    console.log('Markets stored:', uniqueMarkets.map(m => m.market).join(', '));

    // Count by market
    for (const m of uniqueMarkets) {
      const cnt = await p.oddSnapshot.count({
        where: { house: 'superbet', market: m.market, player: { matchId: match.id } }
      });
      console.log(`  ${m.market}: ${cnt} odds`);
    }
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
