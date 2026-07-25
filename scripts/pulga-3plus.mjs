import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Find Erick Pulga
  const player = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } }
  });
  if (!player) { console.log('NOT FOUND'); return; }
  
  console.log('ERICK PULGA (' + player.team + ')');
  
  // Get ALL finalizacao odds
  const snaps = await p.oddSnapshot.findMany({
    where: { playerId: player.id, market: 'finalizacao' },
    orderBy: [{ collectedAt: 'desc' }],
    take: 100
  });
  
  // Show unique values per house+line
  const seen = new Set();
  let lastHouse = '';
  for (const s of snaps) {
    const key = s.house + '::' + s.line;
    if (seen.has(key)) continue;
    seen.add(key);
    if (s.house !== lastHouse) {
      console.log('\n' + s.house.toUpperCase());
      lastHouse = s.house;
    }
    console.log('  ' + s.line.padEnd(4) + ' = ' + s.value.toFixed(3) + ' | ' + s.collectedAt.toISOString().slice(11,19));
  }
  
  if (snaps.length === 0) {
    console.log('NO FINALIZACAO DATA IN DB');
  }
  
  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
