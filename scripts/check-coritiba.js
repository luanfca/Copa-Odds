const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const m = await p.match.findMany({
    where: {
      OR: [
        { homeTeam: { contains: 'Coritiba' } },
        { awayTeam: { contains: 'Coritiba' } },
        { homeTeam: { contains: 'Palmeiras' } },
        { awayTeam: { contains: 'Palmeiras' } }
      ]
    },
    select: {
      id: true, homeTeam: true, awayTeam: true, dateTime: true, competition: true,
      players: { select: { name: true, team: true, _count: { select: { snapshots: true } } } }
    }
  });
  console.log('Matches found:', m.length);
  for (const x of m) {
    const ts = x.players.reduce((a, pl) => a + pl._count.snapshots, 0);
    console.log(x.homeTeam, 'vs', x.awayTeam, '|', x.dateTime, '|', x.competition, '|', x.players.length, 'players,', ts, 'snapshots');
    if (x.players.length > 0) {
      x.players.filter(pl => pl._count.snapshots > 0).slice(0, 3).forEach(pl => console.log('   ', pl.name, '(' + pl.team + '):', pl._count.snapshots, 'snapshots'));
    }
  }

  // Check Coritiba in SERIE_A_2026
  const { SERIE_A_2026 } = require('../src/lib/brasileiraoStage.ts');

  // Also check if Coritiba is in any scraper team lists
  const normalize = require('../src/lib/normalize.ts');
  console.log('\n--- Checking normalization ---');
  console.log('coritiba normalized:', normalize.normalizeTeamName ? 'yes' : 'no');

  await p.$disconnect();
})();
