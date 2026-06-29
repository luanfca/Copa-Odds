import { NextRequest, NextResponse } from 'next/server';
import {
  searchAthlete,
  getAthleteImage,
  getAthleteImageUrl,
  isNonPlayerRow,
} from '@/lib/scores365';

export const dynamic = 'force-dynamic';

// Foto do jogador via 365scores (Sofascore caiu por bloqueio Cloudflare).
// Resolve o atleta pelo nome (+ seleção, opcional) e devolve os bytes da imagem.
export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get('name') || '').trim();
  const team = (req.nextUrl.searchParams.get('team') || '').trim();
  const debug = req.nextUrl.searchParams.get('debug') === '1';

  if (!name) return new NextResponse(null, { status: 400 });

  // Linhas que não são jogador (ex.: "Menos de 27.5") não têm foto.
  if (isNonPlayerRow(name)) {
    if (debug) {
      return NextResponse.json({ query: { name, team }, skipped: 'non-player-row' });
    }
    return new NextResponse(null, { status: 404 });
  }

  const athlete = await searchAthlete(name, team || undefined);

  if (debug) {
    return NextResponse.json({
      query: { name, team },
      resolved: athlete,
      imageUrl: athlete ? getAthleteImageUrl(athlete.id, athlete.imageVersion) : null,
    });
  }

  if (!athlete) return new NextResponse(null, { status: 404 });

  const img = await getAthleteImage(athlete.id, athlete.imageVersion);
  if (!img) return new NextResponse(null, { status: 404 });

  return new NextResponse(img.buf, {
    status: 200,
    headers: {
      'Content-Type': img.contentType,
      'Cache-Control':
        'public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800',
    },
  });
}
