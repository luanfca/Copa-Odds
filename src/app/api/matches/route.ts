import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockMatches, mockOddsData } from '@/lib/mockData';

export async function GET() {
  try {
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      // Retorna dados mock enriquecidos
      const matches = mockMatches.map(m => {
        const matchOdds = mockOddsData.find(o => o.matchId === m.id);
        return { ...m, playerCount: matchOdds?.players.length || 0 };
      });
      return NextResponse.json({ matches, mock: true, lastUpdated: new Date().toISOString() });
    }

    // Busca do banco real
    const matches = await prisma.match.findMany({
      orderBy: { dateTime: 'asc' },
      include: {
        _count: { select: { players: true } },
      },
    });

    // Busca o último scrape bem-sucedido
    const lastScrape = await prisma.scrapeLog.findFirst({
      where: { status: { in: ['success', 'partial'] } },
      orderBy: { finishedAt: 'desc' },
    });

    return NextResponse.json({
      matches: matches.map(m => ({
        id: m.id,
        dateTime: m.dateTime.toISOString(),
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        stage: m.stage,
        homeFlag: m.homeFlag,
        awayFlag: m.awayFlag,
        playerCount: m._count.players,
      })),
      mock: false,
      lastUpdated: lastScrape?.finishedAt?.toISOString() || null,
      scrapeStatus: lastScrape?.status || null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao buscar jogos', detail: String(error) },
      { status: 500 }
    );
  }
}
