import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const names = ['%Matheus Pereira%', '%Kaio Jorge%', '%Gerson%', '%Alan Patrick%'];

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
        where: { house: 'betfair', line: '2+' },
        orderBy: [{ market: 'asc' }, { collectedAt: 'desc' }],
      },
    },
  });
  
  if (players.length === 0) {
    console.log('(nenhum jogador encontrado)');
    continue;
  }
  
  for (const p of players) {
    console.log(`Time: ${p.team || '?'} | Match: ${p.match?.homeTeam} vs ${p.match?.awayTeam}`);
    
    for (const market of ['faltas_cometidas', 'faltas_sofridas', 'finalizacao', 'chutes_ao_gol']) {
      const odds = p.snapshots.filter(s => s.market === market);
      if (odds.length > 0) {
        const val = odds[0]?.value;
        console.log(`  2+ ${market}: ${val !== null && val !== undefined ? val.toFixed(2) : 'N/A'}`);
      } else {
        console.log(`  2+ ${market}: -`);
      }
    }
  }
}

await prisma.$disconnect();
