const { PrismaClient } = require('.prisma/client');
const p = new PrismaClient();

(async () => {
  // Clear all player data (snapshots are cascade-deleted)
  const deleted = await p.player.deleteMany({});
  console.log(`Deleted ${deleted.count} players (snapshots cascade-deleted)`);
  await p.$disconnect();
})();
