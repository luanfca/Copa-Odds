// Teste final: SofaScore resolve Grêmio x Bahia?
// npx tsx scripts/test-final.mjs

import { getSofascorePlayerGameStats } from '../src/lib/sofascoreStats';

async function main() {
  console.log('═══ TESTE FINAL: SofaScore resolve Brasileirão? ═══\n');

  var tests = [
    { home: 'Grêmio',    away: 'Bahia',      date: '2026-05-17T20:00:00.000Z', label: 'Grêmio x Bahia (17/05)' },
    { home: 'São Paulo', away: 'Bahia',      date: '2026-05-03T20:00:00.000Z', label: 'São Paulo x Bahia (03/05)' },
  ];

  for (var ti = 0; ti < tests.length; ti++) {
    var t = tests[ti];
    console.log(t.label);

    try {
      var players = await getSofascorePlayerGameStats(t.home, t.away, t.date);
      console.log('  Jogadores retornados: ' + players.length);

      if (players.length > 0) {
        for (var pi = 0; pi < players.length; pi++) {
          var p = players[pi];
          if (p.name.toLowerCase().indexOf('pulga') >= 0) {
            console.log('  ✅ ' + p.name + ': tackles=' + p.tackles + ' min=' + p.minutes);
          }
        }
        // Primeiros 3 nomes
        console.log('  Amostra: ' + players.slice(0,3).map(function(p) { return p.name; }).join(', '));
      } else {
        console.log('  ❌ Nenhum jogador - eventId não resolvido');
      }
    } catch (err) {
      var msg = err && typeof err === 'object' && err.message ? err.message : String(err);
      console.log('  💥 ERRO: ' + msg);
    }
  }
}

main().catch(console.error);
