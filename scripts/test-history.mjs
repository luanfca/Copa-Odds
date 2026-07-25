import { getPlayerHistory } from '../src/lib/playerStats365.ts';

async function main() {
  // Test 1: Larson (Coritiba, team='Coritiba')
  console.log("=== TEST 1: Larson (team='Coritiba') ===");
  const h1 = await getPlayerHistory('Larson', 'Coritiba', 'desarmes', false, 'Palmeiras', ['brasileirao'], { maxGames: 10, year: 2026 });
  if (!h1) {
    console.log('HISTORY IS NULL');
  } else {
    console.log('total:', h1.total, 'avg:', h1.average, 'entries:', h1.entries.length);
    h1.entries.forEach(e => console.log(JSON.stringify(e)));
  }

  // Test 2: Jhon Arias (team='')
  console.log("\n=== TEST 2: Jhon Arias (team='') ===");
  const h2 = await getPlayerHistory('Jhon Arias', '', 'desarmes', false, 'Palmeiras', ['brasileirao'], { maxGames: 10, year: 2026 });
  if (!h2) {
    console.log('HISTORY IS NULL');
  } else {
    console.log('total:', h2.total, 'avg:', h2.average, 'entries:', h2.entries.length);
  }

  // Test 3: Everaldo (known working Bahia player)
  console.log("\n=== TEST 3: Everaldo (Bahia) ===");
  const h3 = await getPlayerHistory('Everaldo', 'Bahia', 'desarmes', false, null, ['brasileirao'], { maxGames: 10, year: 2026 });
  if (!h3) {
    console.log('HISTORY IS NULL');
  } else {
    console.log('total:', h3.total, 'avg:', h3.average, 'entries:', h3.entries.length);
  }

  process.exit();
}

main().catch(e => { console.error(e); process.exit(1); });
