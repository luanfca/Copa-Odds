// Debug Superbet API response - show raw event fields
export {}; // make this a module
async function main() {
  const H = {
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0',
    'Referer': 'https://superbet.bet.br'
  }
  const start = Date.now() - 604800000
  const dt = new Date(start).toISOString().replace('T', ' ').slice(0, 19)
  const url = 'https://production-superbet-offer-br.freetls.fastly.net/v2/pt-BR/events/by-date?currentStatus=active&sportId=5&categoryId=74&startDate=' + encodeURIComponent(dt)
  
  const r = await fetch(url, { headers: H })
  const j = await r.json()
  const events = j.data || []
  console.log('Events found:', events.length)
  
  if (events.length > 0) {
    const ev = events[0]
    console.log('\nAll keys of first event:', Object.keys(ev))
    console.log('\nRaw first event JSON:')
    // Show compact version of all fields
    for (const k of Object.keys(ev)) {
      const v = ev[k]
      const valStr = typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v)
      console.log(`  ${k}: ${valStr}`)
    }
    
    // Also check the matchName / eventName
    console.log('\nmatchName:', ev.matchName)
    console.log('eventName:', ev.eventName)
    console.log('homeTeam:', ev.homeTeam)
    console.log('awayTeam:', ev.awayTeam)
  }
}

main().catch(e => console.error('ERROR:', e.message))
