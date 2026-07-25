import { prisma } from '../src/lib/prisma'

async function main() {
  // Last scrape
  const log = await prisma.scrapeLog.findFirst({
    orderBy: { startedAt: 'desc' }
  })
  if (log) {
    console.log('Last scrape:', log.status,
      'started:', log.startedAt?.toISOString(),
      'finished:', log.finishedAt?.toISOString())
    console.log('betfair:', log.betfairOk,
      'betmgm:', log.betmgmOk,
      'superbet:', log.superbetOk,
      'pitaco:', log.pitacoOk,
      'matches:', log.matchCount,
      'players:', log.playerCount,
      'odds:', log.oddCount)
  }

  // Count by competition
  const comps = await prisma.match.groupBy({
    by: ['competition'],
    _count: { id: true }
  })
  console.log('\nMatches by competition:')
  for (const c of comps) {
    console.log(`  ${c.competition}: ${c._count.id}`)
  }

  // Superbet data overview in DB
  const sbTotal = await prisma.oddSnapshot.count({
    where: { house: 'superbet' }
  })
  console.log('\nSuperbet total snapshots:', sbTotal)

  const sbByMarket = await prisma.oddSnapshot.groupBy({
    by: ['market'],
    where: { house: 'superbet' },
    _count: { id: true }
  })
  console.log('Superbet by market:')
  for (const m of sbByMarket) {
    console.log(`  ${m.market}: ${m._count.id}`)
  }

  // Check which competitions have Superbet data
  const sbMatches = await prisma.player.findMany({
    where: {
      snapshots: {
        some: { house: 'superbet' }
      }
    },
    include: {
      match: { select: { homeTeam: true, awayTeam: true, competition: true, id: true } }
    },
    distinct: ['matchId'],
    take: 20
  })
  console.log('\nSuperbet matches in DB:')
  const seenComps = new Set<string>()
  for (const p of sbMatches) {
    const key = `${p.match.competition}: ${p.match.homeTeam} vs ${p.match.awayTeam}`
    if (!seenComps.has(key)) {
      seenComps.add(key)
      console.log(`  ${p.match.competition}: ${p.match.homeTeam} vs ${p.match.awayTeam}`)
    }
  }
  
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
