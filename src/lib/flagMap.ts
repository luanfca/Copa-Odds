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
  // Américas
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

  // 2. Substring: percorre apenas uma vez, parando no primeiro match
  for (const [key, code] of Array.from(_flagLookup)) {
    if (slug.includes(key) || key.includes(slug)) {
      return code;
    }
  }

  return '';
}

/** Expõe o mapa completo como ReadonlyMap para inspeção/testes. */
export const FLAG_LOOKUP: ReadonlyMap<string, string> = _flagLookup;
