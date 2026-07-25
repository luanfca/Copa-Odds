// Debug: verifica por que getFinishedGamesAllComps(['brasileirao']) retorna 0 jogos
// npx tsx scripts/debug-br-games.mjs

import { baseParams, webwsJson } from '../src/lib/lineups365';

async function main() {
  console.log('🔍 Debugging Brasileirão game fetching\n');

  const COMP_ID_BR = '113';

  const windows = [
    { start: '01/04/2026', end: '30/04/2026' },
    { start: '01/05/2026', end: '31/05/2026' },
    { start: '01/06/2026', end: '15/06/2026' },
    { start: '01/07/2026', end: '31/07/2026' },
  ];

  for (const w of windows) {
    try {
      const params = baseParams({
        competitions: COMP_ID_BR,
        startDate: w.start,
        endDate: w.end,
        showOdds: 'false',
      });
      const url = '/web/games/?' + params;
      console.log('\n📡 Fetching window ' + w.start + ' to ' + w.end);
      
      const data = await webwsJson(url);
      const games = data && data.games ? data.games : [];
      
      console.log('   Status: ' + (data && data.status ? data.status : 'N/A'));
      console.log('   Total games: ' + games.length);
      
      const finished = games.filter(function(g) { 
        return g && (g.statusGroup === 4 || /fim|encerr|final/i.test(String(g && g.statusText ? g.statusText : '')));
      });
      console.log('   Finished: ' + finished.length);
      
      if (finished.length > 0) {
        for (const g of finished.slice(0, 5)) {
          const home = g.homeCompetitor ? g.homeCompetitor.name : '?';
          const away = g.awayCompetitor ? g.awayCompetitor.name : '?';
          const start = g.startTime ? g.startTime.slice(0, 10) : '?';
          console.log('   ✅ ' + home + ' x ' + away + ' (' + start + ')');
        }
      }
      
      if (games.length > 0) {
        for (const g of games.slice(0, 3)) {
          const home = g.homeCompetitor ? g.homeCompetitor.name : '?';
          const away = g.awayCompetitor ? g.awayCompetitor.name : '?';
          console.log('   📋 ' + home + ' x ' + away + ' statusGroup=' + g.statusGroup + ' statusText=' + (g.statusText || '') + ' (' + (g.startTime ? g.startTime.slice(0, 10) : '?') + ')');
        }
      }
    } catch (err) {
      const errMsg = err && typeof err === 'object' && err.message ? err.message : String(err);
      console.log('   ❌ Error: ' + errMsg);
    }
  }
  
  console.log('\n✅ Debug concluído');
}

main().catch(console.error);
