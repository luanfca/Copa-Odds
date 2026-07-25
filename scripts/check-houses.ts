import { prisma } from '../src/lib/prisma'

async function main() {
  // BetMGM finalizacao/chutes_ao_gol data
  console.log('=== BetMGM finalizacao/chutes_ao_gol ===')
  const mgmCount = await prisma.oddSnapshot.count({
    where: { house: 'betmgm', market: { in: ['finalizacao', 'chutes_ao_gol'] } }
  })
  console.log('Total snapshots:', mgmCount)

  if (mgmCount > 0) {
    const mgmData = await prisma.oddSnapshot.findMany({
      where: { house: 'betmgm', market: { in: ['finalizacao', 'chutes_ao_gol'] } },
      take: 10,
      orderBy: { collectedAt: 'desc' },
      include: { player: { select: { displayName: true, team: true, match: { select: { homeTeam: true, awayTeam: true, competition: true } } } } }
    })
    for (const s of mgmData) {
      console.log(`  ${s.player.displayName} mkt=${s.market} line=${s.line} val=${s.value} match=${s.player.match.homeTeam}vs${s.player.match.awayTeam} comp=${s.player.match.competition}`)
    }
  }

  // Pitaco finalizacao/chutes_ao_gol
  console.log('\n=== Pitaco finalizacao/chutes_ao_gol ===')
  const ptCount = await prisma.oddSnapshot.count({
    where: { house: 'pitaco', market: { in: ['finalizacao', 'chutes_ao_gol'] } }
  })
  console.log('Total snapshots:', ptCount)

  if (ptCount > 0) {
    const ptData = await prisma.oddSnapshot.findMany({
      where: { house: 'pitaco', market: { in: ['finalizacao', 'chutes_ao_gol'] } },
      take: 10,
      orderBy: { collectedAt: 'desc' },
      include: { player: { select: { displayName: true, team: true, match: { select: { homeTeam: true, awayTeam: true, competition: true } } } } }
    })
    for (const s of ptData) {
      console.log(`  ${s.player.displayName} mkt=${s.market} line=${s.line} val=${s.value} match=${s.player.match.homeTeam}vs${s.player.match.awayTeam} comp=${s.player.match.competition}`)
    }
  }

  // Check Betfair finalizacao specifically (user said it works)
  console.log('\n=== Betfair finalizacao (sample) ===')
  const bfData = await prisma.oddSnapshot.findMany({
    where: { house: 'betfair', market: 'finalizacao' },
    take: 5,
    orderBy: { collectedAt: 'desc' },
    include: { player: { select: { displayName: true, match: { select: { homeTeam: true, awayTeam: true, competition: true } } } } }
  })
  console.log('Betfair finalizacao count:', await prisma.oddSnapshot.count({ where: { house: 'betfair', market: 'finalizacao' } }))
  for (const s of bfData) {
    console.log(`  ${s.player.displayName} line=${s.line} val=${s.value} match=${s.player.match.homeTeam}vs${s.player.match.awayTeam} comp=${s.player.match.competition}`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
