import { prisma } from '../src/lib/prisma';

async function main() {
  const snaps = await prisma.oddSnapshot.findMany({
    where: {
      player: {
        displayName: { contains: 'Pulga' }
      },
      market: { in: ['finalizacao', 'chutes_ao_gol'] }
    },
    take: 40,
    orderBy: { collectedAt: 'desc' },
    include: {
      player: {
        select: {
          displayName: true,
          team: true,
          match: { select: { homeTeam: true, awayTeam: true, competition: true } }
        }
      }
    }
  });

  console.log('=== ERICK PULGA - FINALIZAÇÃO (Chutes) ===\n');

  if (snaps.length === 0) {
    console.log('❌ NENHUM dado de finalização encontrado!');

    // Check all markets for Pulga
    const all = await prisma.oddSnapshot.findMany({
      where: { player: { displayName: { contains: 'Pulga' } } },
      distinct: ['market'],
      select: { market: true }
    });
    console.log('\nMercados disponíveis para Erick Pulga:');
    for (const m of all) console.log('  - ' + m.market);

    // Check if the BetMGM fix worked
    const betmgmAll = await prisma.oddSnapshot.findMany({
      where: {
        player: { displayName: { contains: 'Pulga' } },
        house: 'betmgm'
      },
      distinct: ['market'],
      select: { market: true }
    });
    console.log('\nBetMGM markets for Pulga:');
    for (const m of betmgmAll) console.log('  - ' + m.market);

    return;
  }

  // Group by house + market
  const groups = new Map<string, typeof snaps>();
  for (const s of snaps) {
    const key = `${s.house}::${s.market}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  for (const [key, entries] of groups) {
    const [house, market] = key.split('::');
    const label = house === 'betfair' ? 'Betfair' :
                  house === 'betmgm' ? 'BetMGM' :
                  house === 'superbet' ? 'Superbet' :
                  house === 'pitaco' ? 'Pitaco' : house;
    const marketLabel = market === 'finalizacao' ? 'Finalização (Chutes)' : 'Chutes no Gol';
    console.log(`\n${label} — ${marketLabel}`);
    console.log('-'.repeat(40));
    const sorted = entries.sort((a, b) => {
      const aNum = parseFloat(a.line.replace('+', ''));
      const bNum = parseFloat(b.line.replace('+', ''));
      return aNum - bNum;
    });
    for (const s of sorted) {
      console.log(`  ${s.line} = ${s.value.toFixed(2)}`);
    }
  }

  const match = snaps[0].player.match;
  console.log(`\n📋 Jogo: ${match.homeTeam} vs ${match.awayTeam} (${match.competition})`);
  console.log(`👤 Jogador: ${snaps[0].player.displayName} (${snaps[0].player.team})`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
