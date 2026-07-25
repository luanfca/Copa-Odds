const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

async function main() {
  // 1. Check team field distribution for new teams
  console.log("=== TEAM FIELD DISTRIBUTION ===");
  const teamDist = await p.$queryRawUnsafe(`
    SELECT p.match_id, p.team, count(*) as cnt 
    FROM Player p 
    WHERE p.match_id IN (
      SELECT id FROM Match 
      WHERE homeTeam IN ('Coritiba','Chapecoense','Remo') 
         OR awayTeam IN ('Coritiba','Chapecoense','Remo')
    ) AND p.team IN ('Coritiba','Chapecoense','Remo','')
    GROUP BY p.match_id, p.team 
    ORDER BY p.match_id
  `);
  teamDist.forEach(row => console.log(JSON.stringify(row)));

  // 2. Check matches and history status
  console.log("\n=== MATCHES WITH HISTORY STATUS ===");
  const matches = await p.$queryRawUnsafe(`
    SELECT m.id, m.homeTeam, m.awayTeam, m.date, 
           count(p.id) as players, 
           sum(CASE WHEN p.history IS NOT NULL THEN 1 ELSE 0 END) as with_history
    FROM Player p 
    JOIN Match m ON p.match_id = m.id 
    WHERE m.homeTeam IN ('Coritiba','Chapecoense','Remo') 
       OR m.awayTeam IN ('Coritiba','Chapecoense','Remo')
    GROUP BY m.id 
    ORDER BY m.date
  `);
  matches.forEach(row => console.log(JSON.stringify(row)));

  // 3. Sample individual players
  console.log("\n=== SAMPLE PLAYERS (Coritiba vs Palmeiras) ===");
  const sample = await p.$queryRawUnsafe(`
    SELECT id, name, team, displayName, 
           CASE WHEN history IS NOT NULL THEN 'YES' ELSE 'NO' END as has_history
    FROM Player 
    WHERE match_id IN (
      SELECT id FROM Match 
      WHERE homeTeam = 'Coritiba' AND awayTeam = 'Palmeiras'
    ) 
    LIMIT 10
  `);
  sample.forEach(row => console.log(JSON.stringify(row)));

  // 4. Check if ANY Coritiba players have history
  console.log("\n=== CORITIBA PLAYERS WITH HISTORY ===");
  const withHist = await p.$queryRawUnsafe(`
    SELECT p.name, p.team, p.displayName, m.date
    FROM Player p 
    JOIN Match m ON p.match_id = m.id 
    WHERE (m.homeTeam = 'Coritiba' OR m.awayTeam = 'Coritiba')
    AND p.history IS NOT NULL
    LIMIT 5
  `);
  withHist.forEach(row => console.log(JSON.stringify(row)));
  if (withHist.length === 0) console.log("NONE found");

  // 5. Check Brasileirão cache
  console.log("\n=== BRA CACHE (Coritiba) ===");
  const braCache = await p.$queryRawUnsafe(`SELECT count(*) as cnt FROM CacheTeamEvents WHERE team LIKE '%oritiba%'`);
  console.log(JSON.stringify(braCache[0]));

  // 6. Check all unique teams in matches for these 3 clubs
  console.log("\n=== ALL MATCHES FOR NEW TEAMS ===");
  const allMatches = await p.$queryRawUnsafe(`
    SELECT id, homeTeam, awayTeam, date, competition 
    FROM Match 
    WHERE homeTeam IN ('Coritiba','Chapecoense','Remo') 
       OR awayTeam IN ('Coritiba','Chapecoense','Remo')
    ORDER BY date DESC
    LIMIT 20
  `);
  allMatches.forEach(row => console.log(JSON.stringify(row)));

  process.exit();
}

main().catch(e => { console.error(e); process.exit(1); });
