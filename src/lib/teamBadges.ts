/**
 * Mapa de escudos oficiais de clubes.
 *
 * Fonte: Wikimedia Commons (Wikipedia).
 * Cada escudo é servido diretamente via URL pública da Wikipedia.
 *
 * Para descobrir novos escudos:
 *   const res = await fetch(
 *     'https://en.wikipedia.org/w/api.php?action=query&titles=PAGE_TITLE' +
 *     '&prop=pageimages&format=json&pithumbsize=128&formatversion=2'
 *   );
 *   const json = await res.json();
 *   json.query.pages[0].thumbnail.source // ← URL do escudo
 *
 * Clubes SEM escudo conhecido usam fallback de iniciais coloridas (Flag.tsx).
 */

/**
 * Mapa: código 3-letras do clube → URL do escudo no Wikimedia Commons.
 * Usamos o parâmetro `type=image/svg` para obter versões SVG de alta qualidade
 * convertidas para PNG via o thumbnailer da Wikipedia (ex: 250px de largura).
 * A URL funciona em qualquer contexto (<img>, CSS background, etc.).
 */
const CLUB_BADGES: Record<string, string> = {
  // ─── Clubes Brasileiros ──────────────────────────────────────────
  BOT: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/Botafogo_de_Futebol_e_Regatas_logo.svg/250px-Botafogo_de_Futebol_e_Regatas_logo.svg.png',
  FLA: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/96/Clube_de_Regatas_do_Flamengo_logo.svg/250px-Clube_de_Regatas_do_Flamengo_logo.svg.png',
  FLU: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/Fluminense_Football_Club.svg/250px-Fluminense_Football_Club.svg.png',
  PAL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/60/SE_Palmeiras_2025_crest.png/250px-SE_Palmeiras_2025_crest.png',
  SAO: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f4/S%C3%A3o_Paulo_Futebol_Clube_logo_%282022%29.svg/250px-S%C3%A3o_Paulo_Futebol_Clube_logo_%282022%29.svg.png',
  SAN: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0e/Santos_Futebol_Clube_logo_%28with_stars_and_crown%29.png/250px-Santos_Futebol_Clube_logo_%28with_stars_and_crown%29.png',
  INT: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Sport_Club_Internacional_logo.svg/250px-Sport_Club_Internacional_logo.svg.png',
  GRE: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Gremio_logo.svg/250px-Gremio_logo.svg.png',
  CAM: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Logo_of_Clube_Atl%C3%A9tico_Mineiro.svg/250px-Logo_of_Clube_Atl%C3%A9tico_Mineiro.svg.png',
  CRU: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Cruzeiro_Esporte_Clube_%28logo%29.svg/250px-Cruzeiro_Esporte_Clube_%28logo%29.svg.png',
  BAH: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1e/Logo_of_Esporte_Clube_Bahia_%282004%29.svg/250px-Logo_of_Esporte_Clube_Bahia_%282004%29.svg.png',
  CAP: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/43/Athletico_Paranaense_%28Logo_2019%29.svg/250px-Athletico_Paranaense_%28Logo_2019%29.svg.png',
  CTB: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bd/Coritiba_Foot_Ball_Club_logo.svg/250px-Coritiba_Foot_Ball_Club_logo.svg.png',
  CEA: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/38/Cear%C3%A1_Sporting_Club_logo.svg/250px-Cear%C3%A1_Sporting_Club_logo.svg.png',
  FOR: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6d/Fortaleza_Esporte_Clube_logo.png/250px-Fortaleza_Esporte_Clube_logo.png',
  CUI: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Cuiab%C3%A1_EC_crest.png/250px-Cuiab%C3%A1_EC_crest.png',
  VIT: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/15/Esporte_Clube_Vit%C3%B3ria_%282024%29.svg/250px-Esporte_Clube_Vit%C3%B3ria_%282024%29.svg.png',
  GOI: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Goi%C3%A1s_Esporte_Clube_logo.svg/250px-Goi%C3%A1s_Esporte_Clube_logo.svg.png',
  AMM: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6f/Escudo_oficial_do_Am%C3%A9rica_Futebol_Clube.svg/250px-Escudo_oficial_do_Am%C3%A9rica_Futebol_Clube.svg.png',
  JUV: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/bf/Juventude_crest.png/250px-Juventude_crest.png',
  MIR: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5b/Mirassol_FC_logo.png/250px-Mirassol_FC_logo.png',
  CRI: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/9b/Crici%C3%BAma_EC_2025_crest.svg/250px-Crici%C3%BAma_EC_2025_crest.svg.png',
  AVA: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8c/Ava%C3%AD_Futebol_Clube_logo.svg/250px-Ava%C3%AD_Futebol_Clube_logo.svg.png',
  BRU: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b8/Brusque_Futebol_Clube_logo_%282023%29.png/250px-Brusque_Futebol_Clube_logo_%282023%29.png',
  LON: 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/67/Londrina_EC_logo.svg/250px-Londrina_EC_logo.svg.png',
  CRB: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/CRB_logo.svg/250px-CRB_logo.svg.png',
  NOV: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/13/Gr%C3%AAmio_Novorizontino_logo.png/250px-Gr%C3%AAmio_Novorizontino_logo.png',
  SBE: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/S%C3%A3o_Bernardo_FC_logo.png/250px-S%C3%A3o_Bernardo_FC_logo.png',

  // ─── MLS ─────────────────────────────────────────────────────────
  LAG: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/70/Los_Angeles_Galaxy_logo.svg/250px-Los_Angeles_Galaxy_logo.svg.png',
  LAF: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/86/Los_Angeles_Football_Club.svg/250px-Los_Angeles_Football_Club.svg.png',
  NYC: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/eb/Logo_New_York_City_FC_2025.svg/250px-Logo_New_York_City_FC_2025.svg.png',
  CHI: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/03/Chicago_Fire_logo%2C_2021.svg/250px-Chicago_Fire_logo%2C_2021.svg.png',
  POR: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/35/Portland_Timbers_logo.svg/250px-Portland_Timbers_logo.svg.png',
  CLB: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Columbus_Crew_logo_2021.svg/250px-Columbus_Crew_logo_2021.svg.png',
  STL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Logo_of_St._Louis_City_SC.svg/250px-Logo_of_St._Louis_City_SC.svg.png',
  SKC: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/Sporting_Kansas_City_logo.svg/250px-Sporting_Kansas_City_logo.svg.png',

  // ─── NOVOS escudos ────────────────────────────────────────────────
  CHA: 'https://commons.wikimedia.org/wiki/Special:FilePath/Logo%20Associa%C3%A7%C3%A3o%20Chapecoense%20de%20Futebol.svg?width=250',
  SEA: 'https://commons.wikimedia.org/wiki/Special:FilePath/MLS%20crest%20logo%20RGB%20-%20Seattle%20Sounders%20FC%202024.svg?width=250',
  ORL: 'https://commons.wikimedia.org/wiki/Special:FilePath/MLS%20crest%20logo%20RGB%20-%20Orlando%20City%20SC.svg?width=250',
  CIN: 'https://commons.wikimedia.org/wiki/Special:FilePath/FC%20Cincinnati%20Foundation%20logo%20black.svg?width=250',
  NYR: 'https://commons.wikimedia.org/wiki/Special:FilePath/MLS%20crest%20logo%20RGB%20-%20New%20York%20Red%20Bulls.svg?width=250',
  PHI: 'https://commons.wikimedia.org/wiki/Special:FilePath/MLS%20crest%20logo%20RGB%20-%20Philadelphia%20Union%202018.svg?width=250',
  SPT: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Sport_Recife_logo.svg/250px-Sport_Recife_logo.svg.png',
  VAN: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7c/Vancouver_Whitecaps_logo.svg/250px-Vancouver_Whitecaps_logo.svg.png',
  NER: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/Logo_of_New_England_Revolution_%282021%29.svg/250px-Logo_of_New_England_Revolution_%282021%29.svg.png',

  // ─── NOVOS: Clubes Brasileiros Faltantes ────────────────────────────
  COR: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/SC_Corinthians_Paulista_logo.svg/250px-SC_Corinthians_Paulista_logo.svg.png',
  VAS: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/CR_Vasco_da_Gama_logo.svg/250px-CR_Vasco_da_Gama_logo.svg.png',
  NAU: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/76/CN_Capibaribe_logo.svg/250px-CN_Capibaribe_logo.svg.png',

  // ─── Red Bull Bragantino ─────────────────────────────────────────────
  RBB: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8e/Red_Bull_Bragantino_logo.svg/250px-Red_Bull_Bragantino_logo.svg.png',

  // ─── NOVOS: MLS Faltantes ──────────────────────────────────────────
  MIA: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Inter_Miami_CF_logo.svg/250px-Inter_Miami_CF_logo.svg.png',
  ATL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/84/Atlanta_United_FC_logo.svg/250px-Atlanta_United_FC_logo.svg.png',
  NAS: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/54/Nashville_SC_logo.svg/250px-Nashville_SC_logo.svg.png',
  AUS: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/20/Austin_FC_logo.svg/250px-Austin_FC_logo.svg.png',
  DAL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/99/FC_Dallas_logo_2024.svg/250px-FC_Dallas_logo_2024.svg.png',
  HOU: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7e/Houston_Dynamo_FC_logo.svg/250px-Houston_Dynamo_FC_logo.svg.png',
  TOR: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/Toronto_FC_logo.svg/250px-Toronto_FC_logo.svg.png',
  MTL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5a/CF_Montr%C3%A9al_logo.svg/250px-CF_Montr%C3%A9al_logo.svg.png',
  COL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/74/Colorado_Rapids_logo.svg/250px-Colorado_Rapids_logo.svg.png',
  RSL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Real_Salt_Lake_logo.svg/250px-Real_Salt_Lake_logo.svg.png',
  MIN: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Minnesota_United_FC_logo.svg/250px-Minnesota_United_FC_logo.svg.png',
  SJ: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d5/San_Jose_Earthquakes_logo.svg/250px-San_Jose_Earthquakes_logo.svg.png',
  DCU: 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/46/D.C._United_logo.svg/250px-D.C._United_logo.svg.png',
  CLT: 'https://upload.wikimedia.org/wikipedia/en/thumb/0/0b/Charlotte_FC_logo.svg/250px-Charlotte_FC_logo.svg.png',
  SD: 'https://upload.wikimedia.org/wikipedia/commons/thumb/b/b2/San_Diego_FC_logo.svg/250px-San_Diego_FC_logo.svg.png',
};

/**
 * Retorna a URL do escudo oficial de um clube, ou null se não disponível.
 *
 * @param code - Código 3-letras do clube (ex: "BOT", "FLA", "LAG")
 */
export function getTeamBadgeUrl(code: string): string | null {
  return CLUB_BADGES[code.toUpperCase()] ?? null;
}

/**
 * Cores do clube para glow/ambiente dos escudos.
 * `glow` é uma versão translúcida da cor principal; `dark` serve para
 * sombras. Usado pelo <TeamBadge> para criar o halo na cor do time.
 */
const TEAM_COLORS: Record<string, { primary: string; glow: string; dark: string }> = {
  BOT: { primary: '#000000', glow: 'rgba(255,255,255,0.10)', dark: 'rgba(255,255,255,0.18)' },
  FLA: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  FLU: { primary: '#7a0032', glow: 'rgba(122,0,50,0.25)', dark: 'rgba(122,0,50,0.4)' },
  PAL: { primary: '#006437', glow: 'rgba(0,100,55,0.22)', dark: 'rgba(0,100,55,0.35)' },
  SAO: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  SAN: { primary: '#111111', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  INT: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  GRE: { primary: '#0066b3', glow: 'rgba(0,102,179,0.22)', dark: 'rgba(0,102,179,0.35)' },
  CAM: { primary: '#000000', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  CRU: { primary: '#0033a0', glow: 'rgba(0,51,160,0.22)', dark: 'rgba(0,51,160,0.35)' },
  CAP: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  BAH: { primary: '#0033a0', glow: 'rgba(0,51,160,0.22)', dark: 'rgba(0,51,160,0.35)' },
  VIT: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  FOR: { primary: '#0033a0', glow: 'rgba(0,51,160,0.22)', dark: 'rgba(0,51,160,0.35)' },
  CEA: { primary: '#0033a0', glow: 'rgba(0,51,160,0.22)', dark: 'rgba(0,51,160,0.35)' },
  SPT: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  GOI: { primary: '#007733', glow: 'rgba(0,119,51,0.22)', dark: 'rgba(0,119,51,0.35)' },
  CUI: { primary: '#006633', glow: 'rgba(0,102,51,0.22)', dark: 'rgba(0,102,51,0.35)' },
  CHA: { primary: '#007733', glow: 'rgba(0,119,51,0.22)', dark: 'rgba(0,119,51,0.35)' },
  AVA: { primary: '#0033a0', glow: 'rgba(0,51,160,0.22)', dark: 'rgba(0,51,160,0.35)' },
  CRI: { primary: '#ffcc00', glow: 'rgba(255,204,0,0.18)', dark: 'rgba(255,204,0,0.3)' },
  JUV: { primary: '#007733', glow: 'rgba(0,119,51,0.22)', dark: 'rgba(0,119,51,0.35)' },
  MIR: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  RBB: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  BRU: { primary: '#1a6fc4', glow: 'rgba(26,111,196,0.22)', dark: 'rgba(26,111,196,0.35)' },
  VAS: { primary: '#000000', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  COR: { primary: '#000000', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  NAU: { primary: '#0033a0', glow: 'rgba(0,51,160,0.22)', dark: 'rgba(0,51,160,0.35)' },
  AMM: { primary: '#000000', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  LON: { primary: '#004b87', glow: 'rgba(0,75,135,0.22)', dark: 'rgba(0,75,135,0.35)' },
  CRB: { primary: '#ffffff', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  NOV: { primary: '#0066b3', glow: 'rgba(0,102,179,0.22)', dark: 'rgba(0,102,179,0.35)' },
  SBE: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  CTB: { primary: '#004b87', glow: 'rgba(0,75,135,0.22)', dark: 'rgba(0,75,135,0.35)' },
  SD: { primary: '#0a3d91', glow: 'rgba(10,61,145,0.22)', dark: 'rgba(10,61,145,0.35)' },
  MIA: { primary: '#f5a3c7', glow: 'rgba(245,163,199,0.2)', dark: 'rgba(245,163,199,0.32)' },
  LAG: { primary: '#002d62', glow: 'rgba(0,45,98,0.25)', dark: 'rgba(0,45,98,0.4)' },
  LAF: { primary: '#000000', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  NYC: { primary: '#6cabdd', glow: 'rgba(108,171,221,0.2)', dark: 'rgba(108,171,221,0.32)' },
  NYR: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  ATL: { primary: '#231f20', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  SEA: { primary: '#5d9732', glow: 'rgba(93,151,50,0.22)', dark: 'rgba(93,151,50,0.35)' },
  POR: { primary: '#004812', glow: 'rgba(0,72,18,0.25)', dark: 'rgba(0,72,18,0.4)' },
  CLB: { primary: '#fdda25', glow: 'rgba(253,218,37,0.18)', dark: 'rgba(253,218,37,0.3)' },
  CIN: { primary: '#ff5000', glow: 'rgba(255,80,0,0.2)', dark: 'rgba(255,80,0,0.32)' },
  ORL: { primary: '#612b9e', glow: 'rgba(97,43,158,0.22)', dark: 'rgba(97,43,158,0.35)' },
  NAS: { primary: '#fde101', glow: 'rgba(253,225,1,0.18)', dark: 'rgba(253,225,1,0.3)' },
  AUS: { primary: '#00b140', glow: 'rgba(0,177,64,0.22)', dark: 'rgba(0,177,64,0.35)' },
  DAL: { primary: '#c8102e', glow: 'rgba(200,16,46,0.22)', dark: 'rgba(200,16,46,0.35)' },
  HOU: { primary: '#ef6b20', glow: 'rgba(239,107,32,0.2)', dark: 'rgba(239,107,32,0.32)' },
  CHI: { primary: '#cc0000', glow: 'rgba(204,0,0,0.22)', dark: 'rgba(204,0,0,0.35)' },
  TOR: { primary: '#dd2233', glow: 'rgba(221,34,51,0.22)', dark: 'rgba(221,34,51,0.35)' },
  VAN: { primary: '#00538b', glow: 'rgba(0,83,139,0.22)', dark: 'rgba(0,83,139,0.35)' },
  MTL: { primary: '#0077b6', glow: 'rgba(0,119,182,0.22)', dark: 'rgba(0,119,182,0.35)' },
  COL: { primary: '#8c2131', glow: 'rgba(140,33,49,0.22)', dark: 'rgba(140,33,49,0.35)' },
  RSL: { primary: '#b30838', glow: 'rgba(179,8,56,0.22)', dark: 'rgba(179,8,56,0.35)' },
  SKC: { primary: '#93b1d7', glow: 'rgba(147,177,215,0.18)', dark: 'rgba(147,177,215,0.3)' },
  MIN: { primary: '#cce100', glow: 'rgba(204,225,0,0.16)', dark: 'rgba(204,225,0,0.28)' },
  STL: { primary: '#003f72', glow: 'rgba(0,63,114,0.22)', dark: 'rgba(0,63,114,0.35)' },
  SJ: { primary: '#003876', glow: 'rgba(0,56,118,0.22)', dark: 'rgba(0,56,118,0.35)' },
  PHI: { primary: '#b1874b', glow: 'rgba(177,135,75,0.2)', dark: 'rgba(177,135,75,0.32)' },
  DCU: { primary: '#000000', glow: 'rgba(255,255,255,0.08)', dark: 'rgba(255,255,255,0.16)' },
  CLT: { primary: '#1e6b3e', glow: 'rgba(30,107,62,0.22)', dark: 'rgba(30,107,62,0.35)' },
  NER: { primary: '#ce1126', glow: 'rgba(206,17,38,0.22)', dark: 'rgba(206,17,38,0.35)' },
};

/**
 * Retorna as cores de um clube para o glow do escudo, ou null se desconhecido.
 */
export function getTeamColors(code: string): { primary: string; glow: string; dark: string } | null {
  return TEAM_COLORS[code.toUpperCase()] ?? null;
}
