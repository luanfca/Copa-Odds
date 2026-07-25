// Testa se o SofaScore agora resolve Grêmio x Bahia
// npx tsx scripts/test-gremio.mjs

import { getSofascorePlayerGameStats } from '../src/lib/sofascoreStats';

async function main() {
  console.log('═══ TESTE: Grêmio x Bahia via SofaScore (novo código) ═══\n');

  var result = await getSofascorePlayerGameStats('Grêmio', 'Bahia', '2026-05-17T20:00:00.000Z');
  
  console.log('Jogadores retornados:', result.length);

  if (result.length > 0) {
    // Find Erick Pulga / Erick
    for (var i = 0; i < result.length; i++) {
      var p = result[i];
      if (p.name.toLowerCase().indexOf('pulga') >= 0 || 
          p.name.toLowerCase().indexOf('erick') >= 0 ||
          (p.name.toLowerCase().indexOf('er') >= 0 && p.team.indexOf('Bahia') >= 0)) {
        console.log('\n✅ Jogador encontrado:');
        console.log('   Nome: ' + p.name);
        console.log('   Time: ' + p.team);
        console.log('   Desarmes: ' + p.tackles);
        console.log('   Minutos: ' + p.minutes);
      }
    }
    
    // Show ALL Bahia players for reference
    console.log('\n📋 Jogadores do Bahia:');
    for (var i = 0; i < result.length; i++) {
      if (result[i].team.indexOf('Bahia') >= 0) {
        console.log('   ' + result[i].name + ' — tackles=' + result[i].tackles + ' min=' + result[i].minutes);
      }
    }
  } else {
    console.log('❌ Nenhum jogador retornado - eventId não resolvido');
  }

  console.log('\n✅ Teste concluído');
}

main().catch(console.error);
