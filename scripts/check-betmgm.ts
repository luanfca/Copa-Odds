import { prisma } from '../src/lib/prisma'

async function main() {
  // BetMGM data by MARKET
  const byMarket = await prisma.oddSnapshot.groupBy({
    by: ['market'],
    where: { house: 'betmgm' },
    _count: { id: true }
  })
  console.log('BetMGM by market:')
  for (const m of byMarket) {
    console.log(`  ${m.market}: ${m._count.id}`)
  }

  // Pitaco data by MARKET
  const ptByMarket = await prisma.oddSnapshot.groupBy({
    by: ['market'],
    where: { house: 'pitaco' },
    _count: { id: true }
  })
  console.log('\nPitaco by market:')
  for (const m of ptByMarket) {
    console.log(`  ${m.market}: ${m._count.id}`)
  }

  // Superbet data by MARKET  
  const sbByMarket = await prisma.oddSnapshot.groupBy({
    by: ['market'],
    where: { house: 'superbet' },
    _count: { id: true }
  })
  console.log('\nSuperbet by market:')
  for (const m of sbByMarket) {
    console.log(`  ${m.market}: ${m._count.id}`)
  }

  // Betfair data by MARKET
  const bfByMarket = await prisma.oddSnapshot.groupBy({
    by: ['market'],
    where: { house: 'betfair' },
    _count: { id: true }
  })
  console.log('\nBetfair by market:')
  for (const m of bfByMarket) {
    console.log(`  ${m.market}: ${m._count.id}`)
  }

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
