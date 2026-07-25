// Run Superbet scraper directly to test the finalizacao fix
import { scrapeSuperbet } from '../src/scraping/superbetAdapter.js';

async function main() {
  console.log('Running Superbet scraper directly...');
  const results = await scrapeSuperbet(['brasileirao']);
  console.log(`\nMatches: ${results.length}`);
  
  // Find Bahia vs Chapecoense
  const match = results.find(m => 
    m.homeTeam.includes('Bahia') || m.awayTeam.includes('Chapecoense')
  );
  
  if (match) {
    console.log(`\nMatch: ${match.homeTeam} vs ${match.awayTeam}`);
    console.log(`Total odds: ${match.odds.length}`);
    
    // Find Erick Pulga
    const pulgaOdds = match.odds.filter(o => 
      o.playerName.toLowerCase().includes('pulga')
    );
    
    if (pulgaOdds.length > 0) {
      console.log('\nErick Pulga odds:');
      const byMarket = {};
      for (const o of pulgaOdds) {
        if (!byMarket[o.market]) byMarket[o.market] = [];
        byMarket[o.market].push(o);
      }
      for (const [market, odds] of Object.entries(byMarket)) {
        console.log(`\n  ${market}:`);
        const sorted = odds.sort((a, b) => {
          const aNum = parseFloat(a.line.replace('+', ''));
          const bNum = parseFloat(b.line.replace('+', ''));
          return aNum - bNum;
        });
        for (const o of sorted) {
          console.log(`    ${o.line.padEnd(4)} = ${o.value.toFixed(3)}`);
        }
      }
    } else {
      console.log('\nErick Pulga not found in this match\'s odds');
    }
  } else {
    console.log('\nBahia vs Chapecoense not found');
    // Show first match
    if (results.length > 0) {
      const m = results[0];
      console.log(`First match: ${m.homeTeam} vs ${m.awayTeam} (${m.odds.length} odds)`);
    }
  }
}

main().catch(console.error);
