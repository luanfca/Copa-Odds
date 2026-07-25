import { scrapeAll } from '../src/scraping/index.js';

async function main() {
  console.log('=== INICIANDO SCRAPING ===');
  const result = await scrapeAll();
  require('fs').writeFileSync('/tmp/scrape-result.json', JSON.stringify(result, null, 2));
  console.log('=== SCRAPE DONE ===');
  console.log(JSON.stringify({
    success: result.success,
    betfairOk: result.betfairOk,
    betmgmOk: result.betmgmOk,
    superbetOk: result.superbetOk,
    pitacoOk: result.pitacoOk,
    matchCount: result.matchCount,
    playerCount: result.playerCount,
    oddCount: result.oddCount,
  }, null, 2));
}

main().catch(e => {
  console.error('SCRAPE ERROR:', e);
  require('fs').writeFileSync('/tmp/scrape-error.txt', String(e));
  process.exit(1);
});
