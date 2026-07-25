const { PrismaClient } = require('.prisma/client');
const p = new PrismaClient();

(async () => {
  const m = await p.match.findFirst({
    where: { homeTeam: 'Coritiba', awayTeam: 'Palmeiras' },
  });
  if (!m) { console.log('No match'); await p.$disconnect(); return; }

  // Get ALL players with snapshots
  const players = await p.player.findMany({
    where: { matchId: m.id },
    include: {
      snapshots: {
        select: { house: true, collectedAt: true },
        orderBy: { collectedAt: 'desc' },
      },
    },
  });

  // Show all unique displayNames with house breakdown
  const byDisplayName = {};
  for (const pl of players) {
    if (!byDisplayName[pl.displayName]) byDisplayName[pl.displayName] = { team: pl.team, houses: {} };
    for (const s of pl.snapshots) {
      byDisplayName[pl.displayName].houses[s.house] = (byDisplayName[pl.displayName].houses[s.house] || 0) + 1;
    }
  }

  // Show ALL Palmeiras-named players
  const palmeirasKeywords = ['barboza', 'pereira', 'gomez', 'lopez', 'weverton', 'murilo', 'rony', 'vander', 'caul', 'mayke', 'pimenta', 'veron', 'artur', 'rafael', 'gabi'];
  console.log('=== PALMEIRAS PLAYERS (by name match) ===');
  for (const [name, info] of Object.entries(byDisplayName)) {
    const lower = name.toLowerCase();
    if (palmeirasKeywords.some(k => lower.includes(k))) {
      console.log(`  "${name}" team="${info.team}" houses: ${JSON.stringify(info.houses)}`);
    }
  }

  // Show ALL empty-team players
  console.log('\n=== EMPTY TEAM PLAYERS (first 20) ===');
  let count = 0;
  for (const [name, info] of Object.entries(byDisplayName)) {
    if (!info.team && count < 20) {
      console.log(`  "${name}" team="" houses: ${JSON.stringify(info.houses)}`);
      count++;
    }
  }

  // Show players from Pitaco
  const pitacoPlayers = await p.playerSnapshot.findMany({
    where: { player: { matchId: m.id }, house: 'pitaco' },
    select: { playerId: true },
    distinct: ['playerId'],
  });
  const pitacoPlayerIds = new Set(pitacoPlayers.map(s => s.playerId));
  
  console.log('\n=== PITACO-ONLY PLAYERS (in DB with pitaco snaps, no other source) ===');
  for (const pl of players) {
    if (pitacoPlayerIds.has(pl.id)) {
      const houses = [...new Set(pl.snapshots.map(s => s.house))];
      if (houses.length === 1 && houses[0] === 'pitaco') {
        console.log(`  "${pl.displayName}" team="${pl.team}" name="${pl.name}"`);
      }
    }
  }

  await p.$disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
