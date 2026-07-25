// Teste direto da API 365scores + getPlayerHistory
// npx tsx scripts/test-now.mjs

import { getFinishedGamesAllComps, getPlayerHistory } from '../src/lib/playerStats365';
import { baseParams, webwsJson } from '../src/lib/lineups365';
import { COMPETITIONS } from '../src/lib/competitions';

async function main() {
  console.log('═══ TESTE DIRETO DE HISTÓRICO ═══\n');

  // 1. Verifica ID do Brasileirão
  const br = COMPETITIONS['brasileirao'];
  console.log('Brasileirão ID365:', br.id365);

  // 2. Testa API direta
  console.log('\n📡 Teste 1: API 365scores direta com ID', br.id365);
  const data = await webwsJson('/web/games/?' + baseParams({
    competitions: br.id365,
    startDate: '01/04/2026',
    endDate: '30/04/2026',
    showOdds: 'false',
  }));
  const games = data && data.games ? data.games : [];
  console.log('   Resposta da API:', games.length, 'jogos no total');
  if (games.length > 0) {
    const g = games[0];
    console.log('   1º jogo:', (g.homeCompetitor && g.homeCompetitor.name) + ' x ' + (g.awayCompetitor && g.awayCompetitor.name));
  }

  // 3. Testa getFinishedGamesAllComps
  console.log('\n📡 Teste 2: getFinishedGamesAllComps([brasileirao])');
  const brGames = await getFinishedGamesAllComps(['brasileirao']);
  console.log('   Jogos encontrados:', brGames.length);
  if (brGames.length > 0) {
    console.log('   Primeiro:', brGames[0].homeName, 'x', brGames[0].awayName);
    console.log('   Último:', brGames[brGames.length - 1].homeName, 'x', brGames[brGames.length - 1].awayName);
  }

  // 4. Tenta histórico do Erick Pulga
  console.log('\n👤 Teste 3: Histórico do Erick Pulga (finalizacao)');
  const h = await getPlayerHistory(
    'Erick Pulga', 'Bahia', 'finalizacao',
    true, 'Chapecoense', ['brasileirao']
  );
  if (h) {
    console.log('   ✅ Média:', h.average.toFixed(2), 'em', h.entries.length, 'jogos');
    h.entries.forEach(e => console.log('   ', e.date.slice(0,10), 'vs', e.opponent, ':', e.value));
  } else {
    console.log('   ❌ Nenhum histórico');
  }

  // 5. Tenta com Neymar (jogador conhecido)
  console.log('\n👤 Teste 4: Histórico de Neymar (finalizacao)');
  const h2 = await getPlayerHistory(
    'Neymar', 'Santos', 'finalizacao',
    true, undefined, ['brasileirao']
  );
  if (h2) {
    console.log('   ✅ Média:', h2.average.toFixed(2), 'em', h2.entries.length, 'jogos');
    h2.entries.forEach(e => console.log('   ', e.date.slice(0,10), 'vs', e.opponent, ':', e.value));
  } else {
    console.log('   ❌ Nenhum histórico');
  }
}

main().catch(console.error);
