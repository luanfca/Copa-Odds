import fs from 'fs';

const big = fs.readFileSync('scripts/_bf-big.json', 'utf8');
const types = [...new Set([...big.matchAll(/"(PLAYER_TO_HAVE_[A-Z0-9_]+)"/g)].map((m) => m[1]))];
console.log('PLAYER_TO_HAVE types:', types);
console.log(
  'SHOT types:',
  types.filter((t) => /SHOT/i.test(t)),
);

const titles = [
  ...new Set([...big.matchAll(/"translated":"([^"]{3,80})"/g)].map((m) => m[1])),
].filter((t) => /chute|shot|finaliz|jogador|desarme|falta|por jogador/i.test(t));
console.log('titles:', titles);

const mnames = [
  ...new Set(
    [...big.matchAll(/"name":"([^"]*(?:chute|shot|finaliz|SHOT)[^"]*)"/gi)].map((m) => m[1]),
  ),
];
console.log('market names:', mnames.slice(0, 50));

console.log(
  'range labels in json:',
  big.match(/1\+ até 3\+|4\+ a 6\+|1\+ a 3\+|Chutes por/gi)?.slice(0, 20),
);

// parse and list all Cards titles + marketTypes
const data = JSON.parse(big);
const cards = data?.data?.Cards || [];
console.log('cards count', cards.length);
for (let i = 0; i < cards.length; i++) {
  const c = cards[i];
  const title =
    c.pebbleCardGroupTitle?.translated ||
    c.cardGroupTitle?.translated ||
    c.title ||
    c.__typename;
  const edges = c.full?.edges || c.edges || [];
  const mtypes = new Set();
  const mnames2 = new Set();
  for (const e of edges) {
    const markets = e?.node?.markets || [];
    if (e?.node?.market) markets.push({ market: e.node.market });
    for (const m of markets) {
      const mk = m.market || m;
      if (mk.marketType) mtypes.add(mk.marketType);
      if (mk.name) mnames2.add(mk.name);
    }
    // switcher options
    const lab = e?.name || e?.node?.label || e?.node?.name;
    if (lab) mnames2.add(`edge:${lab}`);
  }
  if (
    /chute|shot|finaliz|desarme|falta|tackle|foul/i.test(String(title)) ||
    [...mtypes].some((t) => /SHOT|FOUL|TACKLE/i.test(t))
  ) {
    console.log(`\nCard[${i}] ${title}`);
    console.log('  types:', [...mtypes].slice(0, 20));
    console.log('  names/edges:', [...mnames2].slice(0, 20));
  }
}

// Also search entire tree for OR_MORE_SHOT without ON_TARGET
const allTypes = [...new Set([...big.matchAll(/"marketType":"([^"]+)"/g)].map((m) => m[1]))];
console.log(
  '\nAll marketTypes with SHOT:',
  allTypes.filter((t) => /SHOT/i.test(t)),
);
console.log(
  'All marketTypes with 1_OR/2_OR/3_OR:',
  allTypes.filter((t) => /[123]_OR_MORE/i.test(t)),
);
