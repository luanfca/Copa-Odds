/**
 * Módulo de normalização de nomes, linhas e estágios de torneio.
 *
 * MUDANÇAS vs versão anterior:
 * - Corrigido: `require('fast-levenshtein')` com type-cast → import ESM correto
 * - Adicionado: `extractStage()` — antes duplicada em betfairAdapter e betmgmAdapter
 * - Adicionado: `normalizeName()` — alias unificado para sofascore.ts e scores365.ts
 *   (elimina as 3 implementações locais de normName/normalizeName espalhadas pelo projeto)
 */

import levenshtein from 'fast-levenshtein';

// ─── Slugify ─────────────────────────────────────────────────────────────────

/**
 * Converte uma string para slug ASCII minúsculo sem acentos.
 *
 * @example
 * slugify('João Félix')  // → 'joao felix'
 * slugify('Vinícius Jr.') // → 'vinicius junior'
 */
export function slugify(name: string): string {
  if (!name) return '';

  const normalized = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove diacríticos

  const base = normalized
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')  // remove caracteres especiais
    .replace(/\s+/g, ' ')
    .trim();

  // Canonicaliza sufixos de geração: "Jr." / "Jr" / "Junior" → "junior"
  // Sem isso, "Vinicius Junior" (BetMGM) e "Vinicius Jr." (Betfair) viram
  // dois jogadores diferentes na tabela de merge.
  const SUFFIX_MAP: Readonly<Record<string, string>> = {
    jr: 'junior', jnr: 'junior', jor: 'junior',
    sr: 'senior', snr: 'senior',
  };

  return base
    .split(' ')
    .map(tok => SUFFIX_MAP[tok] ?? tok)
    .join(' ');
}

// ─── normalizeName (API unificada para sofascore.ts e scores365.ts) ──────────

/**
 * Normaliza um nome para comparação — versão sem remoção de números.
 * Substitui as três implementações locais de `normName` espalhadas pelo projeto.
 *
 * @example
 * normalizeName('Café da Silva')  // → 'cafe da silva'
 * normalizeName('O`Brien')        // → 'o brien'
 */
export function normalizeName(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Similaridade de jogadores ────────────────────────────────────────────────

/**
 * Calcula se dois nomes de jogadores referem-se à mesma pessoa.
 * Combina match exato, substring com threshold de tamanho e
 * fuzzy match via distância de Levenshtein relativa.
 */
export function isSamePlayer(nameA: string, nameB: string): boolean {
  const a = slugify(nameA);
  const b = slugify(nameB);

  if (a === b) return true;

  // Substring só conta quando o nome menor é razoavelmente longo e a
  // diferença de tamanho é pequena. Evita casar "Sá" com "Sané".
  // Quando o nome menor é SUFFIXO do maior (ex: "Tchouameni" em "Aurelio Tchouameni"),
  // aceita diferença maior — é o caso clássico de sobrenome vs nome completo.
  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.endsWith(shorter) && longer.length - shorter.length <= 15) {
    return true;
  }
  if (shorter.length >= 5 && longer.includes(shorter) && longer.length - shorter.length <= 4) {
    return true;
  }

  // Compara ordenando as palavras (resolve "Paik Seung-ho" vs "Seung Ho Paik")
  const sortWords = (s: string) => s.split(/\s+/).sort().join(' ');
  if (sortWords(a) === sortWords(b)) return true;

  // Compara sobrenome + inicial do primeiro nome (resolve "Bae Joon-ho" vs "Bae Jun-ho")
  const partsA = a.split(/\s+/);
  const partsB = b.split(/\s+/);
  if (partsA.length >= 2 && partsB.length >= 2) {
    // Mesmo sobrenome + primeira letra do primeiro nome igual
    if (partsA[partsA.length - 1] === partsB[partsB.length - 1] &&
        partsA[0][0] === partsB[0][0] &&
        Math.abs(partsA.length - partsB.length) <= 1) {
      return true;
    }
  }

  // Fuzzy match: distância de Levenshtein relativa ao tamanho da string maior
  const dist = levenshtein.get(a, b);
  const maxLen = Math.max(a.length, b.length);
  const similarity = 1 - dist / maxLen;

  if (maxLen >= 5 && similarity >= 0.80) return true;
  if (maxLen < 5  && dist <= 1)          return true;

  return false;
}

/**
 * Encontra o índice de um jogador em uma lista pelo nome (com fuzzy match).
 * Retorna -1 se não encontrar.
 */
export function findPlayerIndex(
  players: ReadonlyArray<{ name: string }>,
  targetName: string,
): number {
  const slug = slugify(targetName);

  // 1. Match exato (mais rápido)
  const exactIdx = players.findIndex(p => slugify(p.name) === slug);
  if (exactIdx !== -1) return exactIdx;

  // 2. Fuzzy match
  return players.findIndex(p => isSamePlayer(p.name, targetName));
}

// ─── Normalização de formato de nome ─────────────────────────────────────────

/**
 * Converte o formato "Sobrenome, Nome" para "Nome Sobrenome".
 *
 * @example
 * normalizePlayerNameFormat('Zima, David') // → 'David Zima'
 */
export function normalizePlayerNameFormat(name: string): string {
  if (!name) return name;
  if (name.includes(',')) {
    const parts = name.split(',');
    if (parts.length === 2) {
      return `${parts[1].trim()} ${parts[0].trim()}`;
    }
  }
  return name;
}

/**
 * Heurística para distinguir um nome de jogador de lixo de mercado.
 *
 * As casas às vezes expõem linhas de TOTAL da partida ("Mais de 41.5",
 * "Menos de 27.5") na mesma grade dos props de jogador. Sem filtro, elas
 * acabam virando "jogadores" na tabela. Esta função rejeita esses casos
 * mantendo nomes simples de uma palavra ("Rodri", "Casemiro", "Endrick").
 */
export function isLikelyPlayerName(name: string): boolean {
  if (!name) return false;
  const t = name.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 40) return false;
  if (!/[A-Za-zÀ-ÿ]{2,}/.test(t)) return false;          // precisa ter letras
  if (/\d[.,]\d/.test(t)) return false;                   // linha: "41.5", "27,5"
  if (/^(mais|menos|acima|abaixo|over|under|sobre)\b/i.test(t)) return false;
  // Rejeita padrões como "Mais de 28.5", "Menos de 15.5", "Total de Gols"
  if (/\b(mais|menos|acima|abaixo|over|under)\s+de\s+\d/i.test(t)) return false;
  if (/\b\d+[.,]\d+\b/.test(t)) return false;             // qualquer número com casa decimal
  if (/\b(total|gols|escanteios|cartoes|corners|cards|goals)\b/i.test(t)) return false;
  // normaliza p/ comparar com a lista de lixo (minúsculas, sem acento)
  const norm = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const JUNK = new Set([
    // termos de mercado
    'sim', 'nao', 'empate', 'ambos', 'ambas', 'total', 'totais', 'par', 'impar',
    'desarmes', 'desarme', 'faltas', 'falta', 'tackles', 'tackle', 'mais', 'menos',
    'total de desarmes', 'total de faltas',
    // navegação / rodapé de sites de aposta
    'esports', 'tenis', 'agora', 'futebol', 'copa do mundo', 'so em pre-jogo',
    'siga-nos', 'em parceria com', 'regras dos jogos', 'declaracao de privacidade',
    'opcoes de pagamento', 'central de ajuda', 'entre em contato',
    'termos e condicoes', 'politica de privacidade', 'jogo responsavel',
    'ao vivo', 'pre-jogo', 'apostas', 'esportes', 'cassino', 'promocoes',
  ]);
  if (JUNK.has(norm)) return false;
  return true;
}

// ─── Normalização de linha de mercado ────────────────────────────────────────

/**
 * Normaliza o identificador de linha de um mercado de apostas.
 *
 * @example
 * normalizeLine('Mais de 0.5')      // → '1+'
 * normalizeLine('1+ Tackle')        // → '1+'
 * normalizeLine('Over 2.5 desarmes') // → '3+'
 *
 * Retorna string vazia se a linha não for reconhecida — a odd correspondente
 * deve ser descartada para não poluir a tabela com linhas inválidas.
 */
export function normalizeLine(rawLine: string): string {
  if (!rawLine) return '';
  const cleaned = slugify(rawLine);

  // Detecta padrões comuns em qualquer parte da string usando \b para evitar que "10" case com "1"
  // Ordem importa: "mais de" antes de número simples para evitar falso-positivo.
  const patterns: ReadonlyArray<[RegExp, string]> = [
    [/(?:mais de |over |acima de )?0[,.]?5\b/, '1+'],
    [/(?:mais de |over |acima de )?1[,.]?5\b/, '2+'],
    [/(?:mais de |over |acima de )?2[,.]?5\b/, '3+'],
    [/(?:mais de |over |acima de )?3[,.]?5\b/, '4+'],
    [/\b1\+?(?:\s*(?:tackle|desarme|abordagem|desarmes))?\b/, '1+'],
    [/\b2\+?(?:\s*(?:tackle|desarme|abordagem|desarmes))?\b/, '2+'],
    [/\b3\+?(?:\s*(?:tackle|desarme|abordagem|desarmes))?\b/, '3+'],
    [/\b4\+?(?:\s*(?:tackle|desarme|abordagem|desarmes))?\b/, '4+'],
  ];

  for (const [pattern, normalized] of patterns) {
    if (pattern.test(cleaned)) return normalized;
  }

  // Fallback: procura literais no original (case-insensitive via slugify)
  if (rawLine.includes('1+')) return '1+';
  if (rawLine.includes('2+')) return '2+';
  if (rawLine.includes('3+')) return '3+';
  if (rawLine.includes('4+')) return '4+';

  return '';
}

// ─── Extração de estágio do torneio ──────────────────────────────────────────

/**
 * Extrai a fase do torneio a partir de uma string (nome do evento ou da liga).
 *
 * ANTES: esta função estava duplicada identicamente em betfairAdapter.ts e
 * betmgmAdapter.ts. Agora mora aqui e todos importam desta fonte.
 *
 * A ordem importa: "final" vem por último porque "semifinal" e
 * "oitavas de final" também contêm a substring "final".
 */
export function extractStage(name: string): string {
  if (!name) return 'Copa do Mundo 2026';
  const lower = name.toLowerCase();

  const STAGE_MAP: ReadonlyArray<{ keywords: string[]; label: string }> = [
    { keywords: ['oitavas', 'round of 16', 'last 16'],         label: 'Oitavas de Final' },
    { keywords: ['quartas', 'quarter'],                          label: 'Quartas de Final' },
    { keywords: ['semi', 'semifi'],                              label: 'Semifinal' },
    { keywords: ['terceiro', 'third place', '3rd place'],       label: 'Disputa de 3º Lugar' },
    { keywords: ['grupos', 'group stage', 'group'],             label: 'Fase de Grupos' },
    { keywords: ['final'],                                       label: 'Final' },
  ];

  for (const { keywords, label } of STAGE_MAP) {
    if (keywords.some(kw => lower.includes(kw))) return label;
  }

  return 'Copa do Mundo 2026';
}

// ─── Normalização de nome de time ─────────────────────────────────────────────

/**
 * Normaliza o nome de um time de futebol para o formato canônico brasileiro.
 * Resolve variações como "Rep. Tcheca" vs "República Tcheca".
 */
export function normalizeTeamName(teamName: string): string {
  if (!teamName) return teamName;
  const clean = slugify(teamName);

  const TEAM_MAPPINGS: Readonly<Record<string, string>> = {
    'rep tcheca':          'República Tcheca',
    'republica tcheca':    'República Tcheca',
    'republica checa':     'República Tcheca',
    'tchequia':            'República Tcheca',
    'czech republic':      'República Tcheca',
    'czechia':             'República Tcheca',

    'coreia do sul':       'Coreia do Sul',
    'south korea':         'Coreia do Sul',
    'coreia sul':          'Coreia do Sul',

    'estados unidos':      'Estados Unidos',
    'eua':                 'Estados Unidos',
    'usa':                 'Estados Unidos',
    'united states':       'Estados Unidos',
    'us':                  'Estados Unidos',

    'marrocos':            'Marrocos',
    'morocco':             'Marrocos',

    'croacia':             'Croácia',
    'croatia':             'Croácia',

    'alemanha':            'Alemanha',
    'germany':             'Alemanha',

    'espanha':             'Espanha',
    'spain':               'Espanha',

    'suecia':              'Suécia',
    'sweden':              'Suécia',

    'equador':             'Equador',
    'ecuador':             'Equador',

    'franca':              'França',
    'france':              'França',

    'inglaterra':          'Inglaterra',
    'england':             'Inglaterra',

    'holanda':             'Holanda',
    'netherlands':         'Holanda',
    'paises baixos':       'Holanda',

    'belgica':             'Bélgica',
    'belgium':             'Bélgica',

    'japao':               'Japão',
    'japan':               'Japão',

    'uruguai':             'Uruguai',
    'uruguay':             'Uruguai',

    'colombia':            'Colômbia',
    'mexico':              'México',
    'canada':              'Canadá',
    'australia':           'Austrália',
    'austria':             'Áustria',
    'cabo verde':          'Cabo Verde',
    'uzbequistao':         'Uzbequistão',

    // RD do Congo aparece com grafias diferentes entre as casas:
    // Superbet manda "RD do Congo" (com "do"), BetMGM/Betfair mandam "RD Congo".
    // O includes('rd congo') falhava em "rd do congo" (o "do" no meio quebra),
    // então o MESMO jogo virava DUAS partidas e as odds da Superbet (desarmes)
    // ficavam separadas das demais casas. Unificamos todas as grafias aqui.
    'rd congo':            'RD Congo',
    'rd do congo':         'RD Congo',
    'r d congo':           'RD Congo',
    'dr congo':            'RD Congo',
    'congo dr':            'RD Congo',
    'republica democratica do congo': 'RD Congo',
    'democratic republic of congo':   'RD Congo',
    'republica democratica congo':    'RD Congo',
    // Nota: 'congo' sozinho NÃO é mapeado pois pode ser Congo-Brazzaville

    'suica':               'Suíça',
    'switzerland':         'Suíça',

    'catar':               'Catar',
    'qatar':               'Catar',

    'bosnia e herzegovina': 'Bósnia e Herzegovina',
    'bosnia':               'Bósnia e Herzegovina',

    'turquia':             'Turquia',
    'turkey':              'Turquia',

    'curacao':             'Curaçao',
    'paraguai':            'Paraguai',
    'paraguay':            'Paraguai',
    'escocia':             'Escócia',
    'scotland':            'Escócia',

    'servia':              'Sérvia',
    'serbia':              'Sérvia',

    'polonia':             'Polônia',
    'poland':              'Polônia',

    'dinamarca':           'Dinamarca',
    'denmark':             'Dinamarca',

    'senegal':             'Senegal',
    'nigeria':             'Nigéria',
    'gana':                'Gana',
    'ghana':               'Gana',
    'camaroes':            'Camarões',
    'cameroon':            'Camarões',
  };

  for (const [key, value] of Object.entries(TEAM_MAPPINGS)) {
    if (clean === key || (key.length >= 4 && clean.includes(key))) {
      return value;
    }
  }

  // Fallback: capitaliza as palavras
  return teamName
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

// ─── Merge de odds de múltiplas fontes ────────────────────────────────────────

export interface RawPlayerOdd {
  playerName: string;
  team: string;
  house: 'betfair' | 'betmgm' | 'superbet' | 'bet365' | 'betsson' | 'pitaco';
  line: string;
  value: number;
  market: string;
  url?: string;
}

export interface MergedPlayerOdd {
  normalizedName: string;
  displayName: string;
  team: string;
  odds: {
    house: 'betfair' | 'betmgm' | 'superbet' | 'bet365' | 'betsson' | 'pitaco';
    line: string;
    value: number;
    market: string;
    url?: string;
  }[];
}

/**
 * Merge de jogadores de múltiplas fontes em uma lista unificada.
 *
 * Usa fuzzy match para identificar duplicatas entre casas (ex: "Vinicius
 * Junior" no BetMGM == "Vinicius Jr." no Betfair).
 *
 * Para duplicatas da mesma casa+linha+mercado, mantém a maior odd.
 * O displayName é o nome mais longo encontrado entre as fontes.
 */
export function mergePlayerOdds(rawOdds: RawPlayerOdd[]): MergedPlayerOdd[] {
  const merged: MergedPlayerOdd[] = [];

  for (const raw of rawOdds) {
    if (!isLikelyPlayerName(raw.playerName)) continue; // descarta linhas de total/lixo
    const normalizedLine = normalizeLine(raw.line);
    if (!normalizedLine) continue; // descarta linhas não reconhecidas

    const idx = findPlayerIndex(
      merged.map(m => ({ name: m.normalizedName })),
      raw.playerName,
    );

    if (idx === -1) {
      // Novo jogador
      merged.push({
        normalizedName: slugify(raw.playerName),
        displayName: raw.playerName,
        team: raw.team,
        odds: [{
          house: raw.house,
          line: normalizedLine,
          value: raw.value,
          market: raw.market,
          url: raw.url,
        }],
      });
    } else {
      // Jogador existente — mescla odd
      const existing = merged[idx];

      // Prefere o nome mais longo como displayName
      if (raw.playerName.length > existing.displayName.length) {
        existing.displayName = raw.playerName;
      }

      // Preenche o time se ainda estiver vazio (ex: vindo da Superbet sem time)
      if (!existing.team && raw.team) {
        existing.team = raw.team;
      }

      // Evita duplicar a mesma casa+linha+mercado — mantém a maior odd
      const existingOdd = existing.odds.find(
        o => o.house === raw.house && o.line === normalizedLine && o.market === raw.market,
      );

      if (existingOdd) {
        existingOdd.value = raw.value;
        if (raw.url) existingOdd.url = raw.url;
      } else {
        existing.odds.push({
          house: raw.house,
          line: normalizedLine,
          value: raw.value,
          market: raw.market,
          url: raw.url,
        });
      }
    }
  }

  return merged;
}
