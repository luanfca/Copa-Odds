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
  
  const match = events.find(e => (e.matchName || '').includes('Chapecoense'));
  if (!match) { console.log('Not found'); return; }
  
  const matchId = match.eventId || match.offerId;
  const bbUrl = 'https://production-superbet-bmb.freetls.fastly.net/betbuilder/v2/getBetbuilderMarketsForMatch' +
    '?match_id=' + matchId + '&lang=pt-BR&target=SB_BR';
  
  const bbRes = await fetch(bbUrl, { headers: H });
  const bbData = await bbRes.json();
  const markets = bbData.markets || [];
  
  // Find the specific "Jogador - Finalizações" market (not sub-markets)
  const mainFinalizacao = markets.find(m => m.name === 'Jogador - Finalizações');
  if (mainFinalizacao) {
    console.log('=== Jogador - Finalizações (MAIN) ===');
    const odds = mainFinalizacao.odds || [];
    for (const o of odds) {
      const spec = o.specifiers || {};
      const pName = spec.player_name || o.name || '';
      if (pName.toLowerCase().includes('pulga')) {
        console.log(`  player="${pName}" | total=${spec.total} | price=${o.price || o.odd} | name="${o.name}"`);
      }
    }
  } else {
    console.log('MAIN "Jogador - Finalizações" NOT FOUND');
  }

  // Show ALL finalizacao-related markets for Erick Pulga
  console.log('\n=== ALL "Finalizações" markets for Erick Pulga ===');
  for (const m of markets) {
    if (!(m.name || '').toLowerCase().includes('finalizaç')) continue;
    const odds = m.odds || [];
    for (const o of odds) {
      const spec = o.specifiers || {};
      const pName = spec.player_name || o.name || '';
      if (pName.toLowerCase().includes('pulga')) {
        console.log(`Market="${m.name}" | total=${spec.total} | price=${o.price || o.odd}`);
      }
    }
  }
}

main().catch(console.error);
