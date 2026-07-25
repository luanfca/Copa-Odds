// Testa name matching como o TypeScript faria
function normalizeName(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\./g, '').trim();
}

function toEntry(name) {
  const norm = normalizeName(name);
  return { norm, tokens: norm.split(' ').filter(Boolean) };
}

function initialCompatible(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
}

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i-1][j] + 1,
        dp[i][j-1] + 1,
        dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

function nameMatches(player, candidate) {
  const pl = player.tokens;
  const cl = candidate.tokens;
  if (pl.length === 0 || cl.length === 0) return false;
  if (player.norm === candidate.norm) return true;

  const pLast = pl[pl.length - 1];
  const cLast = cl[cl.length - 1];
  
  if (pLast === cLast) {
    if (pl.length === 1 || cl.length === 1) return true;
    
    // FIXED: Check initial against ALL candidate tokens (not just first)
    const pSingleInit = pl.length === 2 && pl[0].length === 1;
    const cSingleInit = cl.length === 2 && cl[0].length === 1;
    if (pSingleInit) {
      if (cl.slice(0, -1).some(t => initialCompatible(pl[0], t))) return true;
    }
    if (cSingleInit) {
      if (pl.slice(0, -1).some(t => initialCompatible(cl[0], t))) return true;
    }
    
    if (initialCompatible(pl[0], cl[0])) return true;
    const simFirst = 1 - levenshteinDistance(pl[0], cl[0]) / Math.max(pl[0].length, cl[0].length);
    if (simFirst >= 0.5) return true;
  }
  
  if (pl.every(t => cl.includes(t))) return true;
  if (pl.length === 1 && pl[0].length >= 4 && cl.includes(pl[0])) return true;
  return false;
}

function isNameMatch(a, b) {
  return nameMatches(toEntry(a), toEntry(b));
}

// Testes com nomes reais do Bahia
const tests = [
  // [DB Name, SofaScore Name, Expected]
  ['Kanu', 'Ronaldo', false],          // Jogadores diferentes
  ['R. Mingo', 'Santiago Ramos Mingo', true],  // Initial R = Ramos
  ['D. Duarte', 'David Duarte', true],  // Initial D = David
  ['M. Sanabria', 'Maicol Sanabria', true],  // Initial M = Maicol
  ['A. Veliz', 'Alexis Veliz', true],   // Initial A = Alexis
  ['C. Olivera', 'Cristian Olivera', true], // Initial C = Cristian
  ['W. José', 'Willian José', true],    // Initial W = Willian
  ['K. Junior', 'Kanu Junior', true],   // Initial K = Kanu
  ['Ademir', 'Ademir', true],           // Mesmo nome
  ['Everaldo', 'Everaldo', true],       // Mesmo nome
];

console.log('=== Name Matching Tests ===');
for (const [db, sofa, expected] of tests) {
  const result = isNameMatch(db, sofa);
  const status = result === expected ? 'OK' : 'FAIL';
  console.log(`[${status}] "${db}" vs "${sofa}" -> ${result} (expected ${expected})`);
  
  // Debug details
  if (result !== expected) {
    const a = toEntry(db);
    const b = toEntry(sofa);
    console.log(`  DB tokens: [${a.tokens.join(', ')}] last="${a.tokens[a.tokens.length-1]}"`);
    console.log(`  Sofa tokens: [${b.tokens.join(', ')}] last="${b.tokens[b.tokens.length-1]}"`);
    console.log(`  Last name match: ${a.tokens[a.tokens.length-1] === b.tokens[b.tokens.length-1]}`);
    console.log(`  initialCompatible("${a.tokens[0]}", "${b.tokens[0]}"): ${initialCompatible(a.tokens[0], b.tokens[0])}`);
  }
}
