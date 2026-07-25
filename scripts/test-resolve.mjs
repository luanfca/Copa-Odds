// Testa se o servidor SofaScore resolve eventIds jogos do Brasileirão
// npx tsx scripts/test-resolve.mjs

import { resolveSofascoreEventId, getSofascorePlayerGameStats } from '../src/lib/sofascoreStats';

async function main() {
  console.log('═══ TESTE: SofaScore resolve para Brasileirão ═══\n');

  var games = [
    { home: 'Grêmio',      away: 'Bahia',      date: '2026-05-17T20:00:00.000Z', label: 'Grêmio x Bahia' },
    { home: 'São Paulo',   away: 'Bahia',      date: '2026-05-03T20:00:00.000Z', label: 'São Paulo x Bahia' },
  ];

  for (var gi = 0; gi < games.length; gi++) {
    var g = games[gi];
    console.log(g.label);

    try {
      var eventId = await resolveSofascoreEventId(g.home, g.away, g.date);
      if (eventId) {
        console.log('  ✅ eventId = ' + eventId);

        var players = await getSofascorePlayerGameStats(g.home, g.away, g.date);
        console.log('  Jogadores: ' + players.length);

        // Find Erick Pulga
        for (var pi = 0; pi < players.length; pi++) {
          var p = players[pi];
          if (p.name.toLowerCase().indexOf('pulga') >= 0 || p.name.toLowerCase().indexOf('erick') >= 0) {
            console.log('  ✅ ' + p.name + ': tackles=' + p.tackles + ' min=' + p.minutes);
          }
        }

        // Show top 3 players
        for (var pi = 0; pi < Math.min(3, players.length); pi++) {
          console.log('     ' + players[pi].name + ' (' + players[pi].team + ')');
        }
      } else {
        console.log('  ❌ eventId não encontrado');
      }
    } catch (err) {
      var msg = err && typeof err === 'object' && err.message ? err.message : String(err);
      console.log('  💥 ERRO: ' + msg);
    }
  }

  console.log('\n✅ Teste concluído');
}

main().catch(console.error);
