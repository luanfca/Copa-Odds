import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

const recent = new Date(Date.now() - 7200000);
const players = await prisma.player.findMany({
  where: { displayName: { contains: 'Matheus Pereira' } },
  include: {
    match: true,
    snapshots: {
      where: { house: 'betfair', collectedAt: { gte: recent } },
      orderBy: [{ market: 'asc' }, { line: 'asc' }, { collectedAt: 'desc' }],
    },
  },
});

for (const p of players) {
  console.log('');
  console.log('===', p.displayName, '(' + p.team + ') ->', p.match.homeTeam, 'vs', p.match.awayTeam, '===');
  const byMarket = {};
  for (const s of p.snapshots) {
    if (!byMarket[s.market]) byMarket[s.market] = [];
    byMarket[s.market].push(s);
  }
  for (const market of Object.keys(byMarket)) {
    const vals = byMarket[market].map(s => s.line + '=' + s.value).join(', ');
    console.log('  ' + market + ': ' + vals);
  }
}
console.log('');
console.log('--- Esperado (Betfair linha 2+) ---');
console.log('  finalizacao 2+ = 1.53');
console.log('  faltas_cometidas 2+ = 1.22');
console.log('  faltas_sofridas 2+ = 1.05');
console.log('  chutes_ao_gol 2+ = 4.20');

await prisma.$disconnect();
