// Testa se a correção de preencher 0 funciona para desarmes
// npx tsx scripts/test-fix.mjs

import { getPlayerHistory } from '../src/lib/playerStats365';

async function main() {
  console.log('═══ TESTE: getPlayerHistory(desarmes) — Erick Pulga ═══\n');

  var h = await getPlayerHistory(
    'Erick Pulga', 'Bahia', 'desarmes',
    true, undefined, ['brasileirao']
  );

  if (!h) {
    console.log('❌ Nenhum histórico');
    return;
  }

  console.log('📊 Média: ' + h.average.toFixed(2) + ' desarmes/jogo');
  console.log('📈 ' + h.entries.length + ' jogos de ' + 5 + ' esperados\n');

  console.log('┌────────────┬──────────────────────────┬──────────┬────────┐');
  console.log('│ Data       │ Adversário               │ Desarmes │ Min    │');
  console.log('├────────────┼──────────────────────────┼──────────┼────────┤');

  for (var ei = 0; ei < h.entries.length; ei++) {
    var e = h.entries[ei];
    var date = e.date ? e.date.slice(0, 10) : '??/??/????';
    var opp = e.opponent;
    while (opp.length < 24) opp += ' ';
    opp = opp.slice(0, 24);
    var val = String(e.value);
    while (val.length < 6) val = ' ' + val;
    var min = e.minutes != null ? String(e.minutes) : 'N/A';
    while (min.length < 4) min = ' ' + min;
    console.log('│ ' + date + ' │ ' + opp + ' │ ' + val + '     │ ' + min + '   │');
  }

  console.log('└────────────┴──────────────────────────┴──────────┴────────┘');

  var corretos = 0;
  // Valores que o usuário informou: SP=0, CRU=2, GRE=5, COR=0, BOT=0
  // (totais podem ser diferentes do parseStatTotal para Grêmio)
  console.log('\n✅ Valores esperados (usuário): SP=0, CRU=2, GRE=5, COR=0, BOT=0');
  console.log('   Nota: 365scores retornou 3/4 (denominador=4) para Grêmio');
  console.log('   vs Grêmio mostra: ' + (h.entries.find(function(e2) { return e2.opponent.includes('Grêmio') || e2.opponent.includes('Gremio'); })?.value ?? 'N/A'));
}

main().catch(console.error);
