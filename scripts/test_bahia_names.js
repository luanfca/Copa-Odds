const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  const teams = await p.$queryRaw`SELECT DISTINCT homeTeam FROM matches`;
  console.log('Todos os homeTeam no banco:');
  for (const t of teams) {
    console.log(`  "${t.homeTeam}"`);
  }
  
  const bahia = await p.$queryRaw`SELECT DISTINCT team, displayName FROM players WHERE team LIKE '%Bahia%' OR team LIKE '%BA%' OR team LIKE '%bahia%' LIMIT 20`;
  console.log('\nJogadores Bahia no banco:');
  for (const b of bahia) {
    console.log(`  team="${b.team}" displayName="${b.displayName}"`);
  }
  
  const bahiaMatches = await p.$queryRaw`SELECT DISTINCT homeTeam, awayTeam FROM matches WHERE homeTeam LIKE '%Bahia%' OR awayTeam LIKE '%Bahia%'`;
  console.log('\nJogos do Bahia no banco:');
  for (const m of bahiaMatches) {
    console.log(`  ${m.homeTeam} x ${m.awayTeam}`);
  }
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
