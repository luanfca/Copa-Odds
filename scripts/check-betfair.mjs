import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // Busca jogo Botafogo x Santos
  const match = await p.match.findFirst({
    where: {
      AND: [
        { OR: [{ homeTeam: { contains: 'Botafogo' } }, { awayTeam: { contains: 'Botafogo' } }] },
        { OR: [{ homeTeam: { contains: 'Santos' } }, { awayTeam: { contains: 'Santos' } }] },
      ],
    },
  });

  if (!match) {
    console.log('Jogo Botafogo x Santos não encontrado');
    await p.$disconnect();
    return;
  }

  console.log(`=== ${match.homeTeam} vs ${match.awayTeam} ===\n`);

  // Busca Gabriel pela lista de jogadores
  const players = await p.player.findMany({
    where: { matchId: match.id, displayName: { contains: 'Gabriel' } },
  });

  console.log(`Jogadores com 'Gabriel': ${players.map(p => p.displayName).join(', ')}\n`);

  // Para cada Gabriel, busca TODAS as odds de TODOS os mercados e casas
  for (const pl of players) {
    const snapshots = await p.oddSnapshot.findMany({
      where: { playerId: pl.id },
      orderBy: [{ market: 'asc' }, { house: 'asc' }, { line: 'asc' }],
    });

    if (snapshots.length === 0) {
      console.log(`${pl.displayName} (${pl.team}): SEM odds`);
      continue;
    }

    // Última por casa + mercado + linha
    const latest = new Map();
    for (const snap of snapshots) {
      const key = `${snap.house}_${snap.market}_${snap.line}`;
      if (!latest.has(key)) latest.set(key, snap);
    }

    console.log(`${pl.displayName} (${pl.team}):`);
    for (const [, snap] of latest) {
      console.log(`  ${snap.house.padEnd(10)} ${snap.market.padEnd(20)} ${snap.line.padEnd(6)} ${snap.value}`);
    }
    console.log('');
  }

  // Totais por casa no jogo
  const totals = await p.oddSnapshot.groupBy({
    by: ['house'],
    where: { player: { matchId: match.id } },
    _count: true,
  });
  console.log('Odds por casa neste jogo:');
  for (const t of totals) {
    console.log(`  ${t.house.padEnd(10)} ${t._count} odds`);
  }

  await p.$disconnect();
}

main().catch(console.error);
