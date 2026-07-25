import { NextResponse } from 'next/server';
import { isScrapeRunning, setScrapeRunning, tryAcquireScrapeLock, releaseScrapeLock } from '@/lib/cron';

// Chave de proteção lida do ambiente.
const SCRAPE_SECRET = process.env.SCRAPE_SECRET ?? '';
const IS_PROD = process.env.NODE_ENV === 'production';

/**
 * Pré-aquece o cache de todos os mercados para as abas carregarem instantaneamente.
 * Chamado após a coleta completar.
 */
async function prewarmCache() {
  const endpoints: Array<{ path: string; params: Record<string, string> }> = [
    { path: '/api/desarmes', params: { market: 'desarmes' } },
    { path: '/api/desarmes', params: { market: 'desarmes', allComps: 'true' } },
    { path: '/api/desarmes', params: { market: 'faltas_cometidas' } },
    { path: '/api/desarmes', params: { market: 'faltas_cometidas', allComps: 'true' } },
    { path: '/api/desarmes', params: { market: 'faltas_sofridas' } },
    { path: '/api/desarmes', params: { market: 'faltas_sofridas', allComps: 'true' } },
    { path: '/api/desarmes', params: { market: 'finalizacao' } },
    { path: '/api/desarmes', params: { market: 'finalizacao', allComps: 'true' } },
    { path: '/api/desarmes', params: { market: 'chutes_ao_gol' } },
    { path: '/api/desarmes', params: { market: 'chutes_ao_gol', allComps: 'true' } },
    { path: '/api/value-odds', params: {} },
  ];

  // Sempre loopback — HOSTNAME no Windows/Linux costuma ser o nome da máquina.
  const port = process.env.PORT || '3000';
  const baseUrl = `http://127.0.0.1:${port}`;

  const CONCURRENCY = 3;
  for (let i = 0; i < endpoints.length; i += CONCURRENCY) {
    const batch = endpoints.slice(i, i + CONCURRENCY);
    await Promise.allSettled(
      batch.map(async ({ path, params }) => {
        try {
          const searchParams = new URLSearchParams(params);
          await fetch(`${baseUrl}${path}?${searchParams}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(60_000),
          });
        } catch {
          // pré-aquecimento best-effort
        }
      }),
    );
  }
}

function isAuthorized(request: Request): boolean {
  // Em produção, secret é obrigatório
  if (IS_PROD && !SCRAPE_SECRET) return false;
  if (!SCRAPE_SECRET) return true; // dev local sem secret
  const key = request.headers.get('x-scrape-key') ?? '';
  if (key === SCRAPE_SECRET) return true;

  // A ação manual parte do próprio painel. Assim, o segredo permanece
  // exclusivamente no servidor para os jobs internos, sem quebrar o botão
  // "Coletar" em uma instalação pública.
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  return Boolean(origin && host && origin === `https://${host}`);
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error: IS_PROD && !SCRAPE_SECRET
          ? 'SCRAPE_SECRET não configurado no servidor.'
          : 'Não autorizado. Forneça o cabeçalho x-scrape-key correto.',
      },
      { status: 401 },
    );
  }

  if (isScrapeRunning()) {
    return NextResponse.json(
      { error: 'Scraping já em execução. Aguarde.' },
      { status: 429 },
    );
  }

  // Lock em DB + memória (multi-worker / restart mid-scrape)
  const locked = await tryAcquireScrapeLock();
  if (!locked) {
    return NextResponse.json(
      { error: 'Scraping já em execução (lock). Aguarde.' },
      { status: 429 },
    );
  }
  setScrapeRunning(true);

  try {
    // Em hospedagens que encerram o contexto da rota após enviar a resposta
    // (como instâncias gratuitas), uma Promise solta não chega a executar.
    // Esperar a coleta torna a execução confiável e mantém o lock durável.
    const { scrapeAll } = await import('@/scraping/index');
    const result = await scrapeAll();
    // Snapshots já são rebuildados no final do scrapeAll (apiSnapshot).
    prewarmCache().catch(() => null);

    return NextResponse.json({
      message: result.success
        ? 'Varredura concluída com sucesso.'
        : 'Varredura concluída, mas nenhuma fonte retornou dados.',
      result,
      finishedAt: new Date().toISOString(),
    }, { status: result.success ? 200 : 502 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Falha ao executar a varredura.', details: String(error) },
      { status: 500 },
    );
  } finally {
    setScrapeRunning(false);
    await releaseScrapeLock();
  }
}

export async function GET() {
  const { prisma } = await import('@/lib/prisma');

  const lastLog = await prisma.scrapeLog.findFirst({
    orderBy: { startedAt: 'desc' },
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
