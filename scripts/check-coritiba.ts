import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
  // Find ALL matches involving Coritiba and Palmeiras
  const matches = await p.match.findMany({
    where: {
      OR: [
        { homeTeam: { contains: 'Coritiba' }, awayTeam: { contains: 'Palmeiras' } },
        { homeTeam: { contains: 'Palmeiras' }, awayTeam: { contains: 'Coritiba' } }
      ]
    },
    orderBy: { dateTime: 'desc' }
  });
  console.log('Matches found:', matches.length);
  for (const m of matches) {
    const pc = await p.player.count({ where: { matchId: m.id } });
    const sc = await p.oddSnapshot.count({ where: { player: { matchId: m.id } } });
    const bs = await p.oddSnapshot.groupBy({
      by: ['house'], where: { player: { matchId: m.id } }, _count: true
    });
    const houses = bs.map(b => b.house + ':' + b._count).join(', ');
    console.log(`  ${m.dateTime.toISOString().slice(0,10)} | ${m.homeTeam} vs ${m.awayTeam} | comp: ${m.competition} | players: ${pc} | snaps: ${sc} | ${houses}`);
    // Last snapshot time
    const last = await p.oddSnapshot.findFirst({
      where: { player: { matchId: m.id } },
      orderBy: { collectedAt: 'desc' },
      select: { collectedAt: true, house: true }
    });
    if (last) console.log(`    Last snap: ${last.collectedAt.toISOString()} (${last.house})`);
  }
  await p.$disconnect();
}
main().catch(console.error);
