/**
 * Atualiza as flags de todos os matches no banco e limpa entradas inválidas.
 * Executar: npx tsx scripts/update-flags.ts
 */
import { prisma } from '../src/lib/prisma';
import { getFlag } from '../src/lib/flagMap';

async function main() {
  console.log('Atualizando flags...');
  const matches = await prisma.match.findMany();
  let updated = 0;

  for (const m of matches) {
    const hf = getFlag(m.homeTeam);
    const af = getFlag(m.awayTeam);
    if (hf !== m.homeFlag || af !== m.awayFlag) {
      await prisma.match.update({
        where: { id: m.id },
        data: { homeFlag: hf || null, awayFlag: af || null },
      });
      updated++;
    }
  }
  console.log(`✅ ${updated} matches atualizados`);

  // Limpa entradas inválidas
  const invalidNames = [
    'Copa Do Mundo 2026', 'Mercados De Vencedor Final',
    'Jogador - Apostas Especiais', 'Baton Rouge',
    'Fc Elva', 'Fc Flora Tallinn Ii',
    'Figueirense Sub-20', 'Joinville Sub-20',
    'Little Rock Rangers',
  ];

  let cleaned = 0;
  for (const name of invalidNames) {
    const result = await prisma.match.deleteMany({
      where: {
        OR: [{ homeTeam: name }, { awayTeam: name }],
      },
    });
    cleaned += result.count;
  }
  console.log(`🧹 ${cleaned} entradas inválidas removidas`);

  // Verifica times ainda sem flag
  const all = await prisma.match.findMany();
  const noFlag = new Set<string>();
  for (const m of all) {
    if (!m.homeFlag) noFlag.add(m.homeTeam);
    if (!m.awayFlag) noFlag.add(m.awayTeam);
  }
  console.log(`📊 Times sem flag: ${noFlag.size}`);
  for (const t of noFlag) console.log(`   - ${t}`);

  console.log(`📊 Total de matches: ${all.length}`);
  await prisma.$disconnect();
}

main().catch(console.error);
