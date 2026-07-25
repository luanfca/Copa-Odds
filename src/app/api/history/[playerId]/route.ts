import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockHistoryData } from '@/lib/mockData';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ playerId: string }> }
) {
  try {
    const { playerId } = await params;
    const url = new URL(request.url);
    const market = url.searchParams.get('market') ?? undefined;
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      const history = mockHistoryData[playerId as keyof typeof mockHistoryData] || [];
      return NextResponse.json({ history });
    }

    // Busca snapshots agrupados por dia para o histórico (filtra mercado se informado)
    const snapshots = await prisma.oddSnapshot.findMany({
      where: {
        playerId,
        ...(market ? { market } : {}),
      },
      orderBy: { collectedAt: 'asc' },
      select: {
        house: true,
        line: true,
        value: true,
        market: true,
        collectedAt: true,
      },
    });

    // Agrupa por data + linha (+ mercado se não filtrado)
    interface HistoryGroup {
      date: string;
      line: string;
      market?: string;
      [house: string]: string | number | undefined;
    }
    const byDateLine = new Map<string, HistoryGroup>();

    for (const snap of snapshots) {
      const date = snap.collectedAt.toISOString().split('T')[0];
      const key = market
        ? `${date}_${snap.line}`
        : `${date}_${snap.market}_${snap.line}`;
      const existing = byDateLine.get(key) || {
        date,
        line: snap.line,
        ...(market ? {} : { market: snap.market }),
      };
      existing[snap.house] = snap.value;
      byDateLine.set(key, existing);
    }

    const history = Array.from(byDateLine.values());

    return NextResponse.json({ history });
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao buscar histórico', detail: String(error) },
      { status: 500 }
    );
  }
}
