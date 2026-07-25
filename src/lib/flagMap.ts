/**
 * Mapa de bandeiras para seleções da Copa do Mundo 2026.
 *
 * ANTES: FLAG_MAP em `scraping/index.ts` era um Record<string, string> de 90+
 * entradas percorrido com um loop O(n) que ainda chamava `slugify()` em cada
 * chave a cada invocação de `getFlag()`. Para 48 jogos × 2 times = 96 chamadas
 * por scraping = 96 × 90 = 8.640 iterações desnecessárias.
 *
 * AGORA: as chaves brutas são pré-normalizadas em tempo de módulo (uma vez só)
 * e armazenadas num Map, reduzindo o lookup a O(1) amortizado.
 *
 * Esta é a fonte única da verdade para bandeiras — `scraping/index.ts`,
 * `normalize.ts` e qualquer outro consumidor importam daqui.
 */

import { slugify } from './normalize';

// ─── Dados brutos (chaves em português/inglês, valores = código ISO) ─────────

const RAW_FLAG_MAP: ReadonlyArray<[string, string]> = [
  // ─── MLS ─────────────────────────────────────────────────────────
  ['inter miami', 'MIA'], ['inter miami cf', 'MIA'],
  ['la galaxy', 'LAG'], ['los angeles galaxy', 'LAG'],
  ['los angeles fc', 'LAF'], ['lafc', 'LAF'],
  ['new york city fc', 'NYC'], ['nycfc', 'NYC'],
  ['new york red bulls', 'NYR'],
  ['atlanta united', 'ATL'],
  ['seattle sounders', 'SEA'],
  ['portland timbers', 'POR'],
  ['columbus crew', 'CLB'],
  ['fc cincinnati', 'CIN'],
  ['orlando city', 'ORL'],
  ['nashville sc', 'NAS'],
  ['austin fc', 'AUS'],
  ['fc dallas', 'DAL'],
  ['houston dynamo', 'HOU'],
  ['chicago fire', 'CHI'],
  ['toronto fc', 'TOR'],
  ['vancouver whitecaps', 'VAN'],
  ['cf montreal', 'MTL'],
  ['colorado rapids', 'COL'],
  ['real salt lake', 'RSL'],
  ['sporting kansas city', 'SKC'],
  ['minnesota united', 'MIN'],
  ['st louis city sc', 'STL'],
  ['san jose earthquakes', 'SJ'],
  ['philadelphia union', 'PHI'],
  ['dc united', 'DCU'],
  ['charlotte fc', 'CLT'],
  ['new england revolution', 'NER'],
  ['vancouver whitecaps', 'VAN'],
  ['vancouver whitecaps fc', 'VAN'],

  // ─── Clubes Brasileiros ──────────────────────────────────────────
  ['botafogo', 'BOT'], ['botafogo rj', 'BOT'],
  ['flamengo', 'FLA'], ['flamengo rj', 'FLA'],
  ['fluminense', 'FLU'], ['fluminense rj', 'FLU'],
  ['vasco da gama', 'VAS'], ['vasco', 'VAS'],
  ['corinthians', 'COR'],
  ['palmeiras', 'PAL'],
  ['sao paulo', 'SAO'],
  ['santos', 'SAN'],
  ['internacional', 'INT'],
  ['gremio', 'GRE'],
  ['atletico mineiro', 'CAM'], ['atletico mg', 'CAM'], ['atletico', 'CAM'],
  ['cruzeiro', 'CRU'],
  ['america mg', 'AMM'],
  ['athletico paranaense', 'CAP'], ['athletico pr', 'CAP'],
  ['coritiba', 'CTB'],
  ['coritiba saf', 'CTB'],
  ['bahia', 'BAH'],
  ['vitoria', 'VIT'],
  ['fortaleza', 'FOR'],
  ['ceara', 'CEA'],
  ['remo', 'REM'],
  ['sport recife', 'SPT'],
  ['nautico', 'NAU'],
  ['goias', 'GOI'],
  ['cuiaba', 'CUI'],
  ['chapecoense', 'CHA'],
  ['avai', 'AVA'],
  ['criciuma', 'CRI'],
  ['brusque', 'BRU'],
  ['juventude', 'JUV'],
  ['mirassol', 'MIR'],
  ['red bull bragantino', 'RBB'], ['bragantino', 'RBB'],
  ['corinthians sp', 'COR'],
  ['palmeiras sp', 'PAL'],
  ['sao paulo sp', 'SAO'],
  ['santos sp', 'SAN'],
  ['internacional rs', 'INT'],
  ['gremio rs', 'GRE'],
  ['atletico mg', 'CAM'],
  ['cruzeiro mg', 'CRU'],
  ['america mg', 'AMM'],
  ['athletico pr', 'CAP'],
  ['coritiba pr', 'CTB'],
  ['coritiba saf', 'CTB'],
  ['bahia ba', 'BAH'],
  ['vitoria ba', 'VIT'],
  ['fortaleza ce', 'FOR'],
  ['ceara ce', 'CEA'],
  ['remo pa', 'REM'],
  ['sport pe', 'SPT'],
  ['goias go', 'GOI'],
  ['cuiaba mt', 'CUI'],
  ['chapecoense sc', 'CHA'],
  ['avai sc', 'AVA'],
  ['criciuma sc', 'CRI'],
  ['brusque sc', 'BRU'],
  ['juventude rs', 'JUV'],
  ['botafogo rj', 'BOT'],
  ['flamengo rj', 'FLA'],
  ['fluminense rj', 'FLU'],
  ['vasco da gama rj', 'VAS'],
  ['londrina', 'LON'],
  ['londrina ec', 'LON'],
  ['novorizontino', 'NOV'],
  ['novorizontino sp', 'NOV'],
  ['sao bernardo', 'SBE'],
  ['crb', 'CRB'],
  ['crb al', 'CRB'],

  // Variações com hífen (slugify remove o hífen, então usamos a versão sem)
  ['americamg', 'AMM'],
  ['botafogosp', 'BOT'],
  ['gremiors', 'GRE'],
  ['internacionalrs', 'INT'],

  // Américas (seleções)
  ['brasil', 'BR'], ['brazil', 'BR'],
  ['argentina', 'AR'],
  ['colombia', 'CO'],
  ['mexico', 'MX'],
  ['estados unidos', 'US'], ['usa', 'US'], ['united states', 'US'],
  ['canada', 'CA'],
  ['australia', 'AU'],
  ['uruguai', 'UY'], ['uruguay', 'UY'],
  ['chile', 'CL'],
  ['peru', 'PE'],
  ['paraguai', 'PY'], ['paraguay', 'PY'],
  ['venezuela', 'VE'],
  ['bolivia', 'BO'],
  ['equador', 'EC'], ['ecuador', 'EC'],
  ['costa rica', 'CR'],
  ['honduras', 'HN'],
  ['panama', 'PA'],
  ['jamaica', 'JM'],
  ['haiti', 'HT'],
  ['curacao', 'CW'],

  // Europa
  ['franca', 'FR'], ['france', 'FR'],
  ['alemanha', 'DE'], ['germany', 'DE'],
  ['espanha', 'ES'], ['spain', 'ES'],
  ['portugal', 'PT'],
  ['inglaterra', 'GB-ENG'], ['england', 'GB-ENG'],
  ['italia', 'IT'], ['italy', 'IT'],
  ['holanda', 'NL'], ['netherlands', 'NL'], ['paises baixos', 'NL'],
  ['belgica', 'BE'], ['belgium', 'BE'],
  ['croacia', 'HR'], ['croatia', 'HR'],
  ['suica', 'CH'], ['switzerland', 'CH'],
  ['austria', 'AT'],
  ['dinamarca', 'DK'], ['denmark', 'DK'],
  ['suecia', 'SE'], ['sweden', 'SE'],
  ['noruega', 'NO'], ['norway', 'NO'],
  ['turquia', 'TR'], ['turkey', 'TR'],
  ['russia', 'RU'],
  ['gales', 'GB-WLS'], ['wales', 'GB-WLS'],
  ['escocia', 'GB-SCT'], ['scotland', 'GB-SCT'],
  ['irlanda', 'IE'], ['ireland', 'IE'],
  ['republica checa', 'CZ'], ['republica tcheca', 'CZ'], ['czech', 'CZ'],
  ['hungria', 'HU'], ['hungary', 'HU'],
  ['romenia', 'RO'], ['romania', 'RO'],
  ['georgia', 'GE'],
  ['eslovenia', 'SI'], ['slovenia', 'SI'],
  ['eslovaquia', 'SK'], ['slovakia', 'SK'],
  ['albania', 'AL'],
  ['servia', 'RS'], ['serbia', 'RS'],
  ['polonia', 'PL'], ['poland', 'PL'],
  ['ucrania', 'UA'], ['ukraine', 'UA'],
  ['bosnia herzegovina', 'BA'], ['bosnia e herzegovina', 'BA'], ['bosnia', 'BA'],

  // África
  ['marrocos', 'MA'], ['morocco', 'MA'],
  ['senegal', 'SN'],
  ['nigeria', 'NG'],
  ['gana', 'GH'], ['ghana', 'GH'],
  ['cameroun', 'CM'], ['camaroes', 'CM'],
  ['tunis', 'TN'], ['tunisia', 'TN'],
  ['argelia', 'DZ'], ['algeria', 'DZ'],
  ['egito', 'EG'], ['egypt', 'EG'],
  ['cote divoire', 'CI'], ['marfim', 'CI'],
  ['mali', 'ML'],
  ['burkina faso', 'BF'],
  ['guinea', 'GN'],
  ['congo', 'CD'],
  ['africa do sul', 'ZA'], ['south africa', 'ZA'],
  ['cabo verde', 'CV'], ['cape verde', 'CV'],

  // Ásia & Oceania
  ['japao', 'JP'], ['japan', 'JP'],
  ['coreia do sul', 'KR'], ['south korea', 'KR'],
  ['arabia saudita', 'SA'], ['saudi', 'SA'],
  ['iran', 'IR'],
  ['catar', 'QA'], ['qatar', 'QA'],
  ['kuwait', 'KW'],
  ['jordania', 'JO'],
  ['emirados arabes', 'AE'], ['uae', 'AE'],
  ['china', 'CN'],
  ['india', 'IN'],
  ['indonesia', 'ID'],
  ['vietnam', 'VN'],
  ['tailandia', 'TH'], ['thailand', 'TH'],
  ['malasia', 'MY'],
  ['filipinas', 'PH'],
  ['uzbequistao', 'UZ'], ['uzbekistan', 'UZ'],
  ['iraque', 'IQ'], ['iraq', 'IQ'],
  ['nova zelandia', 'NZ'], ['new zealand', 'NZ'],
];

// ─── Pre-computação em tempo de módulo (O(1) em runtime) ─────────────────────

/**
 * Map pré-normalizado: chave slugificada → código ISO.
 * Construído uma única vez ao importar o módulo.
 */
const _flagLookup = new Map<string, string>();

for (const [raw, code] of RAW_FLAG_MAP) {
  const key = slugify(raw);
  if (!_flagLookup.has(key)) {
    _flagLookup.set(key, code);
  }
}

/** Entries pré-computados uma única vez — evita `Array.from(_flagLookup)`
 *  a cada chamada de `getFlag()` (era executado em todo scraping). */
const _flagEntries = Array.from(_flagLookup.entries());

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Resolve o código ISO de bandeira para um nome de time.
 *
 * Estratégia:
 * 1. Lookup exato no Map pré-normalizado (O(1))
 * 2. Busca por substring se o lookup exato falhar (ex: "Brasil Sub-23" → 'BR')
 * 3. Retorna string vazia se não encontrar
 */
export function getFlag(teamName: string): string {
  if (!teamName) return '';
  const slug = slugify(teamName);

  // 1. Lookup exato — O(1)
  const exact = _flagLookup.get(slug);
  if (exact) return exact;

  // 1.5 Fallback: remove hífens e não-alfanuméricos (ex: "América-MG" → "americamg" → "america mg")
  const withSpaces = slug.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (withSpaces !== slug) {
    const fb = _flagLookup.get(withSpaces);
    if (fb) return fb;
  }

  // 2. Substring: percorre apenas uma vez, parando no primeiro match
  for (const [key, code] of _flagEntries) {
    if (slug.includes(key) || key.includes(slug)) {
      return code;
    }
  }

  return '';
}

/** Expõe o mapa completo como ReadonlyMap para inspeção/testes. */
export const FLAG_LOOKUP: ReadonlyMap<string, string> = _flagLookup;

/**
 * Conjunto de SELEÇÕES (países) da Copa do Mundo 2026.
 *
 * Separado do `flagMap` geral porque este último mistura abreviações de
 * CLUBES brasileiros (FLA, SAO, INT…) com bandeiras de países. Usar o
 * mapa geral para detectar seleções geraria falso-positivo em todo clube
 * da Série A. Aqui listamos APENAS seleções nacionais.
 */
const NATIONAL_TEAMS = new Set<string>([
  // Américas
  'brasil', 'brazil', 'argentina', 'colombia', 'mexico', 'estados unidos',
  'usa', 'united states', 'canada', 'australia', 'uruguai', 'uruguay',
  'chile', 'peru', 'paraguai', 'paraguay', 'venezuela', 'bolivia',
  'equador', 'ecuador', 'costa rica', 'honduras', 'panama', 'jamaica',
  'haiti', 'curacao',
  // Europa
  'franca', 'france', 'alemanha', 'germany', 'espanha', 'spain', 'portugal',
  'inglaterra', 'england', 'italia', 'italy', 'holanda', 'netherlands',
  'paises baixos', 'belgica', 'belgium', 'croacia', 'croatia', 'suica',
  'switzerland', 'austria', 'dinamarca', 'denmark', 'suecia', 'sweden',
  'noruega', 'norway', 'turquia', 'turkey', 'russia', 'gales', 'wales',
  'escocia', 'scotland', 'irlanda', 'ireland', 'republica checa',
  'republica tcheca', 'czech', 'hungria', 'hungary', 'romenia', 'romania',
  'georgia', 'eslovenia', 'slovenia', 'eslovaquia', 'slovakia', 'albania',
  'servia', 'serbia', 'polonia', 'poland', 'ucrania', 'ukraine',
  'bosnia herzegovina', 'bosnia e herzegovina', 'bosnia',
  // África
  'marrocos', 'morocco', 'senegal', 'nigeria', 'gana', 'ghana', 'cameroun',
  'camaroes', 'tunis', 'tunisia', 'argelia', 'algeria', 'egito', 'egypt',
  'cote divoire', 'marfim', 'mali', 'burkina faso', 'guinea', 'congo',
  'africa do sul', 'south africa', 'cabo verde', 'cape verde',
  // Ásia & Oceania
  'japao', 'japan', 'coreia do sul', 'south korea', 'arabia saudita',
  'saudi', 'iran', 'catar', 'qatar', 'kuwait', 'jordania',
  'emirados arabes', 'uae', 'china', 'india', 'indonesia', 'vietnam',
  'tailandia', 'thailand', 'malasia', 'filipinas', 'uzbequistao',
  'uzbekistan', 'iraque', 'iraq', 'nova zelandia', 'new zealand',
]);

/**
 * Determina se um nome de time se refere a um CLUBE (e não a uma seleção
 * nacional). Usado para filtrar jogos da Copa do Mundo que por engano
 * entram na lista da MLS (ex: "Inglaterra x Toronto FC").
 *
 * Só rejeita nomes que batem EXATAMENTE com uma seleção conhecida — clubes
 * brasileiros (Flamengo, São Paulo…) NÃO são afetados.
 */
export function isClubTeam(teamName: string): boolean {
  if (!teamName) return false;
  const slug = slugify(teamName);
  return !NATIONAL_TEAMS.has(slug);
}
