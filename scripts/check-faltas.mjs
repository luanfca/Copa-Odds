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
    console.log('Nenhum jogo do Botafogo encontrado.');
    await p.$disconnect();
    return;
  }

  for (const match of matches) {
    console.log(`\n=== ${match.homeTeam} vs ${match.awayTeam} - ${match.dateTime} ===`);

    // Busca Gabriel Menino
    const players = await p.player.findMany({
      where: {
        matchId: match.id,
        displayName: { contains: 'Gabriel' },
      },
      include: {
        snapshots: {
          where: { market: 'faltas_sofridas' },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    if (players.length === 0) {
      console.log('  Nenhum Gabriel encontrado neste jogo.');
      continue;
    }

    for (const pl of players) {
      console.log(`\n  Jogador: ${pl.displayName} (${pl.team})`);

      if (pl.snapshots.length === 0) {
        console.log('    Sem odds de faltas sofridas.');
        continue;
      }

      // Última odd por casa + linha
      const byKey = new Map();
      for (const snap of pl.snapshots) {
        const key = `${snap.house}:${snap.line}`;
        if (!byKey.has(key)) byKey.set(key, snap);
      }

      for (const [, snap] of byKey) {
        console.log(`    ${snap.house.padEnd(10)} ${snap.line.padEnd(6)} Odd: ${snap.value}`);
      }
    }
  }

  await p.$disconnect();
}

main().catch(console.error);
