/**
 * API endpoint para estatísticas do SofaScore.
 *
 * GET /api/sofascore-stats?eventId=123       → stats de um jogo
 * GET /api/sofascore-stats?homeTeam=X&awayTeam=Y&date=2026-07-11  → resolve e retorna
 * GET /api/sofascore-stats?live=true          → stats dos jogos ao vivo
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getLiveSofascoreEvents,
  getSofascoreMatchStats,
  resolveSofascoreEventId,
} from '@/lib/sofascoreStats';

export const dynamic = 'force-dynamic';

// Cache simples para evitar chamadas repetidas
const statsCache = new Map<string, { data: unknown; t: number }>();
const CACHE_TTL = 300_000; // 5 minutos

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  try {
    // Stats de um jogo específico
    const eventIdParam = url.searchParams.get('eventId');
    if (eventIdParam) {
      const eventId = Number(eventIdParam);
      if (isNaN(eventId)) return NextResponse.json({ error: 'eventId inválido' }, { status: 400 });

      const cacheKey = `event_${eventId}`;
      const cached = statsCache.get(cacheKey);
      if (cached && Date.now() - cached.t < CACHE_TTL) {
        return NextResponse.json(cached.data);
      }

      const stats = await getSofascoreMatchStats(eventId);
      if (!stats) return NextResponse.json({ error: 'Sem dados' }, { status: 404 });

      statsCache.set(cacheKey, { data: stats, t: Date.now() });
      return NextResponse.json(stats);
    }

    // Resolver por nomes dos times + data
    const homeTeam = url.searchParams.get('homeTeam');
    const awayTeam = url.searchParams.get('awayTeam');
    const date = url.searchParams.get('date');

    if (homeTeam && awayTeam && date) {
      const cacheKey = `resolve_${homeTeam}_${awayTeam}_${date}`;
      const cached = statsCache.get(cacheKey);
      if (cached && Date.now() - cached.t < CACHE_TTL) {
        return NextResponse.json(cached.data);
      }

      const eventId = await resolveSofascoreEventId(homeTeam, awayTeam, date);
      if (!eventId) return NextResponse.json({ error: 'Jogo não encontrado' }, { status: 404 });
      const stats = await getSofascoreMatchStats(eventId);
      if (!stats) return NextResponse.json({ error: 'Sem dados' }, { status: 404 });

      statsCache.set(cacheKey, { data: stats, t: Date.now() });
      return NextResponse.json(stats);
    }

    // Todos jogos ao vivo
    if (url.searchParams.get('live') === 'true') {
      const events = await getLiveSofascoreEvents();
      const results = await Promise.all(
        events.slice(0, 10).map(async (ev) => ({
          eventId: ev.id,
          homeTeam: ev.homeTeam.name,
          awayTeam: ev.awayTeam.name,
          homeScore: ev.homeScore.current,
          awayScore: ev.awayScore.current,
          status: ev.status.description,
          stats: await getSofascoreMatchStats(ev.id),
        })),
      );
      return NextResponse.json({ matches: results, total: events.length });
    }

    return NextResponse.json({ error: 'Parâmetros: eventId, ou homeTeam+awayTeam+date, ou live=true' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: 'Erro ao buscar stats', detail: String(error) }, { status: 500 });
  }
}
