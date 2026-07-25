import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

interface AdapterStats {
  adapter: string;
  okField: string;
  successCount: number;
  failureCount: number;
  totalRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastStatus: string | null;
}

interface ScrapeStatsResponse {
  overall: {
    totalScrapes: number;
    successfulScrapes: number;
    failedScrapes: number;
    partialScrapes: number;
    overallSuccessRate: number;
    lastScrapeAt: string | null;
    lastScrapeStatus: string | null;
    avgDurationMs: number | null;
    totalMatchesScraped: number;
    totalPlayersScraped: number;
    totalOddsCollected: number;
  };
  adapters: AdapterStats[];
  recentScrapes: Array<{
    id: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    matchCount: number;
    playerCount: number;
    oddCount: number;
    errorMsg: string | null;
    durationMs: number | null;
  }>;
}

/** Com secret configurado, só quem manda a chave vê errorMsg (stack/detalhes). */
function canSeeErrorDetails(request: Request): boolean {
  const secret = process.env.SCRAPE_SECRET ?? process.env.ADMIN_SECRET ?? '';
  if (!secret) return true; // dev / sem secret
  const key = request.headers.get('x-scrape-key') ?? request.headers.get('x-admin-key') ?? '';
  return key === secret;
}

export async function GET(request: Request) {
  const showErrors = canSeeErrorDetails(request);

  try {
    const logs = await prisma.scrapeLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: 100,
    });

    if (logs.length === 0) {
      return NextResponse.json({
        overall: {
          totalScrapes: 0,
          successfulScrapes: 0,
          failedScrapes: 0,
          partialScrapes: 0,
          overallSuccessRate: 0,
          lastScrapeAt: null,
          lastScrapeStatus: null,
          avgDurationMs: null,
          totalMatchesScraped: 0,
          totalPlayersScraped: 0,
          totalOddsCollected: 0,
        },
        adapters: [],
        recentScrapes: [],
      });
    }

    // Só as 4 casas ativas (Bet365/Betsson desligadas)
    const adapterFields = [
      { adapter: 'Betfair', okField: 'betfairOk' },
      { adapter: 'BetMGM', okField: 'betmgmOk' },
      { adapter: 'Superbet', okField: 'superbetOk' },
      { adapter: 'Pitaco', okField: 'pitacoOk' },
    ] as const;

    // Compute adapter stats
    const adapters: AdapterStats[] = adapterFields.map(({ adapter, okField }) => {
      const successes = logs.filter((l) => l[okField as keyof typeof l] === true).length;
      const failures = logs.filter((l) => l[okField as keyof typeof l] === false).length;
      const total = successes + failures;
      return {
        adapter,
        okField,
        successCount: successes,
        failureCount: failures,
        totalRuns: total,
        successRate: total > 0 ? parseFloat(((successes / total) * 100).toFixed(1)) : 0,
        lastRunAt: logs[0]?.finishedAt?.toISOString() ?? null,
        lastStatus: logs[0]?.status ?? null,
      };
    });

    // Overall stats
    const successful = logs.filter((l) => l.status === 'success').length;
    // scrapeAll grava 'failed' (não 'error')
    const failed = logs.filter((l) => l.status === 'failed' || l.status === 'error').length;
    const partial = logs.filter((l) => l.status === 'partial').length;
    const total = logs.length;

    const durations = logs
      .filter((l) => l.startedAt && l.finishedAt)
      .map((l) => l.finishedAt!.getTime() - l.startedAt.getTime());
    // Nota: filter garante que finishedAt não é null aqui
    const avgDurationMs = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    const totalMatches = logs.reduce((sum, l) => sum + l.matchCount, 0);
    const totalPlayers = logs.reduce((sum, l) => sum + l.playerCount, 0);
    const totalOdds = logs.reduce((sum, l) => sum + l.oddCount, 0);

    // Recent scrapes with computed duration
    const recentScrapes = logs.slice(0, 20).map((l) => ({
      id: l.id,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
      status: l.status,
      matchCount: l.matchCount,
      playerCount: l.playerCount,
      oddCount: l.oddCount,
      errorMsg: showErrors ? l.errorMsg : null,
      durationMs: l.startedAt && l.finishedAt
        ? l.finishedAt.getTime() - l.startedAt.getTime()
        : null,
    }));

    const response: ScrapeStatsResponse = {
      overall: {
        totalScrapes: total,
        successfulScrapes: successful,
        failedScrapes: failed,
        partialScrapes: partial,
        overallSuccessRate: parseFloat(((successful / total) * 100).toFixed(1)),
        lastScrapeAt: logs[0]?.finishedAt?.toISOString() ?? null,
        lastScrapeStatus: logs[0]?.status ?? null,
        avgDurationMs,
        totalMatchesScraped: totalMatches,
        totalPlayersScraped: totalPlayers,
        totalOddsCollected: totalOdds,
      },
      adapters,
      recentScrapes,
    };

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao buscar estatísticas de scrape', detail: String(error) },
      { status: 500 },
    );
  }
}
