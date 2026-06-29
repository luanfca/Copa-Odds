import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getPlayerHistory } from '@/lib/playerStats365';
import { SHARED_HISTORY_CACHE } from '@/lib/sharedCache';
import { computeProbableStarterIds } from '@/lib/starters';
import { getStartersForMatch } from '@/lib/lineups365';
import { findBestOdds, type OddEntry } from '@/lib/arbitrage';
import { isLikelyPlayerName } from '@/lib/normalize';
import { computeLineAnalysis } from '@/lib/poisson';

export const dynamic = 'force-dynamic';

const CACHE_VERSION = 'v3-desarmes';
function hKey(team: string, name: string, market: string, allComps: boolean) {
  return `${CACHE_VERSION}::${team}::${name}::${market}::${allComps ? 'all' : 'wc'}`;
}

const DES_TTL = 60_000;
let desCache: { body: any; t: number; allComps: boolean } | null = null;

/** Invalida o cache server-side. Chamado após nova coleta. */
export function invalidateDesCache(): void {
  desCache = null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.has('refresh');
  const market = url.searchParams.get('market') ?? 'desarmes';
  const allComps = url.searchParams.get('allComps') === 'true';

  if (!forceRefresh && desCache && Date.now() - desCache.t < DES_TTL && desCache.allComps === allComps) {
    return NextResponse.json(desCache.body);
  }

  try {
    const lastScrape = await prisma.scrapeLog.findFirst({
      where: { status: { in: ['success', 'partial'] } },
      orderBy: { finishedAt: 'desc' },
    });

    const timeThreshold = lastScrape?.startedAt
      ? lastScrape.startedAt
      : new Date(Date.now() - 4 * 60 * 60 * 1000);

    const players = await prisma.player.findMany({
      include: {
        match: true,
        snapshots: {
          where: { collectedAt: { gte: timeThreshold }, market },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    const starterIds = computeProbableStarterIds(
      players
        .filter((p) => p.snapshots.length > 0)
        .map((p) => ({
          playerId: p.id,
          matchId: p.matchId,
          team: p.team,
          houses: p.snapshots.map((s) => s.house),
          lines: p.snapshots.map((s) => s.line),
          snapshotCount: p.snapshots.length,
        })),
    );

    const matchById = new Map<string, (typeof players)[number]['match']>();
    for (const p of players) {
      if (p.snapshots.length > 0 && !matchById.has(p.matchId)) {
        matchById.set(p.matchId, p.match);
      }
    }

    const startersByMatch = new Map<string, any>();
    await Promise.race([
      Promise.all(
        Array.from(matchById.entries()).map(async ([matchId, m]) => {
          const ms = await getStartersForMatch(m.homeTeam, m.awayTeam, m.dateTime.toISOString());
          startersByMatch.set(matchId, ms);
        })
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);

    const isProbableStarter = (player: (typeof players)[number]): boolean => {
      const ms = startersByMatch.get(player.matchId);
      if (ms) return ms.isStarter(player.displayName || player.name, player.team);
      return starterIds.has(player.id);
    };

    const HOUSE_FALLBACK: Record<string, string> = {
      betmgm: 'https://www.betmgm.bet.br',
      superbet: 'https://superbet.bet.br',
      betfair: 'https://www.betfair.bet.br',
      bet365: 'https://www.bet365.bet.br',
    };

    interface PlayerResult {
      id: string;
      displayName: string;
      team: string;
      matchId: string;
      match: { id: string; homeTeam: string; awayTeam: string; homeFlag: string | null; awayFlag: string | null; dateTime: string; stage: string };
      isStarter: boolean;
      odds: OddEntry[];
      bestByLine: Record<string, OddEntry>;
      history: { entries: { date: string; opponent: string; value: number; minutes: number | null }[]; total: number; average: number } | null;
      analysis?: Array<{ line: string; probability: number; fairOdds: number; bestOdd: number; ev: number; hasValue: boolean }>;
    }

    const results: PlayerResult[] = [];

    for (const player of players) {
      if (player.snapshots.length === 0) continue;
      if (!isLikelyPlayerName(player.displayName || player.name)) continue;

      const latestByHouseLine = new Map<string, (typeof player.snapshots)[0]>();
      for (const snap of player.snapshots) {
        const key = `${snap.house}_${snap.line}`;
        if (!latestByHouseLine.has(key)) {
          latestByHouseLine.set(key, snap);
        }
      }

      const odds: OddEntry[] = Array.from(latestByHouseLine.values()).map((s) => ({
        house: s.house as OddEntry['house'],
        line: s.line,
        value: s.value,
        url: s.url ?? HOUSE_FALLBACK[s.house] ?? undefined,
      }));

      if (odds.length === 0) continue;

      const bestByLine = Object.fromEntries(findBestOdds(odds)) as Record<string, OddEntry>;

      results.push({
        id: player.id,
        displayName: player.displayName,
        team: player.team,
        matchId: player.matchId,
        match: {
          id: player.match.id,
          homeTeam: player.match.homeTeam,
          awayTeam: player.match.awayTeam,
          homeFlag: player.match.homeFlag,
          awayFlag: player.match.awayFlag,
          dateTime: player.match.dateTime.toISOString(),
          stage: player.match.stage,
        },
        isStarter: isProbableStarter(player),
        odds,
        bestByLine,
        history: null,
      });
    }

    // Busca histórico de desarmes para cada jogador (em paralelo, com limite)
    const uniquePlayers = new Map<string, (typeof results)[0]>();
    for (const r of results) {
      const key = `${r.team}::${r.displayName}`;
      if (!uniquePlayers.has(key)) uniquePlayers.set(key, r);
    }

    await Promise.race([
      Promise.all(
        Array.from(uniquePlayers.values()).map(async (r) => {
          const cacheKey = hKey(r.team, r.displayName, market, allComps);
          const cached = SHARED_HISTORY_CACHE.get(cacheKey);
          if (cached) {
            r.history = { entries: cached.entries, total: cached.total, average: cached.average };
          } else {
            const h = await getPlayerHistory(r.displayName, r.team, market, allComps);
            if (h !== null) {
              SHARED_HISTORY_CACHE.set(cacheKey, h);
              r.history = { entries: h.entries, total: h.total, average: h.average };
            }
          }
        })
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 60000)),
    ]);

    // Atualiza history do cache para todos os resultados duplicados
    for (const r of results) {
      if (r.history === null) {
        const cacheKey = hKey(r.team, r.displayName, market, allComps);
        const cached = SHARED_HISTORY_CACHE.get(cacheKey);
        if (cached) r.history = { entries: cached.entries, total: cached.total, average: cached.average };
      }
    }

    // Ordena por média de desarmes (decrescente), depois por melhor odd
    function bestOddValue(r: (typeof results)[0]): number {
      return Math.max(...r.odds.map((o) => o.value), 0);
    }

    results.sort((a, b) => {
      const avgA = a.history?.average ?? 0;
      const avgB = b.history?.average ?? 0;
      if (avgB !== avgA) return bestOddValue(b) - bestOddValue(a);
      return bestOddValue(b) - bestOddValue(a);
    });

    // Adiciona análise de Poisson (odd justa + EV) para cada jogador
    const LINES = ['1+', '2+', '3+', '4+'];
    for (const r of results) {
      const avg = r.history?.average ?? 0;
      const bestByLine: Record<string, number> = {};
      for (const l of LINES) {
        bestByLine[l] = r.bestByLine[l]?.value ?? 0;
      }
      r.analysis = computeLineAnalysis(avg, LINES, bestByLine);
    }

    const body = { players: results, market, mock: false };
    desCache = { body, t: Date.now(), allComps };
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar ranking de desarmes', detail: String(error) }, { status: 500 });
  }
}
