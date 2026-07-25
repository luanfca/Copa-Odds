// Test BetMGM API - fetch ALL markets for an event to find the player shot market type
const H = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://www.betmgm.bet.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Origin': 'https://www.betmgm.bet.br'
}

async function main() {
  // Get events for Brasileirao (groupId 1173)
  const url1 = 'https://br-program-api.goldrush.llc/program/v1/api/events?groupIds=1173&matchState=PREMATCH,ONGOING&limit=5&lang=pt&brand=betmgm&location=BR&startTimeOffsetFrom=-86400000'
  const r1 = await fetch(url1, { headers: H })
  const j1 = await r1.json()
  const events = j1.data || []
  console.log('Events:', events.length)
  if (events.length === 0) { console.log('No events'); return }
  
  // Get ALL markets for these events (no marketTypes filter!)
  const ids = events.slice(0, 2).map(e => e.id).filter(Boolean).join(',')
  console.log('Fetching ALL markets for IDs:', ids)
  
  await new Promise(r => setTimeout(r, 2000))
  
  const url2 = `https://br-program-api.goldrush.llc/program/v1/api/events?ids=${ids}&lang=pt&brand=betmgm&location=BR&fields=GROUPS,BETMARKETS,STATISTICS`
  const r2 = await fetch(url2, { headers: H })
  const text = await r2.text()
  
  try {
    const j2 = JSON.parse(text)
    const data = j2.data || []
    console.log('Events in response:', data.length)
    
    for (const ed of data) {
      const home = ed.participants?.[0]?.name || '?'
      const away = ed.participants?.[1]?.name || '?'
      console.log(`\nMatch ${ed.id}: ${home} vs ${away}`)
      
      const mkts = ed.markets || []
      console.log('Total markets:', mkts.length)
      
      // Look for player markets related to shots/chutes/finalizacao
      for (const mk of mkts) {
        const name = mk.name || ''
        const type = mk.type || ''
        const outcomes = (mk.outcomes || []).length
        
        if (name.toLowerCase().includes('chute') || name.toLowerCase().includes('finaliza') || name.toLowerCase().includes('shot')) {
          console.log(`  type="${type}" name="${name}" outcomes=${outcomes}`)
          if (outcomes > 0) {
            for (const oc of mk.outcomes.slice(0, 2)) {
              console.log(`    ${oc.name || '?'} price=${oc.formatDecimal || oc.odds || oc.price || '?'}`)
            }
          }
        }
      }
      
      // Also show first few player markets to see what types exist
      let playerMkts = mkts.filter(m => (m.type || '').includes('player'))
      if (playerMkts.length > 0) {
        console.log(`\nAll player market types for ${home} vs ${away}:`)
        for (const mk of playerMkts) {
          console.log(`  type="${mk.type}" name="${mk.name || ''}" outcomes=${(mk.outcomes || []).length}`)
        }
      }
    }
  } catch(e) {
    console.log('Parse error:', e.message)
    console.log('Response (first 800 chars):', text.slice(0, 800))
  }
}

main().catch(e => console.error('Error:', e.message))
