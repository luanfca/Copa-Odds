// Test: verifica histórico via SofaScore como fonte primária
// npx tsx scripts/test-history-br.mjs

import { getPlayerHistory, getFinishedGamesAllComps } from '../src/lib/playerStats365';

async function main() {
  console.log('🔍 Testando getPlayerHistory com SofaScore como fonte primária\n');

  // 1. Testa se consegue buscar jogos finalizados do Brasileirão
  console.log('📅 Buscando jogos finalizados do Brasileirão...');
  const brGames = await getFinishedGamesAllComps(['brasileirao']);
  console.log(`   Encontrados ${brGames.length} jogos`);
  if (brGames.length > 0) {
    const last5 = brGames.slice(-5);
    for (const g of last5) {
      console.log(`   ${g.homeName} x ${g.awayName} - ${g.start?.slice(0, 10)}`);
    }
  }

  // 2. Testa histórico do Erick Pulga (finalização via SofaScore primeiro)
  console.log('\n👤 Histórico de Erick Pulga (finalizacao) via SofaScore...');
  const h1 = await getPlayerHistory(
    'Erick Pulga',    // playerName
    'Bahia',          // team
    'finalizacao',    // market
    true,             // allComps
    'Chapecoense',    // opponentTeam (fallback)
    ['brasileirao'],  // competitionKeys
  );

  if (h1) {
    console.log(`   📊 Média: ${h1.average.toFixed(2)} em ${h1.entries.length} jogos`);
    console.log(`   Total: ${h1.total}`);
    for (const e of h1.entries) {
      console.log(`   ${e.date?.slice(0, 10)} vs ${e.opponent}: ${e.value} finalizações (${e.minutes} min)`);
    }
  } else {
    console.log('   ❌ Nenhum histórico encontrado para Erick Pulga');
  }

  // 3. Testa com fallback para 365scores (se SofaScore não tiver o jogador)
  console.log('\n👤 Histórico de Erick Pulga (desarmes) - testando fallbacks...');
  const h2 = await getPlayerHistory(
    'Erick Pulga',
    'Bahia',
    'desarmes',
    true,
    'Chapecoense',
    ['brasileirao'],
  );

  if (h2) {
    console.log(`   📊 Média: ${h2.average.toFixed(2)} em ${h2.entries.length} jogos`);
    console.log(`   Total: ${h2.total}`);
    for (const e of h2.entries) {
      console.log(`   ${e.date?.slice(0, 10)} vs ${e.opponent}: ${e.value} desarmes (${e.minutes} min)`);
    }
  } else {
    console.log('   ❌ Nenhum histórico de desarmes encontrado');
  }

  console.log('\n✅ Teste concluído');
}

main().catch(console.error);
