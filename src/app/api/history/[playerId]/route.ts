import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockHistoryData } from '@/lib/mockData';

export async function GET(
  _request: Request,
  { params }: { params: { playerId: string } }
) {
  try {
    const { playerId } = params;
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      const history = mockHistoryData[playerId as keyof typeof mockHistoryData] || [];
      return NextResponse.json({ history });
    }

    // Busca snapshots agrupados por dia para o histórico
    const snapshots = await prisma.oddSnapshot.findMany({
      where: { playerId },
      orderBy: { collectedAt: 'asc' },
      select: {
        house: true,
        line: true,
        value: true,
        collectedAt: true,
      },
    });

    // Agrupa por data + linha
    interface HistoryGroup {
      date: string;
      line: string;
      [house: string]: string | number;
    }
    const byDateLine = new Map<string, HistoryGroup>();

    for (const snap of snapshots) {
      const date = snap.collectedAt.toISOString().split('T')[0];
      const key = `${date}_${snap.line}`;
      const existing = byDateLine.get(key) || { date, line: snap.line };
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
