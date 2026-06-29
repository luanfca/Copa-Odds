/**
 * Endpoint HTTP que recebe o JSON enviado pelo scraper Python (nodriver).
 *
 * O scraper Python não chama o orquestrador central (`/api/scrape`) porque
 * roda em processo separado. Em vez disso, ele coleta as odds, normaliza no
 * formato `ScrapedMatch` (igual aos outros adapters) e envia para cá.
 *
 * Este handler reusa `persistScrapedData` de `src/scraping/index.ts` para
 * gravar no Prisma — zero duplicação da lógica de banco.
 *
 * Formato esperado do body:
 * ```json
 * {
 *   "matches": [
 *     {
 *       "homeTeam": "Brasil",
 *       "awayTeam": "Croácia",
 *       "dateTime": "2026-06-12T20:00:00Z",
 *       "stage": "Copa do Mundo 2026",
 *       "odds": [
 *         { "playerName": "Casemiro", "team": "Brasil",
 *           "line": "1+", "value": 1.85, "house": "bet365",
 *           "market": "desarmes", "url": "..." }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * Autenticação: header `x-scrape-key` (deve bater com `SCRAPE_SECRET` no
 * `.env` do Next). Se `SCRAPE_SECRET` não estiver definido, o endpoint fica
 * aberto (mesma política de `/api/scrape`).
 */

import { NextResponse } from 'next/server';
import { persistScrapedData } from '@/scraping/index';
import type { ScrapedMatch } from '@/types/scraping';

const SCRAPE_SECRET = process.env.SCRAPE_SECRET ?? '';

function isAuthorized(request: Request): boolean {
  if (!SCRAPE_SECRET) return true;
  return request.headers.get('x-scrape-key') === SCRAPE_SECRET;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Não autorizado. Forneça o cabeçalho x-scrape-key correto.' },
      { status: 401 },
    );
  }

  let body: { matches?: ScrapedMatch[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Body inválido. Esperado JSON com { matches: ScrapedMatch[] }.' },
      { status: 400 },
    );
  }

  const matches = body?.matches;
  if (!Array.isArray(matches)) {
    return NextResponse.json(
      { error: 'Campo "matches" ausente ou não é array.' },
      { status: 400 },
    );
  }

  if (matches.length === 0) {
    return NextResponse.json({
      ok: true,
      matchCount: 0,
      playerCount: 0,
      oddCount: 0,
    });
  }

  try {
    // Converte dateTime string → Date para o Prisma
    const normalized: ScrapedMatch[] = matches.map((m) => ({
      ...m,
      dateTime: new Date(m.dateTime),
    }));

    const stats = await persistScrapedData(normalized);
    return NextResponse.json({ ok: true, ...stats });
  } catch (error) {
    return NextResponse.json(
      { error: 'Falha ao persistir', detail: String(error) },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    endpoint: 'bet365-nodriver',
    description:
      'POST endpoint que recebe odds do scraper Python (nodriver) e persiste via persistScrapedData.',
    auth: SCRAPE_SECRET ? 'required (x-scrape-key)' : 'disabled (no SCRAPE_SECRET)',
  });
}
