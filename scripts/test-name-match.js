// Test if isSamePlayer matches abbreviated vs full names
const levenshtein = require('fast-levenshtein');

function slugify(name) {
  if (!name) return '';
  const normalized = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return normalized.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSamePlayer(nameA, nameB) {
  const a = slugify(nameA);
  const b = slugify(nameB);
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.endsWith(shorter) && longer.length - shorter.length <= 15) return true;
  if (shorter.length >= 5 && longer.includes(shorter) && longer.length - shorter.length <= 4) return true;
  const sortWords = (s) => s.split(/\s+/).sort().join(' ');
  if (sortWords(a) === sortWords(b)) return true;
  const partsA = a.split(/\s+/);
  const partsB = b.split(/\s+/);
  if (partsA.length >= 2 && partsB.length >= 2) {
    if (partsA[partsA.length - 1] === partsB[partsB.length - 1] &&
        partsA[0][0] === partsB[0][0] &&
        Math.abs(partsA.length - partsB.length) <= 1) {
      return true;
    }
  }
  const dist = levenshtein.get(a, b);
  const maxLen = Math.max(a.length, b.length);
  const similarity = 1 - dist / maxLen;
  return similarity >= 0.8;
}

// Test cases from the DB
const pairs = [
  ['Alexander Barboza', 'A. Barboza'],
  ['Andreas Pereira', 'A. Pereira'],
  ['Arthur Gabriel Santana Marcolino', 'A. Gabriel'],
  ['Breno Lopes', 'B. Lopes'],
  ['Agustin Giay', 'A. Giay'],
];

console.log('Name matching results:');
for (const [a, b] of pairs) {
  console.log(`  "${a}" vs "${b}": ${isSamePlayer(a, b)}`);
}
