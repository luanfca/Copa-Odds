import { NextResponse } from 'next/server';
import { isScrapeRunning, setScrapeRunning } from '@/lib/cron';

// Chave de proteção lida do ambiente. Se não definida, o endpoint fica
// restrito apenas a chamadas internas (sem cabeçalho X-Scrape-Key configurado).
const SCRAPE_SECRET = process.env.SCRAPE_SECRET ?? '';

function isAuthorized(request: Request): boolean {
  if (!SCRAPE_SECRET) return true; // sem secret configurado → permite (ambiente local)
  const key = request.headers.get('x-scrape-key') ?? '';
  return key === SCRAPE_SECRET;
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      { error: 'Não autorizado. Forneça o cabeçalho x-scrape-key correto.' },
      { status: 401 }
    );
  }

  if (isScrapeRunning()) {
    return NextResponse.json(
      { error: 'Scraping já em execução. Aguarde.' },
      { status: 429 }
    );
  }

  // Marca como em execução ANTES de disparar a IIFE para evitar
  // janela de race condition entre o check e o start.
  setScrapeRunning(true);

  // Executa assincronamente sem bloquear a resposta HTTP.
  // O finally garante que isRunning volta para false mesmo em crash.
  (async () => {
    try {
      const { scrapeAll } = await import('@/scraping/index');
      await scrapeAll();
    } catch {
      // erro já logado dentro de scrapeAll
    } finally {
      setScrapeRunning(false);
    }
  })();

  return NextResponse.json({
    message: 'Scraping iniciado em background. Aguarde alguns minutos e recarregue a página.',
    startedAt: new Date().toISOString(),
  });
}

export async function GET() {
  const { prisma } = await import('@/lib/prisma');

  const lastLog = await prisma.scrapeLog.findFirst({
    orderBy: { startedAt: 'desc' },
    // Seleciona apenas campos públicos — omite errorMsg (pode conter stack trace interno)
    select: {
      id: true,
      startedAt: true,
      finishedAt: true,
      status: true,
      betfairOk: true,
      betmgmOk: true,
      superbetOk: true,
      matchCount: true,
      playerCount: true,
      oddCount: true,
    },
  });

  return NextResponse.json({
    isRunning: isScrapeRunning(),
    lastLog,
  });
}
