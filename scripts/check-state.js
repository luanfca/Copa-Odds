const { PrismaClient } = require('.prisma/client');
const p = new PrismaClient();
(async () => {
  const logs = await p.scrapeLog.findMany({ orderBy: { startedAt: 'desc' }, take: 5 });
  for (const l of logs) {
    console.log(`[${l.startedAt.toISOString()}] status=${l.status} matches=${l.matchCount} players=${l.playerCount} odds=${l.oddCount} err=${l.errorMsg || 'none'}`);
    console.log(`  betfair=${l.betfairOk} betmgm=${l.betmgmOk} superbet=${l.superbetOk} bet365=${l.bet365Ok} betsson=${l.betssonOk} pitaco=${l.pitacoOk}`);
  }
  await p.$disconnect();
})();
