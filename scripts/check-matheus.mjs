import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const recent = new Date(Date.now() - 3600000);
const players = await prisma.player.findMany({
  where: { displayName: { contains: 'Matheus Pereira' } },
  include: {
    match: true,
    snapshots: {
      where: { house: 'betfair', line: '2+', collectedAt: { gte: recent } },
      orderBy: { collectedAt: 'desc' },
    },
  },
});

for (const p of players) {
  console.log(p.displayName, '(' + p.team + ')', '→', p.match.homeTeam, 'vs', p.match.awayTeam);
  if (p.snapshots.length === 0) {
    console.log('  ❌ NENHUMA odd Betfair 2+ no último scrape');
  }
  for (const s of p.snapshots) {
    console.log('  ' + s.market + ' 2+ = ' + s.value);
  }
}

await prisma.$disconnect();
