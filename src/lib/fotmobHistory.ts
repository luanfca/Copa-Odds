import { normalizeName } from './normalize';

const FOTMOB = 'https://www.fotmob.com';
const FOTMOB_API = `${FOTMOB}/api/data`;
const FOTMOB_SEARCH = 'https://apigw.fotmob.com/searchapi/suggest';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

const FOTMOB_TO_SOFA_TOURNAMENT: Record<number, number> = {
  77: 1, // Copa do Mundo
  268: 325, // Brasileirão Série A
  130: 242, // MLS
  47: 17, // Premier League
  87: 8, // La Liga
  55: 23, // Serie A (Itália)
  54: 35, // Bundesliga
  53: 34, // Ligue 1
  42: 7, // Champions League
};

export interface FotmobFinishedEvent {
  /** Negativo para não colidir com IDs do SofaScore no cache compartilhado. */
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  startDate: string;
  startTimestamp: number;
  tournamentId: number;
  tournamentName: string;
}

export interface FotmobPlayerGameStat {
  name: string;
  team: string;
  tackles: number;
  foulsCommitted: number;
  foulsSuffered: number;
  shots: number;
  shotsOnTarget: number;
  minutes: number;
}

const teamIdCache = new Map<string, number | null>();
const teamEventsCache = new Map<string, FotmobFinishedEvent[]>();
const playerStatsCache = new Map<number, FotmobPlayerGameStat[]>();

async function fotmobJson(url: string): Promise<any | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': USER_AGENT,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      console.warn(`[FotMob] HTTP ${response.status}: ${url.slice(0, 100)}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.warn(`[FotMob] Falha: ${url.slice(0, 100)}`, String(error));
    return null;
  }
}

async function fotmobText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': USER_AGENT,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      console.warn(`[FotMob] HTTP ${response.status}: ${url.slice(0, 100)}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn(`[FotMob] Falha: ${url.slice(0, 100)}`, String(error));
    return null;
  }
}

function namesMatch(a: string, b: string): boolean {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  return Boolean(na && nb && (na === nb || na.includes(nb) || nb.includes(na)));
}

async function resolveFotmobTeamId(teamName: string): Promise<number | null> {
  const key = normalizeName(teamName);
  if (teamIdCache.has(key)) return teamIdCache.get(key) ?? null;

  // Algumas casas acrescentam "FC"/"SC", enquanto a busca do FotMob só
  // reconhece o nome sem o sufixo (ex.: "St. Louis City SC"). Tenta as duas
  // formas, mas prefere igualdade exata para não escolher "Remo Stars" ou
  // "Vitoria de Guimaraes" antes de Remo/Vitória.
  const searchTerms = [
    teamName,
    teamName.replace(/\s+(?:FC|SC|EC|AC)$/i, '').trim(),
  ].filter((term, index, all) => term && all.indexOf(term) === index);

  let fuzzyOption: any | null = null;
  for (const term of searchTerms) {
    const data = await fotmobJson(
      `${FOTMOB_SEARCH}?term=${encodeURIComponent(term)}&lang=en`,
    );
    const options = (data?.teamSuggest ?? []).flatMap(
      (group: any) => group?.options ?? [],
    );
    const exact = options.find((option: any) => {
      const optionName = option?.text?.split('|')?.[0] ?? '';
      return normalizeName(optionName) === normalizeName(term);
    });
    if (exact) {
      const id = Number(exact?.payload?.id ?? exact?.text?.split('|')?.[1]);
      if (Number.isFinite(id) && id > 0) {
        teamIdCache.set(key, id);
        return id;
      }
    }
    fuzzyOption ??= options.find((option: any) =>
      namesMatch(option?.text?.split('|')?.[0] ?? '', term),
    );
  }

  const fuzzyId = Number(
    fuzzyOption?.payload?.id ?? fuzzyOption?.text?.split('|')?.[1],
  );
  const resolved = Number.isFinite(fuzzyId) && fuzzyId > 0 ? fuzzyId : null;
  teamIdCache.set(key, resolved);
  return resolved;
}

function parseNextData(html: string): any | null {
  const marker = '<script id="__NEXT_DATA__" type="application/json">';
  const startAt = html.indexOf(marker);
  if (startAt < 0) return null;
  const start = startAt + marker.length;
  const end = html.indexOf('</script>', start);
  if (end < 0) return null;
  try {
    return JSON.parse(html.slice(start, end));
  } catch {
    return null;
  }
}

export async function getFotmobTeamFinishedEvents(
  teamName: string,
  tournamentId?: number,
): Promise<FotmobFinishedEvent[]> {
  const cacheKey = `${normalizeName(teamName)}:${tournamentId ?? 'all'}`;
  const cached = teamEventsCache.get(cacheKey);
  if (cached) return cached;

  const teamId = await resolveFotmobTeamId(teamName);
  if (!teamId) return [];

  const html = await fotmobText(`${FOTMOB}/teams/${teamId}/fixtures`);
  if (!html) return [];
  const nextData = parseNextData(html);
  const teamData = nextData?.props?.pageProps?.fallback?.[`team-${teamId}`];
  const fixtures =
    teamData?.fixtures?.allFixtures?.fixtures ??
    teamData?.overview?.overviewFixtures ??
    [];

  const now = Date.now();
  const results: FotmobFinishedEvent[] = [];
  for (const fixture of fixtures) {
    const fotmobId = Number(fixture?.id);
    const startDate = String(fixture?.status?.utcTime ?? '');
    const startMs = Date.parse(startDate);
    if (
      !Number.isFinite(fotmobId) ||
      fotmobId <= 0 ||
      !Number.isFinite(startMs) ||
      startMs > now ||
      (!fixture?.status?.finished && !fixture?.status?.started)
    ) {
      continue;
    }

    const leagueId = Number(fixture?.tournament?.leagueId ?? 0);
    const sofaTournamentId = FOTMOB_TO_SOFA_TOURNAMENT[leagueId] ?? 0;
    if (tournamentId != null && sofaTournamentId !== tournamentId) continue;

    results.push({
      eventId: -fotmobId,
      homeTeam: fixture?.home?.name ?? '',
      awayTeam: fixture?.away?.name ?? '',
      startDate: new Date(startMs).toISOString(),
      startTimestamp: Math.floor(startMs / 1000),
      tournamentId: sofaTournamentId,
      tournamentName: fixture?.tournament?.name ?? '',
    });
  }

  results.sort((a, b) => b.startTimestamp - a.startTimestamp);
  // Também memoriza misses. Sem isso, um time não resolvido repetia busca e
  // timeout para cada jogador/mercado durante a mesma coleta diária.
  teamEventsCache.set(cacheKey, results);
  return results;
}

function statValue(player: any, key: string): number {
  for (const group of player?.stats ?? []) {
    for (const [label, item] of Object.entries(group?.stats ?? {})) {
      const stat = item as any;
      if (stat?.key === key || label === key) {
        const value = Number(stat?.stat?.value ?? 0);
        return Number.isFinite(value) ? value : 0;
      }
    }
  }
  return 0;
}

export async function getFotmobEventPlayerStats(
  fotmobEventId: number,
): Promise<FotmobPlayerGameStat[]> {
  const id = Math.abs(fotmobEventId);
  const cached = playerStatsCache.get(id);
  if (cached) return cached;

  const data = await fotmobJson(
    `${FOTMOB_API}/matchDetails?matchId=${encodeURIComponent(id)}`,
  );
  const rawPlayers = Object.values(data?.content?.playerStats ?? {}) as any[];
  const players = rawPlayers
    .filter((player) => player?.name && player?.teamName)
    .map((player) => ({
      name: String(player.name),
      team: String(player.teamName),
      tackles: statValue(player, 'matchstats.headers.tackles'),
      foulsCommitted: statValue(player, 'fouls'),
      foulsSuffered: statValue(player, 'was_fouled'),
      shots: statValue(player, 'total_shots'),
      shotsOnTarget: statValue(player, 'ShotsOnTarget'),
      minutes: statValue(player, 'minutes_played'),
    }));

  if (players.length) playerStatsCache.set(id, players);
  return players;
}
