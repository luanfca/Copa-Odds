const { PrismaClient } = require('.prisma/client');
const p = new PrismaClient();

(async () => {
  const m = await p.match.findFirst({
    where: { homeTeam: 'Coritiba', awayTeam: 'Palmeiras' },
  });
  if (!m) { console.log('No match'); await p.$disconnect(); return; }

  // Count players by house
  const players = await p.player.findMany({
    where: { matchId: m.id },
    include: { snapshots: true },
  });

  const houseCount = {};
  let totalSnaps = 0;
  for (const pl of players) {
    for (const s of pl.snapshots) {
      houseCount[s.house] = (houseCount[s.house] || 0) + 1;
      totalSnaps++;
    }
  }
  console.log('Total players:', players.length, 'Total snapshots:', totalSnaps);
  console.log('Snapshots by house:');
  for (const [h, c] of Object.entries(houseCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${h}: ${c}`);
  }

  // Check team distribution
  const teamCount = {};
  for (const pl of players) {
    const t = pl.team || '(empty)';
    teamCount[t] = (teamCount[t] || 0) + 1;
  }
  console.log('\nPlayers by team:');
  for (const [t, c] of Object.entries(teamCount).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${t}: ${c}`);
  }

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
