import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const NAMES = ['Gerson', 'Matheus Pereira', 'Kaio Jorge', 'Bernabei'];

for (const searchName of NAMES) {
  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  ' + searchName.padEnd(45) + '║');
  console.log('╚══════════════════════════════════════════════════╝');

  const players = await prisma.player.findMany({
    where: { displayName: { contains: searchName } },
    include: {
      match: true,
      snapshots: {
        where: { house: 'betfair' },
        orderBy: [{ market: 'asc' }, { line: 'asc' }, { collectedAt: 'desc' }],
      },
    },
  });

  if (players.length === 0) {
    console.log('  NENHUM JOGADOR ENCONTRADO');
    continue;
  }

  for (const p of players) {
    console.log('');
    console.log('  ' + p.displayName + ' (' + p.team + ')');
    console.log('  ' + p.match.homeTeam + ' vs ' + p.match.awayTeam);
    console.log('  ─────────────────────────────────────────────');
    
    if (p.snapshots.length === 0) {
      console.log('  ❌ SEM ODDS BETFAIR');
      continue;
    }

    const byMarket = {};
    for (const s of p.snapshots) {
      if (!byMarket[s.market]) byMarket[s.market] = [];
      byMarket[s.market].push(s);
    }
    
    for (const market of Object.keys(byMarket)) {
      const line2 = byMarket[market].filter(s => s.line === '2+');
      if (line2.length > 0) {
        console.log('  ' + market.padEnd(20) + ' 2+ = ' + line2[0].value.toFixed(4));
      } else {
        console.log('  ' + market.padEnd(20) + ' 2+ = ---');
      }
    }
  }
}

console.log('');
console.log('════════════════════════════════════════════════════');
await prisma.$disconnect();
