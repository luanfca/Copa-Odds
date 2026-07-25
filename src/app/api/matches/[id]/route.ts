// Force Next.js recompile 1
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockOddsData } from '@/lib/mockData';
import { findBestOdds, type OddEntry } from '@/lib/arbitrage';
import { isLikelyPlayerName, isSamePlayer } from '@/lib/normalize';
import { getPlayerHistory } from '@/lib/sofascoreStats';
import { getTeamFinishedEvents } from '@/lib/sofascoreStats';
import { getTeamStatAvg } from '@/lib/fotmobStats';
import { getSharedHistory, setSharedHistory } from '@/lib/sharedCache';
import { getSofascoreMatchStats, resolveSofascoreEventId } from '@/lib/sofascoreStats';
import { matchCache, MATCH_TTL, MATCH_TTL_PARTIAL, MAX_CACHE_SIZE, invalidateMatchCache, type MatchCacheEntry } from '@/lib/cacheInvalidation';
import { broadcastOddsUpdate, broadcastScrapeError } from '@/lib/ws-server';

export const dynamic = 'force-dynamic';

const CACHE_VERSION = 'v8-sqlite-10games-2026';
function hKey(team: string, name: string, market: string, competition?: string, maxGames?: number, year?: number) {
  return `${CACHE_VERSION}::${team}::${name}::${market}::${competition ?? 'all'}::${maxGames ?? 10}::${year ?? 'cur'}`;
}

function getCached(key: string): MatchCacheEntry | null {
  const hit = matchCache.get(key);
  if (!hit) return null;
  const ttl = hit.full ? MATCH_TTL : MATCH_TTL_PARTIAL;
  if (Date.now() - hit.t > ttl) {
    matchCache.delete(key);
    return null;
  }
  return hit;
}

function setCached(key: string, entry: MatchCacheEntry): void {
  if (matchCache.size >= MAX_CACHE_SIZE) {
    const oldest = matchCache.keys().next().value;
    if (oldest) matchCache.delete(oldest);
  }
  matchCache.set(key, entry);
}

interface TeamStat {
  team: string;
  avgMade: number;
  avgSuffered: number;
  gamesPlayed: number;
}

async function computeTeamStats(
  players: PlayerOut[],
  market: string,
  homeTeam: string,
  awayTeam: string,
): Promise<TeamStat[]> {
  const homeAvg = await getTeamStatAvg(homeTeam, market);
  const awayAvg = await getTeamStatAvg(awayTeam, market);

  return [
    { team: homeTeam, avgMade: homeAvg, avgSuffered: 0, gamesPlayed: 0 },
    { team: awayTeam, avgMade: awayAvg, avgSuffered: 0, gamesPlayed: 0 },
  ];
}

interface PlayerOut {
  id: string;
  displayName: string;
  team: string;
  odds: OddEntry[];
  bestByLine: Record<string, OddEntry>;
  history: unknown;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const reqUrl = new URL(_request.url);
    const market = reqUrl.searchParams.get('market') ?? 'desarmes';
    const maxGames = reqUrl.searchParams.has('maxGames') ? parseInt(reqUrl.searchParams.get('maxGames')!) : undefined;
    const year = reqUrl.searchParams.has('year') ? parseInt(reqUrl.searchParams.get('year')!) : undefined;
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      const matchOdds = mockOddsData.find(o => o.matchId === id);
      if (!matchOdds) {
        return NextResponse.json({ error: 'Jogo não encontrado' }, { status: 404 });
      }

      const factor = market === 'faltas_cometidas' ? 1.15 : market === 'faltas_sofridas' ? 0.85 : 1.0;
      const players = matchOdds.players.map(p => {
        const odds: OddEntry[] = p.odds.map(o => ({
          house: o.house as OddEntry['house'],
          line: o.line,
          value: parseFloat((o.value * factor).toFixed(2)),
          url: o.house === 'superbet'
            ? 'https://superbet.bet.br'
            : o.house === 'betmgm'
            ? 'https://www.betmgm.bet.br'
            : 'https://www.betfair.bet.br',
        }));
        return { ...p, bestByLine: Object.fromEntries(findBestOdds(odds)) };
      });

      return NextResponse.json({ players, mock: true });
    }

    const match = await prisma.match.findUnique({ where: { id } });
    const homeTeam = match?.homeTeam ?? '';
    const awayTeam = match?.awayTeam ?? '';

    console.log(`[match-route DEBUG] Match ${id}: homeTeam=${homeTeam}, awayTeam=${awayTeam}, competition='${match?.competition}'`);

    const players = await prisma.player.findMany({
      where: { matchId: id },
      include: {
        snapshots: {
          where: { market },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    if (players.length === 0) {
      return NextResponse.json({ players: [], mock: false });
    }

    const HOUSE_FALLBACK: Readonly<Record<string, string>> = {
      betmgm:   'https://www.betmgm.bet.br',
      superbet: 'https://superbet.bet.br',
      betfair:  'https://www.betfair.bet.br',
      bet365:   'https://www.bet365.bet.br',
      betsson:  'https://www.betsson.bet.br',
      pitaco:   'https://pitaco.bet.br',
    };

    // DEDUP: mescla jogadores duplicados do mesmo match ("J. Arias" + "Jhon Arias")
    const rawPlayers = players
      .filter(player => isLikelyPlayerName(player.displayName || player.name))
      .map(player => {
        const latestByHouseLine = new Map<string, typeof player.snapshots[0]>();
        for (const snap of player.snapshots) {
          const key = `${snap.house}_${snap.line}`;
          if (!latestByHouseLine.has(key)) {
            latestByHouseLine.set(key, snap);
          }
        }

        const ACTIVE = new Set(['betfair', 'betmgm', 'superbet', 'pitaco']);
        const odds: OddEntry[] = Array.from(latestByHouseLine.values())
          .filter(s => ACTIVE.has(s.house))
          .map(s => ({
            house: s.house as OddEntry['house'],
            line: s.line,
            value: s.value,
            url: s.url ?? HOUSE_FALLBACK[s.house] ?? undefined,
          }));

        if (odds.length === 0) return null;

        return {
          id: player.id,
          displayName: player.displayName,
          team: player.team,
          odds,
          bestByLine: Object.fromEntries(findBestOdds(odds)),
          history: null,
        } as PlayerOut;
      }).filter((p): p is PlayerOut => p !== null);

    // DEDUP: mescla jogadores com mesmo nome no mesmo time
    const dedupOut: PlayerOut[] = [];
    for (const p of rawPlayers) {
      let merged = false;
      for (const existing of dedupOut) {
        const sameTeam = !existing.team || !p.team || existing.team === p.team;
        if (sameTeam && isSamePlayer(existing.displayName, p.displayName)) {
          for (const odd of p.odds) {
            const exists = existing.odds.find(o => o.house === odd.house && o.line === odd.line);
            if (!exists) {
              existing.odds.push(odd);
            } else if (odd.value > exists.value) {
              exists.value = odd.value;
              if (odd.url) exists.url = odd.url;
            }
          }
          existing.bestByLine = Object.fromEntries(findBestOdds(existing.odds)) as Record<string, OddEntry>;
          if (p.displayName.length > existing.displayName.length) {
            existing.displayName = p.displayName;
          }
          if (!existing.history && p.history) existing.history = p.history;
          merged = true;
          break;
        }
      }
      if (!merged) dedupOut.push(p);
    }
    const enrichedPlayers = dedupOut;

    let full = false;
    const CONCURRENCY = 10;
    const HISTORY_TIMEOUT_MS = 180000;
    const matchStartTime = Date.now();

    // Pré-carrega eventos dos times no cache SQLite
    const teamsToPrecache = [homeTeam, awayTeam].filter(Boolean);
    const comp = match?.competition;
    const compKeys = comp ? [comp] : undefined;
    await Promise.allSettled(
      teamsToPrecache.map(async (team) => {
        const dummyKey = hKey(team, '__PREFETCH__', market, comp, maxGames, year);
        const already = await getSharedHistory(dummyKey);
        if (already) return;
        // Chama getTeamFinishedEvents diretamente para popular o cache SQLite
        await getTeamFinishedEvents(team);
        await setSharedHistory(dummyKey, { market, entries: [], total: 0, average: 0 });
      })
    );

    try {
      for (let i = 0; i < enrichedPlayers.length; i += CONCURRENCY) {
        if (Date.now() - matchStartTime > HISTORY_TIMEOUT_MS) break;
        const batch = enrichedPlayers.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (p) => {
            const teamsToTry = p.team ? [p.team] : [homeTeam, awayTeam];

            for (const tryTeam of teamsToTry) {
              const key = hKey(tryTeam, p.displayName, market, comp, maxGames, year);
              const cached = await getSharedHistory(key);
              if (cached) {
                p.history = cached;
                if (!p.team) p.team = tryTeam;
                return;
              }
              const opponentTeam = tryTeam === homeTeam ? awayTeam : homeTeam;
              const h = await getPlayerHistory(p.displayName, tryTeam, market, true, {
                maxGames,
                year,
              });
              if (h !== null) {
                await setSharedHistory(key, h);
                p.history = h;
                if (!p.team) p.team = tryTeam;
                return;
              }
            }
          }),
        );
      }
      full = true;
    } catch { /* best-effort */ }

    const body: any = { players: enrichedPlayers, mock: false };

    let teamStats: TeamStat[] = [];
    try {
      teamStats = await computeTeamStats(enrichedPlayers, market, homeTeam, awayTeam);
    } catch (err) {
      console.error('Erro ao buscar stats de time:', err);
    }
    body.teamStats = teamStats;

    if (match) {
      try {
        const sofaEventId = await resolveSofascoreEventId(homeTeam, awayTeam, match.dateTime.toISOString());
        if (sofaEventId) {
          const sofaMatch = await getSofascoreMatchStats(sofaEventId);
          if (sofaMatch) body.sofascoreMatch = sofaMatch;
        }
      } catch { /* best-effort */ }
    }

    // Emit WebSocket event for odds update
    broadcastOddsUpdate(id, enrichedPlayers.length);

    return NextResponse.json(body);

    } catch (error) {
    broadcastScrapeError(String(error))

    return NextResponse.json(
      { error: 'Erro ao buscar odds do jogo', detail: String(error) },
      { status: 500 }
    );
  }
}
