import { prisma } from '../src/lib/prisma'

async function main() {
  // Last 5 scrapes
  const logs = await prisma.scrapeLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5
  })
  console.log('=== Last 5 scrapes ===')
  for (const l of logs) {
    const dur = l.finishedAt && l.startedAt
      ? Math.round((l.finishedAt.getTime() - l.startedAt.getTime()) / 1000) + 's'
      : 'N/A'
    console.log(`${l.status.padEnd(10)} | started=${(l.startedAt?.toISOString() || 'N/A').slice(11,19)} | dur=${dur} | bf=${l.betfairOk} mgm=${l.betmgmOk} sb=${l.superbetOk} pt=${l.pitacoOk} | matches=${l.matchCount} players=${l.playerCount} odds=${l.oddCount}`)
  }

  // Check for specific data: Bahia match (Santiago Ramos Mingo)
  const bahiaMatch = await prisma.match.findFirst({
    where: { homeTeam: { contains: 'Bahia' } },
    orderBy: { dateTime: 'desc' }
  })
  if (bahiaMatch) {
    console.log(`\n=== Bahia match: ${bahiaMatch.id.slice(0,8)} ${bahiaMatch.homeTeam} vs ${bahiaMatch.awayTeam}`)
    
    // Players in this match
    const players = await prisma.player.findMany({
      where: { matchId: bahiaMatch.id },
      include: { snapshots: { take: 5, orderBy: { collectedAt: 'desc' } } }
    })
    console.log(`Players: ${players.length}`)
    
    for (const p of players) {
      const finalizacaoSnaps = p.snapshots.filter(s => s.market === 'finalizacao')
      if (finalizacaoSnaps.length > 0) {
        console.log(`  ${p.displayName} (${p.team}):`)
        for (const s of finalizacaoSnaps) {
          console.log(`    house=${s.house} line=${s.line} val=${s.value} collected=${s.collectedAt.toISOString().slice(11,19)}`)
        }
      }
    }
  } else {
    console.log('\nNo Bahia match found')
  }

  // Check when was the latest snapshot collected
  const latest = await prisma.oddSnapshot.findFirst({
    orderBy: { collectedAt: 'desc' }
  })
  console.log(`\nLatest snapshot: ${latest?.collectedAt.toISOString() || 'N/A'}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
