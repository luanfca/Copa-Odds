// Mostra os desarmes do Erick Pulga nos últimos 5 jogos do Brasileirão
// npx tsx scripts/pulga-desarmes.mjs

import { getPlayerHistory } from '../src/lib/playerStats365';

async function main() {
  console.log('══════════════════════════════════════════════');
  console.log('  Erick Pulga — Desarmes');
  console.log('  Últimos 5 jogos do Brasileirão via SofaScore');
  console.log('══════════════════════════════════════════════\n');

  const h = await getPlayerHistory(
    'Erick Pulga',
    'Bahia',
    'desarmes',
    true,
    undefined,
    ['brasileirao'],
  );

  if (!h) {
    console.log('❌ Nenhum histórico de desarmes encontrado');
    return;
  }

  console.log(`📊 Média: ${h.average.toFixed(2)} desarmes/jogo`);
  console.log(`📈 Total: ${h.total} desarmes em ${h.entries.length} jogos\n`);

  console.log('┌────────────┬──────────────────────────┬──────────┬────────┐');
  console.log('│ Data       │ Adversário               │ Desarmes │ Min    │');
  console.log('├────────────┼──────────────────────────┼──────────┼────────┤');

  for (const e of h.entries) {
    const date = e.date ? e.date.slice(0, 10) : '??/??/????';
    const opp = e.opponent.padEnd(24).slice(0, 24);
    const val = String(e.value).padStart(6);
    const min = e.minutes != null ? String(e.minutes).padStart(4) : '  N/A';
    console.log(`│ ${date} │ ${opp} │ ${val}     │ ${min}   │`);
  }

  console.log('└────────────┴──────────────────────────┴──────────┴────────┘');

  const avgStr = h.average.toFixed(2);
  console.log(`\n✅ Média de ${avgStr} desarmes/jogo — fonte: SofaScore (primária)`);
}

main().catch(console.error);
