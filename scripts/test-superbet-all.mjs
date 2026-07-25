const H = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://superbet.bet.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
};

async function main() {
  const start = new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const eventsUrl = 'https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date' +
    '?currentStatus=active&sportId=5&categoryId=74&startDate=' + encodeURIComponent(start);
  
  const eventsRes = await fetch(eventsUrl, { headers: H });
  const eventsData = await eventsRes.json();
  const events = eventsData.data || [];
  
  // Find ALL Brasileirao matches  
  console.log('All Brasileirao match IDs:');
  for (const e of events.slice(0, 15)) {
    console.log(`  ${e.matchName || '?'} (ID: ${e.eventId || e.offerId})`);
  }
  
  const match = events.find(e => 
    (e.matchName || '').includes('Chapecoense')
  );
  if (!match) { console.log('Not found'); return; }
  
  const matchId = match.eventId || match.offerId;
  console.log(`\nTesting match: ${match.matchName} (ID: ${matchId})`);
  
  // Get ALL markets
  const bbUrl = 'https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2/getBetbuilderMarketsForMatch' +
    '?match_id=' + matchId + '&lang=pt-BR&target=SB_BR';
  
  const bbRes = await fetch(bbUrl, { headers: H });
  const bbData = await bbRes.json();
  const allMarkets = bbData.markets || [];
  
  console.log(`\nALL ${allMarkets.length} markets:`);
  
  // Group by name
  const byName = {};
  for (const m of allMarkets) {
    const name = m.name || 'UNNAMED';
    if (!byName[name]) byName[name] = { count: 0, odds: 0, hasPlayer: false };
    byName[name].count++;
    byName[name].odds += (m.odds || []).length;
    if ((m.name || '').toLowerCase().includes('jogador')) byName[name].hasPlayer = true;
  }
  
  for (const [name, info] of Object.entries(byName)) {
    const flag = info.hasPlayer ? ' [PLAYER]' : '';
    console.log(`  ${name}: ${info.count} entries, ${info.odds} odds${flag}`);
  }
  
  // Find Erick Pulga in ALL markets
  console.log('\n=== ERICK PULGA IN ALL MARKETS ===');
  for (const m of allMarkets) {
    const odds = m.odds || [];
    for (const o of odds) {
      const name = (o.name || '') + ' ' + ((o.specifiers || {}).player_name || '');
      if (name.toLowerCase().includes('pulga') || name.toLowerCase().includes('erick') || name.toLowerCase().includes('conrado')) {
        const spec = o.specifiers || {};
        console.log(`Market: "${m.name}" | line_name="${o.name}" | player="${spec.player_name || o.name}" | total=${spec.total} | price=${o.price || o.odd}`);
      }
    }
  }
  
  // Check if there's a market that doesn't include 'chute' or 'finalizac' but could match the adapter
  console.log('\n=== MARKETS THAT MATCH resolveSuperbetMarketKey ===');
  const mktFn = (name) => {
    const lower = (name || '').toLowerCase();
    if (lower.includes('total de desarmes') || (lower.includes('jogador') && lower.includes('desarme'))) return 'desarmes';
    if (lower.includes('faltas cometidas') || (lower.includes('jogador') && lower.includes('faltas cometidas'))) return 'faltas_cometidas';
    if (lower.includes('faltas sofridas') || (lower.includes('jogador') && lower.includes('faltas sofridas'))) return 'faltas_sofridas';
    if (lower.includes('chutes no gol') || lower.includes('chutes ao gol') || lower.includes('chute no gol') || lower.includes('chute ao gol')) return 'chutes_ao_gol';
    if (lower.includes('finalizações') || lower.includes('finalizacao') || lower.includes('chutes') || (lower.includes('jogador') && (lower.includes('finalização') || lower.includes('chute')))) return 'finalizacao';
    return null;
  };
  
  const matched = {};
  for (const m of allMarkets) {
    const result = mktFn(m.name);
    if (result) {
      if (!matched[result]) matched[result] = [];
      matched[result].push(m.name);
    }
  }
  for (const [market, names] of Object.entries(matched)) {
    console.log(`  ${market}:`);
    for (const n of names) console.log(`    - "${n}"`);
  }
}

main().catch(console.error);
