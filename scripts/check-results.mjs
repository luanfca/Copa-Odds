import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Check Pitaco and BetMGM finalizacao
  const [ptF, mgmF, sbF, bfF] = await Promise.all([
    p.oddSnapshot.count({ where: { house: 'pitaco', market: 'finalizacao' } }),
    p.oddSnapshot.count({ where: { house: 'betmgm', market: 'finalizacao' } }),
    p.oddSnapshot.count({ where: { house: 'superbet', market: 'finalizacao' } }),
    p.oddSnapshot.count({ where: { house: 'betfair', market: 'finalizacao' } })
  ]);
  console.log('=== FINALIZACAO SNAPS ALL-TIME ===');
  console.log('Pitaco:  ', ptF);
  console.log('BetMGM:  ', mgmF);
  console.log('Superbet:', sbF);
  console.log('Betfair: ', bfF);

  // Erick Pulga
  const pulga = await p.player.findFirst({
    where: { displayName: { contains: 'Pulga' } },
    select: { id: true, displayName: true, team: true }
  });
  if (pulga) {
    console.log('\n=== ERICK PULGA (' + pulga.team + ') ===');
    
    const snaps = await p.oddSnapshot.findMany({
      where: { playerId: pulga.id },
      orderBy: [{ collectedAt: 'desc' }],
      take: 60
    });
    
    if (snaps.length === 0) {
      console.log('NO DATA FOUND');
    } else {
      // Group by house + market, show most recent
      const groups = new Map();
      for (const s of snaps) {
        const k = s.house + '::' + s.market + '::' + s.line;
        if (!groups.has(k)) groups.set(k, s);
      }
      
      let lastHouse = '';
      for (const [key, s] of [...groups.entries()].sort()) {
        const h = s.house;
        if (h !== lastHouse) {
          console.log('\n' + h.toUpperCase());
          lastHouse = h;
        }
        console.log('  ' + s.market + ' | ' + s.line + ' = ' + s.value.toFixed(2) + ' (collected ' + s.collectedAt.toISOString().slice(11,19) + ')');
      }
    }
  } else {
    console.log('\nErick Pulga not found in database');
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
