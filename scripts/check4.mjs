import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const names = ['%Gerson%', '%Matheus Pereira%', '%Kaio Jorge%', '%Bernabei%'];

for (const nameLike of names) {
  const displayName = nameLike.replace(/%/g, '');
  console.log('\n========================================');
  console.log('JOGADOR:', displayName);
  console.log('========================================');
  
  const players = await prisma.player.findMany({
    where: { displayName: { contains: displayName } },
    include: {
      match: true,
      snapshots: {
        where: { house: 'betfair' },
        orderBy: [{ market: 'asc' }, { line: 'asc' }, { collectedAt: 'desc' }],
      },
    },
  });
  
  if (players.length === 0) {
    console.log('(nenhum jogador encontrado)');
    continue;
  }
  
  for (const p of players) {
    const markets = [...new Set(p.snapshots.map(s => s.market))];
    console.log(`Time: ${p.team || '?'} | Match: ${p.match?.homeTeam} vs ${p.match?.awayTeam}`);
    
    for (const market of markets) {
      const odds = p.snapshots.filter(s => s.market === market);
      const lines = [...new Set(odds.map(s => s.line))].sort();
      console.log(`  Mercado: ${market}`);
      for (const line of lines) {
        const snap = odds.filter(s => s.line === line);
        const val = snap[0]?.value;
        console.log(`    ${line}: ${val !== null && val !== undefined ? val.toFixed(2) : 'N/A'}`);
      }
    }
  }
}

await prisma.$disconnect();
