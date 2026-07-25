// Diagnóstico: compara finalização vs desarmes nos 5 jogos
// npx tsx scripts/diagnostico.mjs (sem TS annotations)

import { getPlayerHistory, getFinishedGamesAllComps, getGameMemberStats } from '../src/lib/playerStats365';
import { getSofascorePlayerGameStats } from '../src/lib/sofascoreStats';
import { teamSlug, teamSlugMatch, isNameMatch } from '../src/lib/lineups365';

async function main() {
  console.log('═══ DIAGNÓSTICO: Erick Pulga — 5 jogos ═══\n');

  var brGames = await getFinishedGamesAllComps(['brasileirao']);
  var bahiaGames = brGames.filter(function(g) {
    return teamSlugMatch(g.homeSlug, teamSlug('Bahia')) ||
      teamSlugMatch(g.awaySlug, teamSlug('Bahia'));
  }).slice(-5);

  console.log('📅 Últimos ' + bahiaGames.length + ' jogos do Bahia:\n');

  for (var gi = 0; gi < bahiaGames.length; gi++) {
    var g = bahiaGames[gi];
    var isHome = teamSlugMatch(g.homeSlug, teamSlug('Bahia'));
    var opponent = isHome ? g.awayName : g.homeName;
    console.log('────────────── ' + (g.start ? g.start.slice(0, 10) : '?') + ' vs ' + opponent + ' ──────────────');

    // SofaScore - full player stats
    try {
      var sofaPlayers = await getSofascorePlayerGameStats(g.homeName, g.awayName, g.start);
      
      // Log how many players returned
      console.log('  SofaScore: ' + sofaPlayers.length + ' jogadores retornados');
      
      var sofaPlayer = null;
      for (var si = 0; si < sofaPlayers.length; si++) {
        if (isNameMatch('Erick Pulga', sofaPlayers[si].name)) {
          sofaPlayer = sofaPlayers[si];
          break;
        }
      }
      
      if (sofaPlayer) {
        console.log('  ✅ Encontrou: min=' + sofaPlayer.minutes
          + ' tackles=' + sofaPlayer.tackles
          + ' foulsC=' + sofaPlayer.foulsCommitted
          + ' foulsS=' + sofaPlayer.foulsSuffered
          + ' shots=' + sofaPlayer.shots);
      } else {
        console.log('  ❌ NÃO encontrou Erick Pulga');
        // Show first 3 player names to debug
        for (var si = 0; si < Math.min(3, sofaPlayers.length); si++) {
          console.log('     Jogador: "' + sofaPlayers[si].name + '"');
        }
      }
    } catch (err2) {
      var msg = err2 && typeof err2 === 'object' && err2.message ? err2.message : String(err2);
      console.log('  💥 SofaScore ERRO: ' + msg);
    }

    // 365scores
    try {
      var members = await getGameMemberStats(g.gameId);
      var pool = [];
      for (var mi = 0; mi < members.length; mi++) {
        if (teamSlugMatch(members[mi].teamSlug, teamSlug('Bahia'))) {
          pool.push(members[mi]);
        }
      }
      var searchPool = pool.length > 0 ? pool : members;
      var hit = null;
      for (var mi = 0; mi < searchPool.length; mi++) {
        if (isNameMatch('Erick Pulga', searchPool[mi].name)) {
          hit = searchPool[mi];
          break;
        }
      }
      
      if (hit) {
        var min = hit.statsByType.get(30);
        var des = hit.statsByType.get(39);
        console.log('     📋 365scores: min=' + (min !== undefined ? min : 'N/A')
          + ', desarmes_raw=' + (des !== undefined ? des : 'N/A'));
      } else {
        console.log('     📋 365scores: jogador não encontrado');
      }
    } catch (err3) {
      console.log('     📋 365scores ERRO');
    }
  }

  // Test getPlayerHistory for desarmes
  console.log('\n═══════════ getPlayerHistory(desarmes) ═══════════');
  var h = await getPlayerHistory(
    'Erick Pulga', 'Bahia', 'desarmes',
    true, undefined, ['brasileirao']
  );
  
  if (h) {
    console.log('📊 Média: ' + h.average.toFixed(2) + ' em ' + h.entries.length + ' jogos');
    for (var ei = 0; ei < h.entries.length; ei++) {
      var e = h.entries[ei];
      console.log('   ' + (e.date ? e.date.slice(0, 10) : '?') + ' vs ' + e.opponent + ': ' + e.value + ' desarmes (' + (e.minutes != null ? e.minutes + ' min' : 'N/A') + ')');
    }
  } else {
    console.log('❌ Nenhum histórico');
  }

  // Test getPlayerHistory for finalizacao (compare)
  console.log('\n═══════════ getPlayerHistory(finalizacao) ═══════════');
  var h2 = await getPlayerHistory(
    'Erick Pulga', 'Bahia', 'finalizacao',
    true, undefined, ['brasileirao']
  );
  
  if (h2) {
    console.log('📊 Média: ' + h2.average.toFixed(2) + ' em ' + h2.entries.length + ' jogos');
    for (var ei = 0; ei < h2.entries.length; ei++) {
      var e2 = h2.entries[ei];
      console.log('   ' + (e2.date ? e2.date.slice(0, 10) : '?') + ' vs ' + e2.opponent + ': ' + e2.value + ' chutes (' + (e2.minutes != null ? e2.minutes + ' min' : 'N/A') + ')');
    }
  } else {
    console.log('❌ Nenhum histórico de finalização');
  }

  console.log('\n✅ Diagnóstico concluído');
}

main().catch(console.error);
