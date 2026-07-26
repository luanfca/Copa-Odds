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

  // Substring match: nome menor contido no maior.
  // Aceita diferença de até 50 caracteres para nomes brasileiros completos
  // (ex: "Alexsander" em "Alexsander Cristhian Gomes da Costa" = 27 chars de diff).
  const shorter = a.length <= b.length ? a : b;
  const longer  = a.length <= b.length ? b : a;
  if (shorter.length >= 4 && longer.endsWith(shorter) && longer.length - shorter.length <= 50) {
    return true;
  }
  if (shorter.length >= 3 && longer.includes(shorter) && longer.length - shorter.length <= 50) {
    return true;
  }

  // Word-ordered matching: verifica se as palavras do nome menor aparecem
  // EM ORDEM dentro do nome maior (não necessariamente contíguas).
  // Resolve casos como "Everton Ribeiro" vs "Everton Augusto de Barros Ribeiro"
  // e "Michel Araujo" vs "Michel Daryl Araujo Villar".
  if (shorter.length >= 3) {
    const shortWords = shorter.split(/\s+/).filter(w => w.length >= 2);
    if (shortWords.length >= 2) {
      let searchPos = 0;
      let allFoundInOrder = true;
      for (const word of shortWords) {
        const found = longer.indexOf(word, searchPos);
        if (found === -1) { allFoundInOrder = false; break; }
        searchPos = found + word.length;
      }
      if (allFoundInOrder) {
        return true;
      }
    }
  }

  // Compara ordenando as palavras (resolve "Paik Seung-ho" vs "Seung Ho Paik")
  const sortWords = (s: string) => s.split(/\s+/).sort().join(' ');
  if (sortWords(a) === sortWords(b)) return true;

  // Inicial única de um lado (ex: "R. Sosa" → tokens ["r","sosa"])
  // vs nome completo do outro ("Ramon Sosa" → tokens ["ramon","sosa"]).
  // NÃO usa "mesma inicial + sobrenome" com nomes completos — isso fundia
  // "João Silva" com "José Silva" e "Bruno Lopes" com "Breno Lopes".
  const partsA = a.split(/\s+/);
  const partsB = b.split(/\s+/);
  if (partsA.length >= 2 && partsB.length >= 2) {
    const aLast = partsA[partsA.length - 1];
    const bLast = partsB[partsB.length - 1];
    if (aLast === bLast && aLast.length >= 3) {
      // Só aceita se PELO MENOS um lado tem inicial de 1 caractere
      if ((partsA[0].length === 1 || partsB[0].length === 1) &&
          partsA[0][0] === partsB[0][0]) {
        return true;
      }
      // "V. Paulista" (2 tokens, 1º inicial) vs nome com 3+ tokens e mesmo sobrenome
      if (partsA.length === 2 && partsA[0].length === 1 && partsB.length >= 3 &&
          partsA[0][0] === partsB[0][0]) {
        return true;
      }
      if (partsB.length === 2 && partsB[0].length === 1 && partsA.length >= 3 &&
          partsB[0][0] === partsA[0][0]) {
        return true;
      }
    }
  }

  // Mesmo sobrenome + primeiro nome multi-letra: exige primeiro nome bem similar.
  // Evita "Bruno Lopes" ≈ "Breno Lopes" via Levenshtein do nome completo.
  if (partsA.length >= 2 && partsB.length >= 2) {
    const aLast = partsA[partsA.length - 1];
    const bLast = partsB[partsB.length - 1];
    if (aLast === bLast && partsA[0].length > 1 && partsB[0].length > 1) {
      const fDist = levenshtein.get(partsA[0], partsB[0]);
      const fMax = Math.max(partsA[0].length, partsB[0].length);
      const firstSim = 1 - fDist / fMax;
      if (firstSim < 0.9) return false;
    }
  }

  // Fuzzy match: distância de Levenshtein relativa ao tamanho da string maior.
  // Threshold 0.85 (antes 0.80) evita fundir nomes parecidos mas distintos.
  const dist = levenshtein.get(a, b);
  const maxLen = Math.max(a.length, b.length);
  const similarity = 1 - dist / maxLen;

  if (maxLen >= 6 && similarity >= 0.85) return true;
  if (maxLen >= 5 && maxLen < 6 && similarity >= 0.80) return true;
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
  // Lixo típico da Betfair/DOM: "Empate/Empate", "Intervalo / Final", "Time / Time"
  if (/[\/|]/.test(t)) return false;
  if (/\bvs\b/i.test(t)) return false;
  // normaliza p/ comparar com a lista de lixo (minúsculas, sem acento)
  const norm = t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // "Equipe A/B", "Time da Casa", labels genéricos da Betfair (NÃO são jogadores)
  if (/^equipe\b/.test(norm) || /^time\b/.test(norm) || /^clube\b/.test(norm)) return false;
  if (/\bequipe\s*[ab]\b/.test(norm)) return false;
  const JUNK = new Set([
    // termos de mercado
    'sim', 'nao', 'empate', 'ambos', 'ambas', 'total', 'totais', 'par', 'impar',
    'desarmes', 'desarme', 'faltas', 'falta', 'tackles', 'tackle', 'mais', 'menos',
    'total de desarmes', 'total de faltas',
    'intervalo', 'final', 'placar', 'resultado', 'dupla chance', 'ambas marcam',
    'casa', 'fora', 'mandante', 'visitante', 'jogador', 'time', 'selecao',
    'equipe', 'equipe a', 'equipe b', 'team a', 'team b', 'home', 'away',
    // navegação / rodapé de sites de aposta
    'esports', 'tenis', 'agora', 'futebol', 'copa do mundo', 'so em pre-jogo',
    'siga-nos', 'em parceria com', 'regras dos jogos', 'declaracao de privacidade',
    'opcoes de pagamento', 'central de ajuda', 'entre em contato',
    'termos e condicoes', 'politica de privacidade', 'jogo responsavel',
    'ao vivo', 'pre-jogo', 'apostas', 'esportes', 'cassino', 'promocoes',
    // times (DOM da Betfair às vezes lista o clube no lugar do jogador)
    'bahia', 'flamengo', 'palmeiras', 'corinthians', 'santos', 'sao paulo',
    'internacional', 'cruzeiro', 'cruzeiro mg', 'atletico mg', 'atletico-mg',
    'botafogo', 'botafogo fr', 'gremio', 'vasco', 'fluminense', 'coritiba',
    'athletico-pr', 'athletico pr', 'chapecoense', 'remo', 'se palmeiras',
    'ec vitoria salvador', 'vitoria',
  ]);
  if (JUNK.has(norm)) return false;
  // "intervalo final", "empate empate" etc.
  if (/\b(empate|intervalo|placar|resultado|dupla chance)\b/.test(norm)) return false;
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

  // NÃO usa slugify aqui: ele remove o ponto decimal e "10.5" vira "105",
  // que casava com o padrão de 0.5 e virava "1+".
  const lower = rawLine
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Under / "menos de" NÃO são mercados over — descartar (evita misturar com 2+/3+).
  const isUnder =
    /\b(menos de|under|abaixo de|below)\b/.test(lower) ||
    (/\b(menos|under|abaixo)\b/.test(lower) && !/\b(mais de|over|acima de|ou mais|\d+\+)\b/.test(lower));
  if (isUnder) return '';

  // Ranges da Betfair ("1+ até 3+", "4+ a 6+", "1+ e 2+") NÃO são uma linha única.
  // Se casar o 1º "N+" vira 1+ e some a coluna do meio (2+) no extract BFF.
  if (/\d\s*\+\s*(até|ate|a|e|-)\s*\d/.test(lower)) return '';

  // "N+" explícito (1+, 2+, 10+…) — só label isolado / com mercado depois
  const plusMatch = lower.match(/\b(\d{1,2})\s*\+/);
  if (plusMatch) {
    const n = parseInt(plusMatch[1], 10);
    if (n >= 1 && n <= 20) return `${n}+`;
  }

  // "N ou mais" / "dá N ou mais" (Betfair: "Jogador dá 2 ou mais chutes no gol")
  const ouMais = lower.match(/\b(\d{1,2})\s+ou\s+mais\b/);
  if (ouMais) {
    const n = parseInt(ouMais[1], 10);
    if (n >= 1 && n <= 20) return `${n}+`;
  }

  // "Mais de / Over / Acima de N.5" → (N+1)+
  // Exige prefixo OU número com decimal para não confundir com lixo.
  const overHalf = lower.match(/(?:mais de|over|acima de)\s*(\d{1,2})[.,]5\b/);
  if (overHalf) {
    const n = parseInt(overHalf[1], 10);
    if (n >= 0 && n <= 19) return `${n + 1}+`;
  }

  // Número decimal solto "N.5" sem under (algumas casas só mandam "1.5")
  const bareHalf = lower.match(/(?:^|[^\d])(\d{1,2})[.,]5(?:\b|$)/);
  if (bareHalf) {
    const n = parseInt(bareHalf[1], 10);
    if (n >= 0 && n <= 19) return `${n + 1}+`;
  }

  // "N+ Tackle/Desarme/Chutes"
  const plusWord = lower.match(/\b(\d{1,2})\s*\+?\s*(?:tackle|desarme|abordagem|desarmes|chutes|shots|faltas|falta)\b/);
  if (plusWord) {
    const n = parseInt(plusWord[1], 10);
    if (n >= 1 && n <= 20) return `${n}+`;
  }

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
  if (!name) return '';
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

  return '';
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
    'nigeria':             'Nigéria',    'gana':               'Gana',
    'ghana':               'Gana',
    'camaroes':            'Camarões',
    'cameroon':            'Camarões',

    // MLS (ANTES dos clubes brasileiros para evitar que 'sport' case com 'sporting')
    'sporting kansas city':'Sporting Kansas City',
    'sporting kc':        'Sporting Kansas City',

    // Clubes brasileiros — com e sem abreviação de estado
    // ORDEM IMPORTA: nomes com estado primeiro para evitar 'vasco' → 'Vasco da Gama'
    // antes de 'vasco rj' ser testado (ambos dariam o mesmo resultado, mas é seguro)
    'botafogo rj':         'Botafogo',
    'flamengo rj':         'Flamengo',
    'fluminense rj':       'Fluminense',
    'vasco da gama rj':    'Vasco da Gama',
    'vasco da gama':       'Vasco da Gama',
    'vasco da gama saf':   'Vasco da Gama',
    'vasco saf':           'Vasco da Gama',
    'vasco rj':            'Vasco da Gama',
    'vasco':               'Vasco da Gama',
    'corinthians sp':      'Corinthians',
    'corinthians':         'Corinthians',
    'palmeiras sp':        'Palmeiras',
    'palmeiras':           'Palmeiras',
    'sao paulo sp':        'São Paulo',
    'sao paulo':           'São Paulo',
    'santos sp':           'Santos',
    'internacional rs':    'Internacional',
    'internacional':       'Internacional',
    'gremio rs':           'Grêmio',
    'gremio':              'Grêmio',
    'atletico mg':         'Atlético Mineiro',
    'atletico':            'Atlético Mineiro',
    'cruzeiro mg':         'Cruzeiro',
    'cruzeiro':            'Cruzeiro',
    'america mg':          'América-MG',
    'athletico pr':        'Athletico Paranaense',
    'athletico':           'Athletico Paranaense',
    'coritiba pr':         'Coritiba',
    'coritiba':            'Coritiba',
    'coritiba saf':        'Coritiba',
    'parana pr':           'Paraná',
    'bahia ba':            'Bahia',
    'bahia':               'Bahia',
    'vitoria ba':          'Vitória',
    'vitoria':             'Vitória',
    'fortaleza ce':        'Fortaleza',
    'fortaleza':           'Fortaleza',
    'ceara ce':            'Ceará',
    'ceara':               'Ceará',
    'sport pe':            'Sport Recife',
    'sport':               'Sport Recife',
    'nautico pe':          'Náutico',
    'goias go':            'Goiás',
    'goias':               'Goiás',
    'cuiaba mt':           'Cuiabá',
    'cuiaba':              'Cuiabá',
    'chapecoense sc':      'Chapecoense',
    'chapecoense':         'Chapecoense',
    'remo':                'Remo',
    'avai sc':             'Avaí',
    'avai':                'Avaí',
    'criciuma sc':         'Criciúma',
    'criciuma':            'Criciúma',
    'brusque sc':          'Brusque',
    'brusque':             'Brusque',
    'juventude rs':        'Juventude',
    'juventude':           'Juventude',
    'mirassol':            'Mirassol',
    'red bull bragantino': 'Red Bull Bragantino',
    'bragantino':          'Red Bull Bragantino',

    // MLS
    'inter miami':         'Inter Miami',
    'inter miami c':       'Inter Miami',
    'miami':               'Inter Miami',
    'la galaxy':           'LA Galaxy',
    'los angeles galaxy': 'LA Galaxy',
    'los angeles gala':   'LA Galaxy',
    'galaxy':              'LA Galaxy',
    'lafc':                'Los Angeles FC',
    'la fc':               'Los Angeles FC',
    'los angeles fc':      'Los Angeles FC',
    'nycfc':               'New York City FC',
    'new york city fc':    'New York City FC',
    'new york red bulls': 'New York Red Bulls',
    'red bulls':           'New York Red Bulls',
    'atlanta united':      'Atlanta United',
    'atlanta':             'Atlanta United',
    'seattle sounders':    'Seattle Sounders',
    'sounders':            'Seattle Sounders',
    'portland timbers':    'Portland Timbers',
    'timbers':             'Portland Timbers',
    'columbus crew':       'Columbus Crew',
    'crew':                'Columbus Crew',
    'fc cincinnati':       'FC Cincinnati',
    'cincinnati':          'FC Cincinnati',
    'orlando city':        'Orlando City',
    'orlando':             'Orlando City',
    'nashville sc':        'Nashville SC',
    'nashville':           'Nashville SC',
    'austin fc':           'Austin FC',
    'austin':              'Austin FC',
    'fc dallas':           'FC Dallas',
    'dallas':              'FC Dallas',
    'houston dynamo':      'Houston Dynamo',
    'dynamo':              'Houston Dynamo',
    'chicago fire':        'Chicago Fire',
    'chicago':             'Chicago Fire',
    'toronto fc':          'Toronto FC',
    'toronto':             'Toronto FC',
    'vancouver whitecaps': 'Vancouver Whitecaps',
    'whitecaps':           'Vancouver Whitecaps',
    'cf montreal':         'CF Montréal',
    'montreal':            'CF Montréal',
    'colorado rapids':     'Colorado Rapids',
    'rapids':              'Colorado Rapids',
    'real salt lake':      'Real Salt Lake',
    'salt lake':           'Real Salt Lake',
    'rsl':                 'Real Salt Lake',
    'kansas city':         'Sporting Kansas City',
    'skc':                 'Sporting Kansas City',
    'minnesota united':    'Minnesota United',
    'minnesota':           'Minnesota United',
    'st louis city sc':    'St. Louis City SC',
    'st louis':            'St. Louis City SC',
    'saint louis':         'St. Louis City SC',
    'san jose earthquakes':'San Jose Earthquakes',
    'earthquakes':         'San Jose Earthquakes',
    'philadelphia union':  'Philadelphia Union',
    'philadelphia':        'Philadelphia Union',
    'dc united':           'D.C. United',
    'dc':                  'D.C. United',
    'charlotte fc':        'Charlotte FC',
    'charlotte':           'Charlotte FC',
    'new england revolution':'New England Revolution',
    'new england':         'New England Revolution',
    'revolution':          'New England Revolution',

    // Variações crus do Pitaco (sem estado, abreviações)
    'new york rb':          'New York Red Bulls',
    'ny red bulls':         'New York Red Bulls',
    'new york city':        'New York City FC',
    'san diego':            'San Diego',
    'san diego fc':         'San Diego',
    'san diego f c':        'San Diego',

    // MLS — variações de nomes entre casas (NÃO duplicadas acima)
    'sao luis city sc':   'St. Louis City SC',
    'sao luis city':      'St. Louis City SC',
    'saint louis city sc':'St. Louis City SC',
    'st louis city':      'St. Louis City SC',
    'atlanta united fc':  'Atlanta United',
    'atlanta atlanta':    'Atlanta United',
    'seattle':            'Seattle Sounders',
    'portland':           'Portland Timbers',
    'columbus':           'Columbus Crew',
    'san jose':           'San Jose Earthquakes',
  };

  for (const [key, value] of Object.entries(TEAM_MAPPINGS)) {
    if (clean === key) {
      return value;
    }
    // includes() só é seguro quando a chave é um termo único que não aparece em outros nomes
    // Ex: 'corinthians' não aparece em 'corinthians sp' porque já é mapeado exatamente acima
    // Mas 'sport' APARECE em 'sporting kansas city', então NÃO usamos includes para chaves curtas
    if (key.length >= 6 && clean.includes(key)) {
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
    if (!raw.market || !String(raw.market).trim()) continue; // mercado desconhecido
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

      // Evita duplicar a mesma casa+linha+mercado.
      // Betfair envia odds via API (BFF GraphQL) E via extração DOM.
      // A API pode ter odds diferentes do DOM renderizado (ex: 2.00 vs 1.53).
      // O DOM é processado DEPOIS da API no fluxo, então a ordem de chegada
      // é: 1º API (valor errado), 2º DOM (valor correto).
      // Por isso, a regra é: o ÚLTIMO a chegar vence, NÃO o maior valor.
      // (Se fôssemos manter o maior, a API errada com valor maior sobrescreveria
      //  o DOM correto com valor menor.)
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

  // Post-merge: fill empty team by matching against players with a team
  for (const p of merged) {
    if (p.team) continue;
    for (const other of merged) {
      if (!other.team || other === p) continue;
      if (isSamePlayer(p.displayName, other.displayName)) {
        p.team = other.team;
        break;
      }
    }
  }

  // Post-merge Betfair/over: se 3+ >= 4+ no mesmo mercado, descarta 3+ (mapeamento sujo)
  for (const p of merged) {
    const byMktLine = new Map<string, { idx: number; value: number }>();
    p.odds.forEach((o, idx) => {
      byMktLine.set(`${o.house}|${o.market}|${o.line}`, { idx, value: o.value });
    });
    const toRemove = new Set<number>();
    for (const o of p.odds) {
      if (o.line !== '3+') continue;
      const four = byMktLine.get(`${o.house}|${o.market}|4+`);
      if (four && !(four.value > o.value + 1e-9)) {
        const three = byMktLine.get(`${o.house}|${o.market}|3+`);
        if (three) toRemove.add(three.idx);
      }
    }
    if (toRemove.size > 0) {
      p.odds = p.odds.filter((_, idx) => !toRemove.has(idx));
    }
  }

  return merged;
}
