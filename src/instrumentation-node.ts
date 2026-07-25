/**
 * Instrumentation hook — inicia o pré-aquecimento do cache SofaScore
 * e o cron de scraping diário assim que o servidor Next.js inicializar.
 *
 * O pre-warm roda em background (fire-and-forget), sem bloquear o startup.
 * Após a primeira leva, as páginas de desarmes/faltas/finalizacao carregam
 * instantaneamente porque o cache SQLite já está populado.
 *
 * O cron faz scraping automático via HTTP (fetch para /api/scrape),
 * evitando importar módulos Node.js pesados que quebram o build do Next.js.
 */

export async function registerNodeRuntime() {
  // O hook também é carregado por workers de build. Serviços persistentes só
  // devem existir no processo Node que serve a aplicação.
  if (isBuildProcess()) return;

  const globalState = globalThis as typeof globalThis & {
    __ODDS_INSTRUMENTATION_STARTED__?: boolean;
  };
  if (globalState.__ODDS_INSTRUMENTATION_STARTED__) return;
  globalState.__ODDS_INSTRUMENTATION_STARTED__ = true;

  // 0) WebSocket em porta separada. A inicialização é idempotente.
  import('@/lib/ws-server')
    .then(({ wsServer }) => wsServer.initialize())
    .catch((err) => {
      console.error('[instrumentation] WebSocket:', String(err));
    });

  // 1) Snapshots de ranking no SQLite → páginas instantâneas após restart
  //    (só rebuilda se ainda não existirem; scrape novo sempre regrava)
  import('@/lib/apiSnapshot').then(async ({ getApiSnapshot, rebuildApiSnapshots }) => {
    const existing = await getApiSnapshot('matches');
    if (!existing) {
      console.log('[instrumentation] Sem ApiSnapshot — rebuild leve do banco...');
      await rebuildApiSnapshots();
      console.log('[instrumentation] ApiSnapshots prontos');
    } else {
      console.log('[instrumentation] ApiSnapshots já existem — UI instantânea');
    }
  }).catch((err) => {
    console.error('[instrumentation] ApiSnapshot:', String(err));
  });

  // 2) O histórico agora é preenchido como parte do lote diário. O prewarm no
  // startup fica opt-in para não disputar CPU com o site nem repetir chamadas.
  if (process.env.PREWARM_ON_START === 'true') {
    import('@/lib/prewarm').then(({ prewarmSofaScoreCache }) => {
      prewarmSofaScoreCache();
    }).catch((err) => {
      console.error('[instrumentation] Erro ao iniciar prewarm:', String(err));
    });
  }

  // 3) Cron de scraping via HTTP
  initAutoScrape();
}

function isBuildProcess(): boolean {
  return (
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.npm_lifecycle_event === 'build' ||
    process.argv.some((arg) => arg === 'build')
  );
}

/**
 * Inicia scheduler de scraping automático.
 * Faz scraping a cada intervalo (default: 4h) chamando /api/scrape via HTTP.
 */
function initAutoScrape(intervalMs = 4 * 60 * 60 * 1000): void {
  if (process.env.AUTO_SCRAPE_ENABLED === 'false') {
    console.log('[auto-scrape] Scheduler interno desativado; usando agenda externa diária.');
    return;
  }
  const schedule = process.env.CRON_SCHEDULE;
  if (schedule) {
    // Tenta interpretar CRON_SCHEDULE como intervalo em ms
    const parsed = parseInt(schedule, 10);
    if (!isNaN(parsed) && parsed > 0) {
      intervalMs = parsed;
    } else {
      console.warn(`[auto-scrape] AVISO: CRON_SCHEDULE="${schedule}" nao e um numero (ms). Usando ${intervalMs / 1000 / 60 / 60}h. Defina CRON_SCHEDULE como ms (ex: 3600000 = 1h)`);
    }
  }

  console.log(`[auto-scrape] Agendado a cada ${intervalMs / 1000 / 60 / 60}h`);

  // Primeira execução: aguarda 30s para o servidor estabilizar,
  // MAS verifica se já foi coletado hoje (evita re-coleta ao reiniciar)
  setTimeout(async () => {
    if (await wasRecentlyScraped()) {
      console.log('[auto-scrape] Coleta recente detectada (< 2h). Pulando primeira execução.');
      return;
    }
    doScrape();
  }, 30_000);

  // Execuções periódicas
  setInterval(() => doScrape(), intervalMs);
}

/**
 * Verifica se houve scraping nas últimas 2 horas.
 * Se sim, pula a coleta inicial (evita re-scraping ao reiniciar o servidor).
 */
async function wasRecentlyScraped(): Promise<boolean> {
  try {
    const { prisma } = await import('@/lib/prisma');
    const lastLog = await prisma.scrapeLog.findFirst({
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true, status: true },
    });
    if (!lastLog?.finishedAt) return false;
    if (lastLog.status === 'running') return false;
    const elapsed = Date.now() - lastLog.finishedAt.getTime();
    const twoHours = 2 * 60 * 60 * 1000;
    return elapsed < twoHours;
  } catch {
    return false; // em caso de erro, tenta scrapy mesmo assim
  }
}

/**
 * Dispara scraping chamando /api/scrape internamente.
 * Usa o host interno do Next.js para evitar fila de rede externa.
 */
async function doScrape(): Promise<void> {
  try {
    // Sempre loopback — HOSTNAME no SO é o nome da máquina, não 127.0.0.1
    const port = process.env.PORT || '3000';
    const url = `http://127.0.0.1:${port}/api/scrape`;

    const headers: Record<string, string> = {};
    const secret = process.env.SCRAPE_SECRET;
    if (secret) headers['x-scrape-key'] = secret;

    const res = await fetch(url, {
      method: 'POST',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(60 * 60_000), // lote diário completo: até 60 min
    });

    if (res.ok) {
      const data = await res.json();
      console.log(`[auto-scrape] OK: ${data.message || 'scraping iniciado'}`);
    } else {
      console.warn(`[auto-scrape] HTTP ${res.status}: ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    // Ignora erro (servidor pode não estar pronto ainda)
    console.error('[auto-scrape] Erro:', String(err));
  }
}
