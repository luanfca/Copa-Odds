const H = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://www.betmgm.bet.br',
  'User-Agent': 'Mozilla/5.0',
  'Origin': 'https://www.betmgm.bet.br'
}

async function main() {
  const url1 = 'https://br-program-api.goldrush.llc/program/v1/api/events?groupIds=1173&matchState=PREMATCH,ONGOING&limit=5&lang=pt&brand=betmgm&location=BR&startTimeOffsetFrom=-86400000'
  const r1 = await fetch(url1, { headers: H })
  const j1 = await r1.json()
  const events = j1.data || []
  console.log('Events:', events.length)
  if (events.length === 0) { console.log('No events'); return }
  
  const mids = events.map(e => e.id).filter(Boolean).slice(0, 2).join(',')
  console.log('Getting markets for IDs:', mids)
  
  await new Promise(r => setTimeout(r, 2000))
  
  const url2 = `https://br-program-api.goldrush.llc/program/v1/api/events?ids=${mids}&lang=pt&brand=betmgm&location=BR&fields=GROUPS,BETMARKETS,STATISTICS&marketTypes=player-to-make-x-plus-shots,player-to-have-x-plus-shots-on-target,player-to-make-x-plus-shots-on-target`
  const r2 = await fetch(url2, { headers: H })
  const text = await r2.text()
  console.log('Response length:', text.length)
  
  try {
    const j2 = JSON.parse(text)
    const data = j2.data || []
    console.log('Events in response:', data.length)
    
    for (const ed of data) {
      console.log('\nEvent:', ed.id, ed.participants?.[0]?.name || '', 'vs', ed.participants?.[1]?.name || '')
      const mkts = ed.markets || []
      console.log('Total markets:', mkts.length)
      for (const mk of mkts) {
        console.log(`  type="${mk.type}" name="${mk.name || ''}" outcomes=${(mk.outcomes||[]).length}`)
      }
    }
  } catch(e) {
    console.log('Parse error:', e.message)
    console.log('Raw response (first 500 chars):', text.slice(0, 500))
  }
}

main().catch(e => console.error('Error:', e.message))
