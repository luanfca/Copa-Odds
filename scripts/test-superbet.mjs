// Test Superbet API directly
const H = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://superbet.bet.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0.0.0',
};

async function main() {
  // First get match IDs for Brasileirao
  const start = new Date(Date.now() - 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const eventsUrl = 'https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date' +
    '?currentStatus=active&sportId=5&categoryId=74&startDate=' + encodeURIComponent(start);
  
  console.log('Fetching events...');
  const eventsRes = await fetch(eventsUrl, { headers: H });
  const eventsData = await eventsRes.json();
  const events = eventsData.data || [];
  
  // Find Bahia vs Chapecoense
  const match = events.find(e => 
    (e.matchName || '').toLowerCase().includes('bahia') && 
    (e.matchName || '').toLowerCase().includes('chapecoense')
  );
  
  if (!match) {
    console.log('Bahia vs Chapecoense not found in events');
    console.log('Available matches:', events.slice(0,5).map(e => e.matchName || e.eventName).join(', '));
    return;
  }
  
  const matchId = match.eventId || match.offerId;
  console.log(`Found match: ${match.matchName} (ID: ${matchId})`);

  // Now get BetBuilder markets
  const bbUrl = 'https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2/getBetbuilderMarketsForMatch' +
    '?match_id=' + matchId + '&lang=pt-BR&target=SB_BR';
  
  console.log('\nFetching BetBuilder markets...');
  const bbRes = await fetch(bbUrl, { headers: H });
  const bbData = await bbRes.json();
  const markets = bbData.markets || [];
  
  console.log(`Total markets: ${markets.length}`);
  
  // Find player markets with 'chute' or 'finalizac'
  const relevant = markets.filter(m => {
    const name = (m.name || '').toLowerCase();
    return name.includes('chute') || name.includes('finalizac');
  });
  
  console.log(`\n=== Player markets (chute/finalizac) — ${relevant.length} ===`);
  
  for (const m of relevant) {
    console.log(`\nMarket: "${m.name || 'unnamed'}"`);
    const odds = m.odds || [];
    console.log(`  Odds count: ${odds.length}`);
    
    // Show first few odds to understand specifiers
    for (let i = 0; i < Math.min(odds.length, 20); i++) {
      const o = odds[i];
      const spec = o.specifiers || {};
      const name = o.name || '';
      const price = o.price || o.odd || 0;
      const total = spec.total || 'N/A';
      const playerName = spec.player_name || name.split(' - ')[0] || name;
      console.log(`  [${i}] player="${playerName}" price=${price} total=${total} name="${name}"`);
    }
  }
  
  // Find Erick Pulga specifically
  console.log('\n=== ERICK PULGA SPECIFICALLY ===');
  for (const m of relevant) {
    const odds = m.odds || [];
    for (const o of odds) {
      const name = (o.name || '') + ' ' + ((o.specifiers || {}).player_name || '');
      if (name.toLowerCase().includes('pulga') || name.toLowerCase().includes('erick')) {
        const spec = o.specifiers || {};
        console.log(`Market: "${m.name}" | player="${spec.player_name || o.name}" | price=${o.price || o.odd} | total=${spec.total || 'N/A'} | line_name="${o.name}"`);
      }
    }
  }
}

main().catch(console.error);
