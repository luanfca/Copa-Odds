const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  await prisma.oddSnapshot.deleteMany({});
  await prisma.player.deleteMany({});
  await prisma.match.deleteMany({});
  const m = await prisma.match.count();
  console.log('limpo -> matches:', m);
  await prisma.$disconnect();
})().catch(e => { console.error(e); process.exit(1); });
