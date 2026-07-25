export {};

/**
 * Script one-shot: varre TODOS os jogadores do banco, encontra duplicatas
 * (ex: "J. Arias" + "Jhon Arias" no mesmo match) e mescla os snapshots
 * no registro "keeper", deletando os duplicados.
 *
 * Uso: npx tsx scripts/merge-duplicate-players.ts
 *
 * Seguro para reexecutar: só mescla se encontrar duplicatas.
 * NÃO deleta matches ou altera dados de snapshots — apenas move foreign keys.
 */

import { PrismaClient } from '@prisma/client';
import { slugify, isSamePlayer } from '../src/lib/normalize';

const prisma = new PrismaClient();

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Merge de Jogadores Duplicados — scan completo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 1. Busca TODOS os players com seus snapshots e match info
  const players = await prisma.player.findMany({
    include: {
      match: { select: { id: true, homeTeam: true, awayTeam: true, competition: true } },
      snapshots: { select: { id: true } },
    },
  });

  console.log(`Total de jogadores no banco: ${players.length}\n`);

  // 2. Agrupa por matchId
  const byMatch = new Map<string, typeof players>();
  for (const p of players) {
    if (!byMatch.has(p.matchId)) byMatch.set(p.matchId, []);
    byMatch.get(p.matchId)!.push(p);
  }

  let totalDuplicates = 0;
  let totalSnapshotsMoved = 0;
  let totalPlayersDeleted = 0;

  for (const [matchId, matchPlayers] of byMatch) {
    if (matchPlayers.length < 2) continue; // sem chances de duplicata

    const keepers: typeof matchPlayers = [];
    const duplicates: typeof matchPlayers = [];

    // Comparação O(n²) dentro do mesmo match
    for (const candidate of matchPlayers) {
      let matched = false;
      for (const keeper of keepers) {
        if (isSamePlayer(keeper.displayName, candidate.displayName)) {
          // Mesmo time (ou time vazio de um lado — dados antigos)
          const sameTeam = !keeper.team || !candidate.team || keeper.team === candidate.team;
          if (sameTeam) {
            duplicates.push(candidate);
            matched = true;
            break;
          }
        }
      }
      if (!matched) {
        keepers.push(candidate);
      }
    }

    if (duplicates.length === 0) continue;

    const m = matchPlayers[0].match;
    const matchLabel = `${m?.homeTeam ?? '?'} vs ${m?.awayTeam ?? '?'} (${m?.competition ?? '?'})`;

    console.log(`\n📌 Match: ${matchLabel}`);
    console.log(`   Keeper(s): ${keepers.map(k => k.displayName).join(', ')}`);

    // Rastreador de IDs já processados para evitar dupla deleção
    const processedIds = new Set<string>();

    // Para cada grupo keeper → duplicatas
    for (const keeper of keepers) {
      const myDuplicates = duplicates.filter(d => 
        isSamePlayer(keeper.displayName, d.displayName) && !processedIds.has(d.id)
      );

      for (const dup of myDuplicates) {
        // Marca como processado ANTES de qualquer operação
        processedIds.add(dup.id);

        // Pula se for o mesmo jogador (match exato de nome)
        if (slugify(keeper.displayName) === slugify(dup.displayName) && 
            (keeper.team === dup.team || !keeper.team || !dup.team)) continue;

        const snapCount = dup.snapshots.length;
        if (snapCount === 0) {
          console.log(`   🗑️  Deletando ${dup.displayName} (0 snapshots) — puramente duplicado`);
          await prisma.player.delete({ where: { id: dup.id } }).catch(() => null);
          totalPlayersDeleted++;
          continue;
        }

        console.log(`   🔀 Mesclando ${dup.displayName} (${snapCount} snaps) → ${keeper.displayName}`);

        // Move TODOS os snapshots do duplicado para o keeper
        const moved = await prisma.oddSnapshot.updateMany({
          where: { playerId: dup.id },
          data: { playerId: keeper.id },
        });
        totalSnapshotsMoved += moved.count;

        // Deleta o player duplicado
        await prisma.player.delete({ where: { id: dup.id } }).catch(() => null);
        totalPlayersDeleted++;
      }
    }
    totalDuplicates += duplicates.length;
  }

  // 3. Remove players órfãos (sem snapshots e duplicados de nome similar)
  // Já feito acima.

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  ✅ Merge completo!`);
  console.log(`  Duplicatas encontradas: ${totalDuplicates}`);
  console.log(`  Snapshots movidos:      ${totalSnapshotsMoved}`);
  console.log(`  Players deletados:      ${totalPlayersDeleted}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // 4. Relatório final: quantos players restam
  const remaining = await prisma.player.count();
  console.log(`Jogadores restantes no banco: ${remaining}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('ERRO:', err);
  process.exit(1);
});
