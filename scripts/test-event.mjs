// Testa o eventId 15235573 (Grêmio x Bahia) no SofaScore
// npx tsx scripts/test-event.mjs

import { getSofascorePlayerGameStats } from '../src/lib/sofascoreStats';
import { getPlayerHistory } from '../src/lib/playerStats365';

async function main() {
  console.log('═══ TESTE: Grêmio x Bahia (eventId=15235573) ═══\n');

  // 1. Testa player stats direto
  console.log('📡 Buscando player_stats...');
  var players = await getSofascorePlayerGameStats('Grêmio', 'Bahia', '2026-05-17T20:00:00.000Z');
  console.log('Jogadores retornados: ' + players.length);
  
  if (players.length > 0) {
    // Mostra jogadores do Bahia
    console.log('\n📋 Jogadores do Bahia:');
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.team.indexOf('Bahia') >= 0) {
        console.log('   ' + p.name + ' — tackles=' + p.tackles + ' min=' + p.minutes);
      }
    }
    
    // Procura Erick Pulga
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.name.toLowerCase().indexOf('pulga') >= 0) {
        console.log('\n✅ ERICK PULGA ENCONTRADO:');
        console.log('   Desarmes: ' + p.tackles);
        console.log('   Minutos: ' + p.minutes);
        console.log('   Faltas Cometidas: ' + p.foulsCommitted);
        console.log('   Faltas Sofridas: ' + p.foulsSuffered);
        console.log('   Finalizações: ' + p.shots);
        console.log('   Chutes ao Gol: ' + p.shotsOnTarget);
      }
    }
  } else {
    console.log('❌ Nenhum jogador retornado');
  }

  // 2. Testa getPlayerHistory completo para desarmes
  console.log('\n═══════════ getPlayerHistory(desarmes) ═══════════');
  var h = await getPlayerHistory('Erick Pulga', 'Bahia', 'desarmes', true, undefined, ['brasileirao']);
  if (h) {
    console.log('Média: ' + h.average.toFixed(2) + ' em ' + h.entries.length + ' jogos');
    for (var ei = 0; ei < h.entries.length; ei++) {
      var e = h.entries[ei];
      console.log('   ' + (e.date ? e.date.slice(0,10) : '?') + ' vs ' + e.opponent + ': ' + e.value + ' desarmes');
    }
  } else {
    console.log('❌ Nenhum histórico');
  }
}

main().catch(console.error);
