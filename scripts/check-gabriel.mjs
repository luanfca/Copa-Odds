import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Busca jogos com Botafogo
  const matches = await p.match.findMany({
    where: {
      OR: [
        { homeTeam: { contains: 'Botafogo' } },
        { awayTeam: { contains: 'Botafogo' } },
      ],
    },
    orderBy: { dateTime: 'desc' },
  });

  if (matches.length === 0) {
    console.log('Nenhum jogo do Botafogo encontrado no banco.');
    await p.$disconnect();
    return;
  }

  for (const match of matches) {
    console.log(`\n=== ${match.homeTeam} vs ${match.awayTeam} - ${match.dateTime} (${match.competition}) ===`);

    // Busca jogadores com "Gabriel" no nome
    const players = await p.player.findMany({
      where: {
        matchId: match.id,
        displayName: { contains: 'Gabriel' },
      },
      include: {
        snapshots: {
          where: { market: 'desarmes' },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    if (players.length === 0) {
      console.log('  Nenhum jogador com "Gabriel" encontrado.');
      // Busca todos os jogadores do jogo para ver nomes disponíveis
      const allPlayers = await p.player.findMany({
        where: { matchId: match.id },
        take: 5,
      });
      console.log('  Amostra de jogadores:', allPlayers.map(p => p.displayName).join(', '));
      continue;
    }

    for (const pl of players) {
      console.log(`\n  Jogador: ${pl.displayName} (${pl.team})`);

      if (pl.snapshots.length === 0) {
        console.log('    Sem odds de desarmes.');
        continue;
      }

      // Agrupa por casa + linha
      const byHouse = {};
      for (const snap of pl.snapshots) {
        const key = `${snap.house}:${snap.line}`;
        if (!byHouse[key]) byHouse[key] = snap;
      }

      for (const [key, snap] of Object.entries(byHouse)) {
        const [house, line] = key.split(':');
        console.log(`    ${house.padEnd(10)} ${line.padEnd(6)} Odd: ${snap.value}`);
      }
    }
  }

  await p.$disconnect();
}

main().catch(console.error);
