// Mostra TODOS os mercados do Erick Pulga nos últimos 5 jogos
// npx tsx scripts/pulga-completo.mjs

import { getPlayerHistory } from '../src/lib/playerStats365';

async function main() {
  const markets = [
    { key: 'desarmes',        label: '🛡️ Desarmes' },
    { key: 'finalizacao',     label: '⚽ Finalização (chutes)' },
    { key: 'chutes_ao_gol',   label: '🎯 Chutes ao Gol' },
    { key: 'faltas_cometidas',label: '🟨 Faltas Cometidas' },
    { key: 'faltas_sofridas', label: '🟩 Faltas Sofridas' },
  ];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Erick Pulga — Últimos 5 jogos (Brasileirão)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Cabeçalho da tabela
  console.log('┌────────────┬──────────────────────────┬' + markets.map(function() { return '──────────┬'; }).join('').slice(0, -1));
  var header = '│ Data       │ Adversário               │';
  for (var mi = 0; mi < markets.length; mi++) {
    var label = markets[mi].label.split(' ').slice(1).join(' ');
    while (label.length < 8) label += ' ';
    label = label.slice(0, 8);
    header += ' ' + label + ' │';
  }
  console.log(header);
  console.log('├────────────┼──────────────────────────┼' + markets.map(function() { return '──────────┼'; }).join('').slice(0, -1));

  // Busca histórico de cada mercado
  var histories = {};
  var allDates = {};
  
  for (var mi = 0; mi < markets.length; mi++) {
    var m = markets[mi];
    var h = await getPlayerHistory('Erick Pulga', 'Bahia', m.key, true, undefined, ['brasileirao']);
    histories[m.key] = h;
    
    if (h) {
      for (var ei = 0; ei < h.entries.length; ei++) {
        var e = h.entries[ei];
        var dateKey = e.date ? e.date.slice(0, 10) : '?';
        if (!allDates[dateKey]) allDates[dateKey] = { opponent: e.opponent, vals: {} };
        allDates[dateKey].vals[m.key] = e.value;
      }
    }
  }

  // Ordena por data
  var sortedDates = Object.keys(allDates).sort();
  
  for (var di = 0; di < sortedDates.length; di++) {
    var d = sortedDates[di];
    var info = allDates[d];
    var date = d;
    var opp = info.opponent;
    while (opp.length < 24) opp += ' ';
    opp = opp.slice(0, 24);
    
    var row = '│ ' + date + ' │ ' + opp + ' │';
    
    for (var mi = 0; mi < markets.length; mi++) {
      var val = info.vals[markets[mi].key];
      var valStr = val !== undefined ? String(val) : '-';
      while (valStr.length < 8) valStr = ' ' + valStr;
      row += valStr + ' │';
    }
    
    console.log(row);
  }

  console.log('├────────────┴──────────────────────────┴' + markets.map(function() { return '──────────┴'; }).join('').slice(0, -1));

  // Linha de médias
  var avgRow = '│ Média      ';
  for (var mi = 0; mi < markets.length; mi++) {
    var h = histories[markets[mi].key];
    var avg = h ? h.average.toFixed(2) : '-';
    while (avg.length < 8) avg = ' ' + avg;
    avgRow += ' │ ' + avg;
  }
  avgRow += ' │';
  console.log(avgRow);
  
  // Linha de total
  var totRow = '│ Total      ';
  for (var mi = 0; mi < markets.length; mi++) {
    var h = histories[markets[mi].key];
    var tot = h ? String(h.total) : '-';
    while (tot.length < 8) tot = ' ' + tot;
    totRow += ' │ ' + tot;
  }
  totRow += ' │';
  console.log(totRow);

  console.log('└──────────────────────────────────────────┘' + markets.map(function() { return '──────────┘'; }).join(''));
  console.log('\n✅ Fonte principal: SofaScore → fallback: 365scores → FotMob');
}

main().catch(console.error);
