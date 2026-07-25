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
// Busca de atleta
// ---------------------------------------------------------------------------

const athleteCache = new Map<string, Athlete>();

function clubTokens(clubName?: string): string[] {
  return tokens(clubName || '').filter((t) => t.length >= 3 && !['fc', 'sc', 'cf', 'ac', 'ec', 'cr', 'se'].includes(t));
}

/** Overlap de tokens entre time pedido e clube do atleta (ex.: "Corinthians" ⊆ "SC Corinthians Paulista"). */
function clubTeamOverlap(teamNorm: string, clubName?: string): number {
  if (!teamNorm || !clubName) return 0;
  const clubNorm = normName(clubName);
  if (!clubNorm) return 0;
  if (clubNorm === teamNorm) return 3;
  if (clubNorm.includes(teamNorm) || teamNorm.includes(clubNorm)) return 2;
  const tTok = tokens(teamNorm).filter((t) => t.length >= 3);
  const cTok = clubTokens(clubName);
  if (!tTok.length || !cTok.length) return 0;
  const cSet = new Set(cTok);
  let hit = 0;
  for (const t of tTok) if (cSet.has(t)) hit++;
  return hit > 0 ? 1 : 0;
}

function scoreAthlete(
  a: Athlete,
  qTokens: string[],
  wantCountryId: number | null,
  teamNorm?: string,
): number {
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

  // Time/clube: desempate forte — evita foto de homônimo de outro clube
  if (teamNorm) {
    const clubHit = clubTeamOverlap(teamNorm, a.clubName);
    if (clubHit >= 2) score += 100;
    else if (clubHit === 1) score += 70;
    else if (a.clubName) score -= 55; // clube conhecido e diferente → penaliza
  }

  // popularidade só como desempate fraco (NÃO vencer match de clube)
  const pop = typeof a.popularityRank === 'number' ? a.popularityRank : 0;
  score += Math.min(pop, 5000) / 2000; // até +2.5
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
  // v2: cache inclui team com scoring de clube (evita servir foto errada antiga)
  const cacheKey = 'v2|' + normName(name) + '|' + normName(team || '');
  if (athleteCache.has(cacheKey)) return athleteCache.get(cacheKey) ?? null;

  const wantCountryId = null; // Não usamos mais resolveCountryId

  const qTokens = tokens(name);
  const teamNorm = team ? normName(team) : '';

  // Consultas progressivamente mais simples (nome completo, primeiro+último,
  // só sobrenome). NÃO busca só pelo primeiro nome curto (gera homônimos).
  const queries: string[] = [name];
  if (teamNorm) {
    // "Nome + Time" melhora o ranking da API 365scores
    queries.push(`${name} ${team}`);
  }
  if (qTokens.length >= 2) {
    queries.push(qTokens[0] + ' ' + qTokens[qTokens.length - 1]);
    queries.push(qTokens[qTokens.length - 1]);
    // só primeiro nome se for razoavelmente específico
    if (qTokens[0].length >= 5) queries.push(qTokens[0]);
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
      const sc = scoreAthlete(a, qTokens, wantCountryId, teamNorm || undefined);
      if (sc > bestScore) {
        bestScore = sc;
        best = a;
      }
    }
    // Candidato forte com nome exato OU com match de clube
    if (best && bestScore >= 140) break;
    if (best && teamNorm && bestScore >= 100 && clubTeamOverlap(teamNorm, best.clubName) >= 1) break;
  }

  // Exige relevância mínima; com time informado, rejeita homônimo sem clube
  if (best && bestScore < 40) best = null;
  if (best && teamNorm && clubTeamOverlap(teamNorm, best.clubName) === 0) {
    // Nome mono-token (apelido) sem clube → alto risco de foto errada
    if (qTokens.length <= 1 || bestScore < 90) best = null;
  }

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
