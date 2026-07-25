// Testa o servidor SofaScore para jogos do Brasileirão
// npx tsx scripts/test-sofa-br.mjs

import { getSofascorePlayerGameStats, resolveSofascoreEventId } from '../src/lib/sofascoreStats';

async function main() {
  console.log('═══ TESTE: SofaScore Server para Brasileirão ═══\n');

  // Jogo: Grêmio x Bahia - 2026-05-17
  var games = [
    { home: 'Grêmio',      away: 'Bahia',      date: '2026-05-17T20:00:00.000Z', label: 'Grêmio x Bahia (17/05)' },
    { home: 'São Paulo',   away: 'Bahia',      date: '2026-05-03T20:00:00.000Z', label: 'São Paulo x Bahia (03/05)' },
    { home: 'Cruzeiro',    away: 'Bahia',      date: '2026-05-09T20:00:00.000Z', label: 'Cruzeiro x Bahia (09/05)' },
  ];

  for (var gi = 0; gi < games.length; gi++) {
    var g = games[gi];
    console.log('────────────── ' + g.label + ' ──────────────');

    // Tenta resolver o eventId
    console.log('  Resolvendo eventId...');
    try {
      var eventId = await resolveSofascoreEventId(g.home, g.away, g.date);
      if (eventId) {
        console.log('  ✅ eventId = ' + eventId);
        
        // Agora busca player stats
        console.log('  Buscando player_stats...');
        var players = await getSofascorePlayerGameStats(g.home, g.away, g.date);
        console.log('  ' + players.length + ' jogadores retornados');
        
        if (players.length > 0) {
          // Procura Erick Pulga
          for (var pi = 0; pi < players.length; pi++) {
            var p = players[pi];
            if (p.name.toLowerCase().includes('pulga') || p.name.toLowerCase().includes('erick')) {
              console.log('  ✅ ' + p.name + ': min=' + p.minutes + ' tackles=' + p.tackles
                + ' foulsC=' + p.foulsCommitted + ' foulsS=' + p.foulsSuffered
                + ' shots=' + p.shots + ' shotsOT=' + p.shotsOnTarget);
            }
          }
          
          // Mostra primeiros 3 jogadores para debug
          console.log('  Primeiros jogadores:');
          for (var pi = 0; pi < Math.min(3, players.length); pi++) {
            console.log('    - ' + players[pi].name + ' (' + players[pi].team + ')');
          }
        } else {
          console.log('  ❌ Nenhum jogador retornado');
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
