import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockMatches, mockOddsData } from '@/lib/mockData';
import { broadcastScrapeError } from '@/lib/ws-server';
import { getApiSnapshot, setApiSnapshot, buildLightMatches } from '@/lib/apiSnapshot';

export async function GET() {
  try {
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      const matches = mockMatches.map(m => {
        const matchOdds = mockOddsData.find(o => o.matchId === m.id);
        return { ...m, playerCount: matchOdds?.players.length || 0 };
      });
      return NextResponse.json({ matches, mock: true, lastUpdated: new Date().toISOString() });
    }

    // Snapshot instantâneo (pós-scrape / restart)
    const snap = await getApiSnapshot('matches');
    if (snap) {
      return NextResponse.json(snap, {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'X-Cache': 'SNAPSHOT',
        },
      });
    }

    // Rebuild leve e grava
    try {
      const light = await buildLightMatches();
      await setApiSnapshot('matches', 'matches', light);
      return NextResponse.json(light, {
        headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300', 'X-Cache': 'BUILT-LIGHT' },
      });
    } catch { /* fallback abaixo */ }

    const allMatches = await prisma.match.findMany({
      orderBy: { dateTime: 'asc' },
      include: {
        _count: { select: { players: true } },
      },
    });

    // Deduplica: mesmo home+away+date (±6h) → mantém o que tem mais jogadores.
    // Isso remove duplicatas criadas quando o scraper MLS encontra jogos do
    // Brasileirão e cria entradas com comp=mls e 0 jogadores.
    const DUP_WINDOW = 6 * 60 * 60 * 1000;
    const deduped: typeof allMatches = [];
    for (const m of allMatches) {
      let found = false;
      for (const existing of deduped) {
        const sameTeams =
          (existing.homeTeam === m.homeTeam && existing.awayTeam === m.awayTeam) ||
          (existing.homeTeam === m.awayTeam && existing.awayTeam === m.homeTeam);
        if (!sameTeams) continue;
        const dateDiff = Math.abs(existing.dateTime.getTime() - m.dateTime.getTime());
        if (dateDiff > DUP_WINDOW) continue;
        found = true;
        // Mantém o que tem mais jogadores
        if (m._count.players > existing._count.players) {
          Object.assign(existing, m);
        }
        break;
      }
      if (!found) deduped.push(m);
    }

    const lastScrape = await prisma.scrapeLog.findFirst({
      where: { status: { in: ['success', 'partial'] } },
      orderBy: { finishedAt: 'desc' },
    });

    const responseBody = {
      matches: deduped.map(m => ({
        id: m.id,
        dateTime: m.dateTime.toISOString(),
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        competition: m.competition,
        stage: m.stage,
        homeFlag: m.homeFlag,
        awayFlag: m.awayFlag,
        playerCount: m._count.players,
      })),
      mock: false,
      lastUpdated: lastScrape?.finishedAt?.toISOString() || null,
      scrapeStatus: lastScrape?.status || null,
    };

    // GET de listagem não deve disparar WS de “update” (só leitores) —
    // o scrape emite eventos reais quando os dados mudam.

    return NextResponse.json(responseBody, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    broadcastScrapeError(String(error))

    return NextResponse.json(
      { error: 'Erro ao buscar jogos', detail: String(error) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}
