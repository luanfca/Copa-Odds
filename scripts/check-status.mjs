import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const log = await p.scrapeLog.findFirst({ orderBy: { startedAt: 'desc' } });
  if (log) {
    console.log('Status:', log.status);
    console.log('Started:', log.startedAt?.toISOString());
    console.log('Finished:', log.finishedAt?.toISOString() || 'still running');
    console.log('betfair:', log.betfairOk);
    console.log('betmgm:', log.betmgmOk);
    console.log('superbet:', log.superbetOk);
    console.log('pitaco:', log.pitacoOk);
    console.log('matches:', log.matchCount);
    console.log('odds:', log.oddCount);
    console.log('error:', log.errorMsg || 'none');
  } else {
    console.log('No scrape logs found');
  }
  await p.$disconnect();
}

main().catch(e => { console.error(e); p.$disconnect(); });
