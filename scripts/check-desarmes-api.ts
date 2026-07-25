import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const timeThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);
  console.log('Time threshold (48h ago):', timeThreshold.toISOString());

  // Count players with desarmes snaps in the window
  const players = await p.player.findMany({
    where: {
      snapshots: {
        some: {
          market: 'desarmes',
          collectedAt: { gte: timeThreshold }
        }
      }
    },
    include: {
      match: true,
      snapshots: {
        where: { market: 'desarmes', collectedAt: { gte: timeThreshold } },
        orderBy: { collectedAt: 'desc' },
        take: 1
      }
    }
  });

  console.log('Total players with desarmes in window:', players.length);
  
  // Group by match
  const byMatch = new Map<string, { players: number, houses: Set<string> }>();
  for (const pl of players) {
    const key = pl.match.homeTeam + ' vs ' + pl.match.awayTeam;
    if (!byMatch.has(key)) byMatch.set(key, { players: 0, houses: new Set() });
    const entry = byMatch.get(key)!;
    entry.players++;
    for (const s of pl.snapshots) entry.houses.add(s.house);
  }

  for (const [match, info] of byMatch) {
    console.log(`  ${match}: ${info.players} players, houses: ${[...info.houses].join(', ')}`);
  }

  // Specifically check Coritiba vs Palmeiras
  const cpMatch = await p.match.findFirst({
    where: { homeTeam: { contains: 'Coritiba' }, awayTeam: { contains: 'Palmeiras' } },
    orderBy: { dateTime: 'desc' }
  });
  if (cpMatch) {
    const cpPlayersWithDesarmes = await p.player.count({
      where: {
        matchId: cpMatch.id,
        snapshots: {
          some: { market: 'desarmes', collectedAt: { gte: timeThreshold } }
        }
      }
    });
    console.log(`\nCoritiba vs Palmeiras players with desarmes in window: ${cpPlayersWithDesarmes}`);
    
    // Check what houses have desarmes for this match in window
    const desarmesByHouse = await p.oddSnapshot.groupBy({
      by: ['house'],
      where: {
        market: 'desarmes',
        collectedAt: { gte: timeThreshold },
        player: { matchId: cpMatch.id }
      },
      _count: true
    });
    console.log('Desarmes by house in window:');
    for (const h of desarmesByHouse) console.log(`  ${h.house}: ${h._count}`);
  }

  await p.$disconnect();
}
main().catch(console.error);
