// Test BetMGM API for player-to-make-x-plus-shots market
const H = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://www.betmgm.bet.br',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Origin': 'https://www.betmgm.bet.br'
}

async function main() {
  // Step 1: Get events for Brasileirao (groupId 1173)
  const url1 = 'https://br-program-api.goldrush.llc/program/v1/api/events?groupIds=1173&matchState=PREMATCH,ONGOING&limit=5&lang=pt&brand=betmgm&location=BR&startTimeOffsetFrom=-86400000'
  const r1 = await fetch(url1, { headers: H })
  const j1 = await r1.json()
  const events = j1.data || []
  console.log('Events found:', events.length)
  
  for (const ev of events.slice(0, 3)) {
    const mid = ev.id
    const home = ev.participants?.[0]?.name || '?'
    const away = ev.participants?.[1]?.name || '?'
    console.log(`\nMatch ${mid}: ${home} vs ${away}`)
    
    await new Promise(r => setTimeout(r, 1000))
    
    // Step 2: Get player markets
    const url2 = `https://br-program-api.goldrush.llc/program/v1/api/events?ids=${mid}&lang=pt&brand=betmgm&location=BR&marketTypes=player-to-make-x-plus-shots,player-to-have-x-plus-shots-on-target,player-to-make-x-plus-shots-on-target`
    const r2 = await fetch(url2, { headers: H })
    const j2 = await r2.json()
    const evData = j2.data || []
    
    for (const ed of evData) {
      const markets = ed.markets || []
      for (const mk of markets) {
        if (mk.type.includes('shot') || mk.type.includes('Shot')) {
          const outcomes = mk.outcomes || []
          console.log(`  Market: ${mk.name} type=${mk.type} outcomes=${outcomes.length}`)
          for (const oc of outcomes.slice(0, 2)) {
            console.log(`    ${oc.name || '?'} price=${oc.formatDecimal || oc.odds || oc.price || '?'}`)
          }
        }
      }
    }
  }
}

main().catch(e => console.error('Error:', e.message))
