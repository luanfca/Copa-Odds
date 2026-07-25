import { prisma } from '../src/lib/prisma'

async function main() {
  // Total per market
  const markets = ['desarmes','faltas_cometidas','faltas_sofridas','finalizacao','chutes_ao_gol']
  for (const mk of markets) {
    const count = await prisma.oddSnapshot.count({ where: { market: mk } })
    console.log(`Market ${mk}: ${count} total snaps`)
  }

  // Superbet finalizacao/chutes_ao_gol
  const sbSnaps = await prisma.oddSnapshot.findMany({
    where: { house: 'superbet', market: { in: ['finalizacao','chutes_ao_gol'] } },
    take: 10,
    orderBy: { collectedAt: 'desc' },
    include: {
      player: {
        select: { displayName: true, team: true, match: { select: { homeTeam: true, awayTeam: true, competition: true } } }
      }
    }
  })
  console.log(`\nSuperbet finalizacao/chutes_ao_gol: ${sbSnaps.length} snapshots`)
  for (const s of sbSnaps) {
    console.log(`  ${s.player.displayName} mkt=${s.market} line=${s.line} val=${s.value} match=${s.player.match.homeTeam}vs${s.player.match.awayTeam} comp=${s.player.match.competition}`)
  }

  // Pitaco finalizacao/chutes_ao_gol for brasileirao
  const ptSnaps = await prisma.oddSnapshot.findMany({
    where: { house: 'pitaco', market: { in: ['finalizacao','chutes_ao_gol'] } },
    take: 10,
    orderBy: { collectedAt: 'desc' },
    include: {
      player: {
        select: { displayName: true, team: true, match: { select: { homeTeam: true, awayTeam: true, competition: true } } }
      }
    }
  })
  console.log(`\nPitaco finalizacao/chutes_ao_gol: ${ptSnaps.length} snapshots`)
  for (const s of ptSnaps) {
    console.log(`  ${s.player.displayName} mkt=${s.market} line=${s.line} val=${s.value} match=${s.player.match.homeTeam}vs${s.player.match.awayTeam} comp=${s.player.match.competition}`)
  }

  // BetMGM finalizacao/chutes_ao_gol
  const mgmSnaps = await prisma.oddSnapshot.findMany({
    where: { house: 'betmgm', market: { in: ['finalizacao','chutes_ao_gol'] } },
    take: 10,
    orderBy: { collectedAt: 'desc' },
    include: {
      player: {
        select: { displayName: true, team: true, match: { select: { homeTeam: true, awayTeam: true, competition: true } } }
      }
    }
  })
  console.log(`\nBetMGM finalizacao/chutes_ao_gol: ${mgmSnaps.length} snapshots`)
  for (const s of mgmSnaps) {
    console.log(`  ${s.player.displayName} mkt=${s.market} line=${s.line} val=${s.value} match=${s.player.match.homeTeam}vs${s.player.match.awayTeam} comp=${s.player.match.competition}`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
