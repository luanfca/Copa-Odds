/**
 * Merge matches duplicados com times invertidos.
 *
 * Ex: "Palmeiras vs Coritiba" (Pitaco) e "Coritiba vs Palmeiras" (BetMGM)
 * são o mesmo jogo mas com home/away invertidos.
 *
 * Este script:
 * 1. Encontra pares de matches com os mesmos times (invertidos) + competição
 * 2. Move os jogadores do match invertido para o canônico
 * 3. Merge snapshots quando o mesmo jogador existe em ambos
 * 4. Deleta o match duplicado
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  // Encontra todos os matches
  const allMatches = await p.match.findMany({ orderBy: { dateTime: 'desc' } });
  console.log(`Total matches: ${allMatches.length}`);

  // Agrupa por (times normalizados, competição)
  const grouped = new Map<string, typeof allMatches>();
  for (const m of allMatches) {
    // Normaliza para comparação: ordena times alfabeticamente
    const teams = [m.homeTeam, m.awayTeam].sort();
    const key = `${teams[0]}||${teams[1]}||${m.competition}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  let merged = 0;
  for (const [key, matches] of grouped) {
    if (matches.length <= 1) continue;

    console.log(`\n=== Duplicata: ${key} ===`);
    for (const m of matches) {
      const pc = await p.player.count({ where: { matchId: m.id } });
      const sc = await p.oddSnapshot.count({ where: { player: { matchId: m.id } } });
      console.log(`  ${m.homeTeam} vs ${m.awayTeam} (${m.dateTime.toISOString().slice(0,10)}): ${pc} players, ${sc} snaps`);
    }

    // Escolhe o match canônico: o que tem mais players
    const withCounts = await Promise.all(
      matches.map(async (m) => ({
        match: m,
        players: await p.player.count({ where: { matchId: m.id } }),
        snaps: await p.oddSnapshot.count({ where: { player: { matchId: m.id } } }),
      }))
    );
    withCounts.sort((a, b) => b.players - a.players);
    const canonical = withCounts[0];
    const duplicates = withCounts.slice(1);

    console.log(`  → Canônico: ${canonical.match.homeTeam} vs ${canonical.match.awayTeam} (${canonical.players} players)`);

    for (const dup of duplicates) {
      console.log(`  → Movendo ${dup.players} players de "${dup.match.homeTeam} vs ${dup.match.awayTeam}"...`);

      // Move cada jogador para o match canônico
      const playersToMove = await p.player.findMany({ where: { matchId: dup.match.id } });
      for (const player of playersToMove) {
        // Verifica se já existe jogador com mesmo nome no match canônico
        const existing = await p.player.findFirst({
          where: { matchId: canonical.match.id, name: player.name }
        });

        if (existing) {
          // Já existe — move os snapshots para o jogador existente
          console.log(`    → Merge snapshots de "${player.displayName}" → "${existing.displayName}"`);
          await p.oddSnapshot.updateMany({
            where: { playerId: player.id },
            data: { playerId: existing.id },
          });
          // Deleta o jogador duplicado
          await p.player.delete({ where: { id: player.id } });
        } else {
          // Move o jogador para o match canônico
          await p.player.update({
            where: { id: player.id },
            data: { matchId: canonical.match.id },
          });
        }
      }

      // Deleta o match duplicado
      await p.match.delete({ where: { id: dup.match.id } });
      console.log(`    → Match deletado`);
      merged++;
    }
  }

  console.log(`\n✅ ${merged} matches duplicados mesclados.`);
  await p.$disconnect();
}

main().catch((e) => {
  console.error('ERRO:', e);
  process.exit(1);
});
