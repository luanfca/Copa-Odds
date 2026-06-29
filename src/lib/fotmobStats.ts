/**
 * Busca stats de time.
 * - Desarmes: FotMob API
 * - Faltas (cometidas/sofridas): FIFA scraping
 */
import { logger } from '../lib/logger';

interface FotMobTeamStat {
  name: string;
  avgPerGame: number;
  total: number;
}

const FOTMOB_BASE = 'https://www.fotmob.com/api/data';
const LEAGUE_ID = 77;
const SEASON_ID = 24254;

const STAT_CACHE = new Map<string, FotMobTeamStat[]>();

async function fetchTackleStats(): Promise<FotMobTeamStat[]> {
  const cacheKey = 'tackles';
  if (STAT_CACHE.has(cacheKey)) return STAT_CACHE.get(cacheKey)!;

  const url = `${FOTMOB_BASE}/leagueseasondeepstats?lng=pt-BR&id=${LEAGUE_ID}&season=${SEASON_ID}&type=teams&stat=total_tackle_team`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const teams: FotMobTeamStat[] = [];
    for (const entry of Object.values(data.statsData ?? {})) {
      const e = entry as { name: string; statValue?: { value: number }; substatValue?: { value: number } };
      teams.push({ name: e.name, avgPerGame: e.statValue?.value ?? 0, total: e.substatValue?.value ?? 0 });
    }
    STAT_CACHE.set(cacheKey, teams);
    return teams;
  } catch (error) {
    logger.error('[FotMob] Erro:', { error: String(error) });
    return [];
  }
}

async function fetchFoulsStats(): Promise<FotMobTeamStat[]> {
  const cacheKey = 'fouls';
  if (STAT_CACHE.has(cacheKey)) return STAT_CACHE.get(cacheKey)!;

  const url = `${FOTMOB_BASE}/leagueseasondeepstats?lng=pt-BR&id=${LEAGUE_ID}&season=${SEASON_ID}&type=teams&stat=fk_foul_lost_team`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const teams: FotMobTeamStat[] = [];
    for (const entry of Object.values(data.statsData ?? {})) {
      const e = entry as { name: string; statValue?: { value: number }; substatValue?: { value: number } };
      teams.push({ name: e.name, avgPerGame: e.statValue?.value ?? 0, total: e.substatValue?.value ?? 0 });
    }
    STAT_CACHE.set(cacheKey, teams);
    return teams;
  } catch (error) {
    logger.error('[FotMob] Erro faltas:', { error: String(error) });
    return [];
  }
}

const TEAM_NAME_MAP: Record<string, string> = {
  'Brasil': 'Brazil', 'Argentina': 'Argentina', 'França': 'France',
  'Inglaterra': 'England', 'Espanha': 'Spain', 'Alemanha': 'Germany',
  'Portugal': 'Portugal', 'Holanda': 'Netherlands', 'Bélgica': 'Belgium',
  'Croácia': 'Croatia', 'Marrocos': 'Morocco', 'Japão': 'Japan',
  'Coreia do Sul': 'South Korea', 'Austrália': 'Australia', 'México': 'Mexico',
  'EUA': 'USA', 'Senegal': 'Senegal', 'Equador': 'Ecuador',
  'Polônia': 'Poland', 'Irã': 'Iran', 'Gana': 'Ghana',
  'Camarões': 'Cameroon', 'Sérvia': 'Serbia', 'Suíça': 'Switzerland',
  'Uruguai': 'Uruguay', 'Costa Rica': 'Costa Rica', 'Tunísia': 'Tunisia',
  'Arábia Saudita': 'Saudi Arabia', 'África do Sul': 'South Africa',
  'Canadá': 'Canada', 'Colômbia': 'Colombia', 'Escócia': 'Scotland',
  'Paraguai': 'Paraguay', 'Haiti': 'Haiti', 'RD Congo': 'DR Congo',
  'Cabo Verde': 'Cape Verde', 'Nova Zelândia': 'New Zealand',
};

export async function getTeamStatAvg(teamName: string, market: string): Promise<number> {
  const fotmobName = TEAM_NAME_MAP[teamName] ?? teamName;

  if (market === 'desarmes') {
    const teams = await fetchTackleStats();
    const match = teams.find(t => t.name.toLowerCase() === fotmobName.toLowerCase());
    return match?.avgPerGame ?? 0;
  }

  // Faltas: FotMob statValue.value já é média por jogo
  const foulsTeams = await fetchFoulsStats();
  const match = foulsTeams.find(t => t.name.toLowerCase() === fotmobName.toLowerCase());
  return match?.avgPerGame ?? 0;
}

