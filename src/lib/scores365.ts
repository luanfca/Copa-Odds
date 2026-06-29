// Resolução de fotos de jogadores via 365scores.
// O Sofascore passou a ser bloqueado por Cloudflare (403 challenge), inclusive
// a partir do IP residencial do usuário, então migramos a feature de fotos para
// o 365scores, que responde normalmente no servidor.

import { normalizeName } from './normalize';

// Alias para backward-compat interno — remove a implementação local duplicada.
const normName = normalizeName;

function tokens(s: string): string[] {
  return normName(s).split(' ').filter(Boolean);
}

const PROTO = 'https://';
const WEBWS_HOST = 'webws.365scores.com';
const IMG_HOST = 'imagecache.365scores.com';

// Parâmetros padrão da API web do 365scores.
const APP_TYPE = '5';
const LANG_ID = '31'; // pt-BR
const TZ = 'America/Sao_Paulo';
const USER_COUNTRY = '21'; // Brasil

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface Athlete {
  id: number;
  name: string;
  shortName?: string;
  nameForURL?: string;
  sportId?: number;
  clubId?: number;
  clubName?: string;
  nationalityId?: number;
  imageVersion?: number;
  popularityRank?: number;
}

export interface PlayerImage {
  buf: ArrayBuffer;
  contentType: string;
}

// ---------------------------------------------------------------------------
// Helpers de texto
// ---------------------------------------------------------------------------



// Detecta linhas que NÃO são nomes de jogador (ex.: "Menos de 27.5",
// "Mais de 2", "Over 1.5", números soltos). Evita buscar foto pra elas.
export function isNonPlayerRow(name: string): boolean {
  const n = (name || '').trim();
  if (!n) return true;
  if (/^(menos|mais|under|over|acima|abaixo)\b/i.test(n)) return true;
  if (/^[\d.,+\-\s]+$/.test(n)) return true; // só números/linha decimal
  return false;
}

// ---------------------------------------------------------------------------
// Fetch da API web (com 1 retry para tolerar falhas transitórias)
// ---------------------------------------------------------------------------

function jsonHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  };
}

async function webwsJson(path: string): Promise<any | null> {
  const url = PROTO + WEBWS_HOST + path;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: jsonHeaders() });
      if (res.ok) return await res.json();
    } catch {
      // tenta novamente
    }
  }
  return null;
}

function searchPath(query: string): string {
  const qs = new URLSearchParams({
    appTypeId: APP_TYPE,
    langId: LANG_ID,
    timezoneName: TZ,
    userCountryId: USER_COUNTRY,
    filter: 'all',
    query,
  });
  return '/web/search/?' + qs.toString();
}

// ---------------------------------------------------------------------------
// Resolução de país (para desambiguar por seleção)
// ---------------------------------------------------------------------------

const countryIdCache = new Map<string, number>();

export async function resolveCountryId(teamName: string): Promise<number | null> {
  const key = normName(teamName);
  if (!key) return null;
  if (countryIdCache.has(key)) return countryIdCache.get(key) ?? null;

  const data = await webwsJson(searchPath(teamName));
  const countries: any[] = (data && data.countries) || [];
  let best = countries.find((c) => normName(c.name) === key);
  if (!best) best = countries.find((c) => Array.isArray(c.sportTypes) && c.sportTypes.includes(1));
  if (!best && countries.length) best = countries[0];

  const id = best && typeof best.id === 'number' ? best.id : null;
  // Só cacheia sucesso: evita gravar falha transitória pra sempre.
  if (id != null) countryIdCache.set(key, id);
  return id;
}

// ---------------------------------------------------------------------------
// Busca de atleta
// ---------------------------------------------------------------------------

const athleteCache = new Map<string, Athlete>();

function scoreAthlete(a: Athlete, qTokens: string[], wantCountryId: number | null): number {
  const aTokens = tokens(a.name);
  const aSet = new Set(aTokens);
  let overlap = 0;
  for (const t of qTokens) if (aSet.has(t)) overlap++;

  const exact = normName(a.name) === qTokens.join(' ');
  let score = 0;
  score += overlap * 40;
  if (exact) score += 120;
  // sobrenome igual
  if (
    qTokens.length &&
    aTokens.length &&
    qTokens[qTokens.length - 1] === aTokens[aTokens.length - 1]
  ) {
    score += 25;
  }
  // mesma seleção
  if (wantCountryId != null && a.nationalityId === wantCountryId) score += 60;
  // popularidade como desempate (craques de seleção têm rank alto)
  const pop = typeof a.popularityRank === 'number' ? a.popularityRank : 0;
  score += Math.min(pop, 20000) / 1000; // até +20
  // só futebol
  if (a.sportId && a.sportId !== 1) score -= 100;
  return score;
}

async function searchOnce(query: string): Promise<Athlete[]> {
  const data = await webwsJson(searchPath(query));
  const arr: any[] = (data && data.athletes) || [];
  return arr.filter((a) => a && typeof a.id === 'number') as Athlete[];
}

export async function searchAthlete(name: string, team?: string): Promise<Athlete | null> {
  if (isNonPlayerRow(name)) return null;
  const cacheKey = normName(name) + '|' + normName(team || '');
  if (athleteCache.has(cacheKey)) return athleteCache.get(cacheKey) ?? null;

  const wantCountryId = team ? await resolveCountryId(team) : null;
  const qTokens = tokens(name);

  // Consultas progressivamente mais simples (nome completo, primeiro+último,
  // só sobrenome e só primeiro nome).
  const queries: string[] = [name];
  if (qTokens.length >= 2) {
    queries.push(qTokens[0] + ' ' + qTokens[qTokens.length - 1]);
    queries.push(qTokens[qTokens.length - 1]);
    queries.push(qTokens[0]);
  }

  let best: Athlete | null = null;
  let bestScore = -Infinity;
  const seen = new Set<string>();

  for (const q of queries) {
    const nq = normName(q);
    if (!nq || seen.has(nq)) continue;
    seen.add(nq);

    const athletes = await searchOnce(q);
    for (const a of athletes) {
      const sc = scoreAthlete(a, qTokens, wantCountryId);
      if (sc > bestScore) {
        bestScore = sc;
        best = a;
      }
    }
    if (best && bestScore >= 100) break; // candidato forte já encontrado
  }

  if (best && bestScore < 40) best = null; // exige relevância mínima

  // Só cacheia sucesso: se a busca falhou agora, deixa tentar de novo depois
  // (antes, um vazio transitório ficava cacheado e a foto sumia pra sempre).
  if (best) athleteCache.set(cacheKey, best);
  return best;
}

// ---------------------------------------------------------------------------
// Imagem
// ---------------------------------------------------------------------------

export function getAthleteImageUrl(id: number, imageVersion?: number, size = 80): string {
  const v = imageVersion && imageVersion > 0 ? imageVersion : 1;
  const transform =
    'f_png,w_' + size + ',h_' + size + ',c_limit,q_auto:eco,dpr_2,' +
    'd_Athletes:default.png,r_max,c_thumb,g_face,z_0.65';
  return PROTO + IMG_HOST + '/image/upload/' + transform + '/v' + v + '/Athletes/' + id;
}

export async function getAthleteImage(
  id: number,
  imageVersion?: number,
  size = 80,
): Promise<PlayerImage | null> {
  const url = getAthleteImageUrl(id, imageVersion, size);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'image/*' } });
      if (!res.ok) continue;
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 200) return null; // descarta placeholder vazio
      const contentType = res.headers.get('content-type') || 'image/png';
      return { buf, contentType };
    } catch {
      // tenta novamente
    }
  }
  return null;
}

// Conveniência: resolve o atleta e baixa a foto em uma chamada.
export async function getPhotoByName(
  name: string,
  team?: string,
  size = 80,
): Promise<PlayerImage | null> {
  const a = await searchAthlete(name, team);
  if (!a) return null;
  return getAthleteImage(a.id, a.imageVersion, size);
}
