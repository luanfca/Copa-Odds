/**
 * Adaptador de scraping para Betfair Brasil (betfair.bet.br).
 *
 * Estratégia:
 * 1. Intercepta chamadas XHR/fetch da SPA para capturar dados JSON diretamente.
 * 2. Navega até a seção Copa do Mundo e entra em cada jogo.
 * 3. Clica na aba "Jogador" e rola a página para carregar mercados lazy-loaded.
 * 4. Extrai odds de desarmes e faltas dos dados capturados via event listener.
 *
 * Anti-bot: Betfair usa Akamai Bot Manager. Usamos:
 * - User-Agent de browser real
 * - Contexto persistente (cookies salvos entre sessões)
 * - Delays aleatórios entre ações
 *
 * MUDANÇAS vs versão anterior:
 * - REMOVIDO: interfaces ScrapedOdd/ScrapedMatch locais → usa src/types/scraping.ts
 * - REMOVIDO: extractStage() local duplicada → usa normalize.ts
 * - MANTIDO: toda a lógica de browser/Playwright (necessária para autenticação)
 */

import { BrowserContext, Page } from 'playwright';
import { logger } from '../lib/logger';
import { normalizeLine, extractStage } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';

// ─── Configuração ─────────────────────────────────────────────────────────────

const BETFAIR_BASE = 'https://www.betfair.bet.br';
const COPA_URL = `${BETFAIR_BASE}/apostas/futebol/copa-do-mundo-fifa/c-12469077`;

const COPA_KEYWORDS = [
  'copa do mundo', 'world cup', 'fifa world cup', 'copa mundo',
  'mundial', 'wcq', 'world cup 2026',
] as const;

const TACKLE_KEYWORDS = [
  'desarme', 'tackle', 'abordagem', 'desarm',
  'falta', 'foul', 'comete', 'sofre', 'corte', 'cortes',
] as const;

const NAV_TIMEOUT = 30_000;
const PAGE_TIMEOUT_MS = parseInt(process.env.PLAYWRIGHT_TIMEOUT ?? '45000', 10);
const SCROLL_ITERATIONS = 10;
const SCROLL_WAIT_MS = 800;

const randomDelay = (min: number, max: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

// ─── CSS para suprimir o banner de cookies OneTrust ───────────────────────────
const ONETRUST_CSS = `
  #onetrust-consent-sdk,
  .onetrust-pc-dark-filter,
  .ot-sdk-container,
  #onetrust-banner-sdk {
    display: none !important;
    visibility: hidden !important;
    pointer-events: none !important;
    opacity: 0 !important;
  }
`;

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping Betfair.
 * Recebe um BrowserContext configurado com cookies e user-agent adequados.
 */
export async function scrapeBetfair(context: BrowserContext): Promise<ScrapedMatch[]> {
  const results: ScrapedMatch[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capturedApiData: Array<{ url: string; data: unknown; pageUrl?: string }> = [];

  logger.info('[Betfair] Iniciando scraping...');

  let mainPage: Page | undefined;
  try {
    mainPage = await createScrapingPage(context, capturedApiData);

    // Navega para a página de futebol primeiro (warm-up de sessão)
    logger.info('[Betfair] Navegando para futebol...');
    await mainPage.goto(`${BETFAIR_BASE}/apostas/futebol/s-1`, {
      waitUntil: 'domcontentloaded',
      timeout: PAGE_TIMEOUT_MS,
    });

    await suppressCookieBanner(mainPage);
    await randomDelay(1_500, 3_000);

    // Navega para a Copa e coleta odds usando múltiplas páginas em paralelo
    const copaMatches = await scrapeCopaMatches(mainPage, context, capturedApiData);
    results.push(...copaMatches);

  } catch (error) {
    logger.error('[Betfair] Erro durante scraping:', { error: String(error) });
  } finally {
    if (mainPage) {
      await mainPage.close().catch(() => null);
    }
  }

  logger.info(`[Betfair] Scraping finalizado. ${results.length} jogos encontrados.`);
  return results;
}

// ─── Funções internas ─────────────────────────────────────────────────────────

/** Cria uma nova página no contexto, configura headers e escuta as respostas da API. */
async function createScrapingPage(
  context: BrowserContext,
  capturedApiData: Array<{ url: string; data: unknown; pageUrl?: string }>,
): Promise<Page> {
  const page = await context.newPage();

  // Intercepta respostas de API para capturar dados JSON
  page.on('response', async (response) => {
    const url = response.url();
    const status = response.status();
    const contentType = response.headers()['content-type'] ?? '';

    if (
      status === 200 &&
      contentType.includes('application/json') &&
      (
        url.includes('/api/') ||
        url.includes('/exchange/') ||
        url.includes('/sports/') ||
        url.includes('/betting/') ||
        url.includes('/graphql/') ||
        url.includes('smp.betfair') ||
        url.includes('sib.betfair') ||
        url.includes('apitbd.betfair') ||
        url.includes('sca.betfair')
      )
    ) {
      try {
        const json = await response.json();
        capturedApiData.push({ url, data: json, pageUrl: page.url() });
        logger.debug(`[Betfair] API capturada: ${url}`);
      } catch {
        // Ignora erros de parse (body já consumido ou resposta inválida)
      }
    }
  });

  // Configura headers para parecer browser real
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  });

  return page;
}

/** Remove/oculta o cookie banner OneTrust para não bloquear cliques. */
async function suppressCookieBanner(page: Page): Promise<void> {
  await page.addStyleTag({ content: ONETRUST_CSS }).catch((err) => {
    logger.warn('[Betfair] Falha ao injetar CSS do cookie banner', { error: String(err) });
  });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button'))
      .find(b => b.innerText?.toLowerCase().includes('aceitar todos'));
    btn?.click();
    document.getElementById('onetrust-consent-sdk')?.remove();
    document.querySelector('.onetrust-pc-dark-filter')?.remove();
  }).catch((err) => {
    logger.warn('[Betfair] Falha ao suprimir cookie banner no evaluate', { error: String(err) });
  });
}

/** Navega para a Copa do Mundo, entra em cada jogo e extrai odds. */
async function scrapeCopaMatches(
  page: Page,
  context: BrowserContext,
  capturedData: Array<{ url: string; data: unknown; pageUrl?: string }>,
): Promise<ScrapedMatch[]> {
  const matches: ScrapedMatch[] = [];

  try {
    logger.info(`[Betfair] Navegando para a Copa: ${COPA_URL}`);
    await page.goto(COPA_URL, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
    await page.waitForTimeout(2_000);

    // Coleta links de eventos individuais na página da Copa
    const matchLinks: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href?.includes('/e-') || href?.includes('/event-'))
    );

    const uniqueMatchLinks = Array.from(new Set(matchLinks))
      .filter(url => /\/e-\d+/.test(url))
      .map(url => {
        // Descodifica redirects (url=...)
        let targetUrl = url;
        if (url.includes('url=')) {
          targetUrl = decodeURIComponent(url.split('url=')[1].split('&')[0]);
        }
        // Anexa o tabId de jogador para carregar diretamente a aba correta
        if (!targetUrl.includes('tabId=')) {
          const sep = targetUrl.includes('?') ? '&' : '?';
          targetUrl = `${targetUrl}${sep}tabId=Z-bRZxIAACEAOg6I#jogador`;
        }
        return targetUrl;
      });

    logger.info(`[Betfair] ${uniqueMatchLinks.length} jogos da Copa para navegar.`);

    // Navega em paralelo limitando a concorrência a 3 páginas simultâneas
    const CONCURRENCY_LIMIT = 3;
    const activePromises: Promise<void>[] = [];

    for (const matchUrl of uniqueMatchLinks) {
      if (activePromises.length >= CONCURRENCY_LIMIT) {
        await Promise.race(activePromises);
      }

      const p = (async () => {
        const matchPage = await createScrapingPage(context, capturedData);
        try {
          await scrapeMatchPage(matchPage, matchUrl, capturedData);
        } catch (error) {
          logger.error(`[Betfair] Falha ao processar jogo ${matchUrl}:`, { error: String(error) });
        } finally {
          await matchPage.close().catch(() => null);
        }
      })();

      activePromises.push(p);
      p.then(() => {
        const index = activePromises.indexOf(p);
        if (index > -1) activePromises.splice(index, 1);
      });
    }

    await Promise.all(activePromises);

  } catch (error) {
    logger.warn('[Betfair] Falha na navegação de jogos:', { error: String(error) });
  }

  // Primeiro, monta um mapa global com todas as odds do getMarketPrices capturadas
  const marketPricesMap = new Map<string, number>();
  for (const captured of capturedData) {
    const { url, data } = captured;
    if (url && url.includes('getMarketPrices') && Array.isArray(data)) {
      for (const marketPrice of data) {
        const marketId = marketPrice.marketId;
        if (!marketId) continue;
        const runnerDetails = marketPrice.runnerDetails ?? [];
        for (const runner of runnerDetails) {
          const selectionId = runner.selectionId;
          const odd = runner.runnerOdds?.decimalDisplayOdds?.decimalOdds ?? runner.winRunnerOdds?.decimalDisplayOdds?.decimalOdds;
          if (odd && odd > 1) {
            marketPricesMap.set(`${marketId}_${selectionId}`, odd);
          }
        }
      }
    }
  }

  // Extrai dados de todas as APIs capturadas durante a navegação
  for (const captured of capturedData) {
    const apiMatches = extractMatchesFromApiData(captured, marketPricesMap);
    matches.push(...apiMatches);
  }

  return matches;
}

/** Navega para a página de um jogo específico e aciona o carregamento dos mercados. */
async function scrapeMatchPage(page: Page, matchUrl: string, capturedData: Array<{ url: string; data: unknown; pageUrl?: string }>): Promise<void> {
  try {
    logger.info(`[Betfair] Navegando para o jogo: ${matchUrl}`);
    await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT }).catch(() => null);
    await page.waitForTimeout(1_500);

    await suppressCookieBanner(page);

    await page.evaluate(() => {
      try {
        const targetKeywords = ['jogador', 'estatísticas', 'faltas', 'desarmes', 'especiais'];
        const allElements = Array.from(document.querySelectorAll('*'));
        const leaves = allElements.filter(el => {
          if (el.children.length > 0) return false;
          const txt = el.textContent?.trim().toLowerCase() || '';
          // Precisamos de correspondência exata para não clicar em textos muito longos
          return targetKeywords.some(kw => txt === kw || (txt.includes(kw) && txt.length < 25));
        });
        
        if (leaves.length > 0) {
          (leaves[0] as HTMLElement).click();
        }
      } catch (e) { }
    });

    await page.waitForTimeout(1_000);

    // Rola a página para carregar mercados lazy-loaded
    for (let i = 0; i < SCROLL_ITERATIONS; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 800);

        // Rola contêineres com scroll interno
        const scrollables = Array.from(document.querySelectorAll('div')).filter(el => {
          const style = window.getComputedStyle(el);
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight;
        });
        scrollables.forEach(div => {
          try { div.scrollBy(0, 800); } catch { /* ignora */ }
        });
      });
      await page.waitForTimeout(SCROLL_WAIT_MS);
    }

    // Clica em "Mostrar mais" apenas após rolar tudo, para não esticar a página antes do scroll alcançar o fim
    await page.evaluate(() => {
      Array.from(document.querySelectorAll<HTMLElement>('button, span, a'))
        .filter(btn => btn.innerText?.toLowerCase().includes('mostrar mais'))
        .forEach(btn => { try { btn.click(); } catch { /* ignora */ } });
    });
    await page.waitForTimeout(1_500);

    await page.waitForTimeout(1_000);

    // Extrai odds do DOM renderizado (mais confiável que XHR)
    const domResult = await extractOddsFromDom(page, matchUrl);
    if (domResult.odds.length > 0) {
      capturedData.push({
        url: matchUrl,
        data: { _domOdds: domResult.odds, _homeTeam: domResult.homeTeam, _awayTeam: domResult.awayTeam },
        pageUrl: matchUrl,
      });
    }

    // Extrai dados SSR (Server-Side Rendered) que não foram pegos por interceptação XHR
    const ssrData = await page.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).__TBD_PRELOADED_CATALOG__;
    }).catch(() => null);

    if (ssrData) {
      capturedData.push({
        url: matchUrl,
        data: ssrData,
        pageUrl: matchUrl,
      });
    }

  } catch (error) {
    logger.warn(`[Betfair] Erro ao navegar para ${matchUrl}:`, { error: String(error) });
  }
}

// ─── Extração de odds do DOM renderizado ─────────────────────────────────────

/**
 * Extrai odds de desarmes do DOM usando walkShadow recursivo.
 * O Shadow DOM não é acessível via page.locator para odds internos.
 * Usa function declaration anônima dentro de page.evaluate para evitar erro __name do TS.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractOddsFromDom(page: Page, matchUrl: string): Promise<{ odds: any[]; homeTeam: string; awayTeam: string }> {
  const odds: any[] = [];
  let homeTeam = '';
  let awayTeam = '';

  try {
    // Extrai times da URL (/brasil-x-japão/) — title tem texto extra que confunde parse
    var urlParts = matchUrl.toLowerCase().split('/');
    var slugPart = '';
    for (var u = 0; u < urlParts.length; u++) {
      if (urlParts[u].includes('-x-') && urlParts[u].length < 60) { slugPart = urlParts[u]; break; }
    }
    if (slugPart) {
      var teamSlugs = slugPart.split('-x-');
      homeTeam = decodeURIComponent(teamSlugs[0] || '').replace(/-/g, ' ');
      awayTeam = decodeURIComponent(teamSlugs[1] || '').split('?')[0].replace(/-/g, ' ');
      // Capitaliza primeira letra de cada palavra
      homeTeam = homeTeam.replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });
      awayTeam = awayTeam.replace(/\b\w/g, function(c: string) { return c.toUpperCase(); });
    }

    // Remove cookie banner que bloqueia scroll
    await page.evaluate(function() {
      var sdk = document.getElementById('onetrust-consent-sdk');
      if (sdk) sdk.remove();
      var filter = document.querySelector('.onetrust-pc-dark-filter');
      if (filter) filter.remove();
    }).catch(function() {});

    // Rola extensivamente para carregar seções lazy
    for (var i = 0; i < 12; i++) {
      await page.evaluate(function() {
        window.scrollBy(0, 800);
        var scrollables = Array.from(document.querySelectorAll('div')).filter(function(el) {
          var style = window.getComputedStyle(el);
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight;
        });
        scrollables.forEach(function(div) { try { div.scrollBy(0, 800); } catch(e) {} });
      });
      await page.waitForTimeout(400);
    }

    // Extrai textos do Shadow DOM (usa stack iterativo para evitar __name do TS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    var allTexts = await page.evaluate(function(): string[] {
      var result: string[] = [];
      var stack: any[] = [document.documentElement];
      while (stack.length) {
        var node = stack.pop();
        if (node.shadowRoot) { try { stack.push(node.shadowRoot); } catch(e) {} }
        for (var i = 0; i < node.childNodes.length; i++) {
          var c = node.childNodes[i];
          if (c.nodeType === 3) {
            var t = (c.textContent || '').trim();
            if (t.length > 0) result.push(t);
          } else if (c.nodeType === 1) { stack.push(c); }
        }
      }
      return result;
    });

    // Localiza seção "Desarmes do jogador"
    var secStart = -1;
    var secEnd = allTexts.length;
    var terminators = ['cartões do jogador', 'chutes no gol do jogador', 'envolvimentos do jogador', 'faltas do jogador', 'gols do jogador', 'escanteios do jogador'];
    for (var i = 0; i < allTexts.length; i++) {
      var lower = allTexts[i].toLowerCase();
      if (lower.includes('desarmes do jogador') || lower === 'desarmes') {
        secStart = i;
      }
      if (secStart >= 0 && i > secStart + 1 && terminators.some(function(t) { return lower.startsWith(t); })) {
        secEnd = i;
        break;
      }
    }

    if (secStart < 0) {
      logger.debug('[Betfair] DOM: seção "Desarmes" não encontrada');
      return { odds, homeTeam, awayTeam };
    }

    var section = allTexts.slice(secStart, secEnd);
    logger.debug('[Betfair] DOM: seção Desarmes com ' + section.length + ' textos');

    // Parse linear: detecta headers "N+" e aplica para jogadores seguintes
    var skipPattern = /^(Mostrar|Acima|Abaixo|Desarmes|Mais|Menos|Cartões|Chutes|Faltas|Gols|Escanteios|Substituição|Tempo|Primeiro|Cada|A - Z|Jogador|Jogador comete|1\+|2\+|3\+|4\+|\d+[\.,]?\d*)$/i;

    var idx = 0;
    var currentCols: number[] = [];
    while (idx < section.length) {
      var txt = section[idx];

      // Detecta header de coluna (1+, 2+, etc.) — atualiza colunas atuais
      var headerMatch = txt.match(/^([1-4])\+$/);
      if (headerMatch) {
        var colNum = parseInt(headerMatch[1]);
        // Se já temos 2+ colunas e encontramos um header novo, é novo sub-grupo
        if (currentCols.length >= 2 || (currentCols.length > 0 && colNum <= currentCols[currentCols.length - 1])) {
          currentCols = [];
        }
        currentCols.push(colNum);
        idx++;
        continue;
      }

      // Se não temos colunas definidas, pula
      if (currentCols.length === 0) {
        idx++;
        continue;
      }

      var isPlayerName = txt.length >= 3 && txt.length <= 40 && /^[A-ZÀ-Ü]/.test(txt) && !skipPattern.test(txt);

      if (isPlayerName) {
        var name = txt;
        var vals = [];
        var j = idx + 1;
        while (j < section.length && j < idx + 10) {
          var next = section[j];
          // Para se encontrar header, nome de jogador, ou fim
          if (/^[1-4]\+$/.test(next)) break;
          var isNextName = next.length >= 3 && next.length <= 40 && /^[A-ZÀ-Ü]/.test(next) && !skipPattern.test(next);
          if (isNextName) break;
          var v = parseFloat(next.replace(',', '.'));
          if (!isNaN(v) && v > 1 && v < 500) vals.push(v);
          j++;
        }
        for (var c = 0; c < Math.min(vals.length, currentCols.length); c++) {
          var lineNorm = normalizeLine(currentCols[c] + '+');
          if (lineNorm && vals[c] > 1) {
            odds.push({
              playerName: name,
              team: homeTeam || '',
              line: lineNorm,
              value: vals[c],
              house: 'betfair',
              market: 'desarmes',
              url: matchUrl,
            });
          }
        }
      }
      idx++;
    }

    if (odds.length > 0) {
      logger.info('[Betfair] DOM extraiu ' + odds.length + ' odds de desarmes');
    }
  } catch (err) {
    logger.debug('[Betfair] DOM extract error: ' + err);
  }

  return { odds, homeTeam, awayTeam };
}

// ─── Extração de dados da API capturada ──────────────────────────────────────

/**
 * Processa um payload de API capturado e extrai ScrapedMatches.
 * Suporta duas estruturas:
 * 1. Betfair Sportsbook BFF (GraphQL) — `data.Cards[]`
 * 2. Betfair Exchange API — `event.name + runners[]`
 */
function extractMatchesFromApiData(
  captured: { url: string; data: unknown; pageUrl?: string },
  marketPricesMap: Map<string, number>,
): ScrapedMatch[] {
  const matches: ScrapedMatch[] = [];
  const { data, pageUrl } = captured;

  if (!data) return matches;

  const items = Array.isArray(data) ? data : [data];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = item as Record<string, any>;

    // ── Formato 1: Betfair Sportsbook BFF (GraphQL) ──
    // Pode vir via XHR (`data.Cards`) ou via SSR (`data.PebbleCardGroup`, `data.GenericSwitcherCard`)
    let cards: any[] = [];
    if (Array.isArray(obj.data?.Cards)) {
      cards = cards.concat(obj.data.Cards);
    }
    if (Array.isArray(obj.data?.PebbleCardGroup)) {
      cards = cards.concat(obj.data.PebbleCardGroup);
    }
    if (Array.isArray(obj.data?.GenericSwitcherCard)) {
      cards = cards.concat(obj.data.GenericSwitcherCard);
    }
    
    if (cards.length > 0) {
      for (const card of cards) {
        const extracted = extractFromBffCard(card, pageUrl, marketPricesMap);
        matches.push(...extracted);
      }
    }

    // ── Formato 2: Betfair Exchange API ──
    if (obj.event && typeof obj.event === 'object') {
      const extracted = extractFromExchangeEvent(obj, pageUrl);
      if (extracted) matches.push(extracted);
    }

    // ── Formato 3: Odds extraídas do DOM renderizado ──
    if (Array.isArray(obj._domOdds) && obj._domOdds.length > 0) {
      const homeTeam = obj._homeTeam || '';
      const awayTeam = obj._awayTeam || '';
      matches.push({
        homeTeam,
        awayTeam,
        dateTime: new Date(),
        stage: extractStage(pageUrl ?? ''),
        odds: obj._domOdds,
      });
    }
  }

  return matches;
}

/** Extrai matches de um card do formato BFF (Betfair Sportsbook GraphQL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromBffCard(card: any, pageUrl?: string, marketPricesMap?: Map<string, number>): ScrapedMatch[] {
  const matches: ScrapedMatch[] = [];
  if (!card || typeof card !== 'object') return matches;

  const cardTitle: string = String(
    card.cardGroupTitle ?? card.pebbleCardGroupTitle?.translated ?? '',
  ).toLowerCase();

  const isTackleCard = TACKLE_KEYWORDS.some(kw => cardTitle.includes(kw));
  const isPromoCard = cardTitle.includes('aumentada') || cardTitle.includes('boost');

  if (!isTackleCard && !isPromoCard) return matches;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges: any[] = card.full?.edges ?? [];

  for (const edge of edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markets: any[] = edge?.node?.markets ?? [];
    if (edge?.node?.market) markets.push({ market: edge.node.market });

    for (const m of markets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market: Record<string, any> = m.market ?? {};
      const marketName: string = String(market.name ?? '');
      const marketNameLower = marketName.toLowerCase();

      const isTackleMarket = TACKLE_KEYWORDS.some(kw => marketNameLower.includes(kw));
      if (!isTackleMarket && !isTackleCard) continue;

      const marketKey = resolveBetfairMarketKey(marketNameLower, cardTitle);
      const sportevent = market.hierarchy?.sportevent ?? {};
      const eventName: string = String(sportevent.name ?? '');
      if (!eventName) continue;

      const compName: string = String(sportevent.competition?.name ?? '');
      const isWorldCup = COPA_KEYWORDS.some(kw =>
        eventName.toLowerCase().includes(kw) || compName.toLowerCase().includes(kw),
      );
      if (!isWorldCup) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runners: any[] = market.runners ?? [];
      const odds: ScrapedOdd[] = [];

      for (const r of runners) {
        const playerName: string = String(r.name ?? '');
        if (!playerName) continue;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const liveRunners: any[] = market.liveData?.runners ?? [];
        const liveRunner = liveRunners.find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (lr: any) => lr.selectionId === r.selectionId || lr.runnerURN === r.runnerURN,
        );
        let oddValue = parseFloat(String(
          liveRunner?.odds?.decimal ?? liveRunner?.displayOdds?.decimal ?? 0,
        ));

        // Fallback para getMarketPrices se liveData não tiver odds
        if (!(oddValue > 1) && marketPricesMap) {
          const marketId = String(market.urn ?? '').split(':').pop();
          const priceKey = `${marketId}_${r.selectionId}`;
          if (marketPricesMap.has(priceKey)) {
            oddValue = marketPricesMap.get(priceKey) ?? 0;
          }
        }

        if (oddValue > 1) {
          const line = isPromoCard && playerName.toLowerCase().includes('desarme')
            ? normalizeLine(playerName)
            : normalizeLine(marketName);

          odds.push({
            playerName: isPromoCard ? cleanPromoPlayerName(playerName) : playerName,
            team: parseTeamsFromEventName(eventName)[0],
            line,
            value: oddValue,
            house: 'betfair',
            market: marketKey,
            url: pageUrl ?? (
              sportevent.eventId
                ? `${BETFAIR_BASE}/apostas/futebol/evento/e-${sportevent.eventId}`
                : undefined
            ),
          });
        }
      }

      if (odds.length > 0) {
        const [homeTeam, awayTeam] = parseTeamsFromEventName(eventName);
        matches.push({
          homeTeam,
          awayTeam,
          dateTime: new Date(String(sportevent.openDate ?? Date.now())),
          stage: extractStage(eventName),
          odds,
        });
      }
    }
  }

  return matches;
}

/** Extrai um match do formato Exchange API da Betfair. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromExchangeEvent(obj: Record<string, any>, pageUrl?: string): ScrapedMatch | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const event = obj.event as Record<string, any>;
  const eventName: string = String(event.name ?? '');

  const isWorldCup = COPA_KEYWORDS.some(kw => eventName.toLowerCase().includes(kw));
  if (!isWorldCup) return null;

  const marketName: string = String(obj.marketName ?? obj.description ?? '');
  const marketNameLower = marketName.toLowerCase();
  const isTackleOrFoul = TACKLE_KEYWORDS.some(kw => marketNameLower.includes(kw));
  if (!isTackleOrFoul) return null;

  const marketKey = resolveBetfairMarketKey(marketNameLower, '');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const runners: any[] = Array.isArray(obj.runners) ? obj.runners : [];
  const odds: ScrapedOdd[] = [];

  for (const runner of runners) {
    if (!runner || typeof runner !== 'object') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = runner as Record<string, any>;
    const playerName: string = String(r.runnerName ?? r.name ?? '');
    if (!playerName) continue;

    const exVal = r.ex as Record<string, unknown> | undefined;
    const availableToBack = Array.isArray(r.availableToBack)
      ? r.availableToBack
      : Array.isArray(exVal?.availableToBack)
      ? (exVal.availableToBack as unknown[])
      : [];

    const bestBack = availableToBack[0] as Record<string, number> | undefined;
    const oddValue = bestBack?.price ?? 0;

    if (oddValue > 1) {
      odds.push({
        playerName,
        team: parseTeamsFromEventName(eventName)[0],
        line: normalizeLine(marketName),
        value: oddValue,
        house: 'betfair',
        market: marketKey,
        url: pageUrl ?? (
          event.id
            ? `${BETFAIR_BASE}/apostas/futebol/evento/e-${event.id}`
            : undefined
        ),
      });
    }
  }

  if (odds.length === 0) return null;

  const [homeTeam, awayTeam] = parseTeamsFromEventName(eventName);
  return {
    homeTeam,
    awayTeam,
    dateTime: new Date(String(event.openDate ?? event.startTime ?? Date.now())),
    stage: extractStage(eventName),
    odds,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Determina o marketKey a partir do nome do mercado e do título do card. */
function resolveBetfairMarketKey(marketNameLower: string, cardTitleLower: string): string {
  const hasFalta = marketNameLower.includes('falta') || cardTitleLower.includes('falta') ||
    marketNameLower.includes('foul') || cardTitleLower.includes('foul');

  if (hasFalta) {
    const isSofrida = marketNameLower.includes('sofrida') || cardTitleLower.includes('sofrida') ||
      marketNameLower.includes('sofre') || cardTitleLower.includes('sofre') ||
      marketNameLower.includes('win fouls') || cardTitleLower.includes('win fouls');
    return isSofrida ? 'faltas_sofridas' : 'faltas_cometidas';
  }

  return 'desarmes';
}

/**
 * Separa "Brasil vs Argentina" → ['Brasil', 'Argentina'].
 * Suporta vs, x, -, v como separadores.
 */
function parseTeamsFromEventName(name: string): [string, string] {
  const separators = [' vs ', ' x ', ' - ', ' v '];
  for (const sep of separators) {
    if (name.toLowerCase().includes(sep.toLowerCase())) {
      const parts = name.split(new RegExp(sep, 'i'));
      return [parts[0].trim(), parts[1]?.trim() ?? ''];
    }
  }
  return [name, ''];
}

/**
 * Remove a parte descritiva do nome em odds promocionais.
 * "Vinicius faz 2+ desarmes" → "Vinicius"
 */
function cleanPromoPlayerName(name: string): string {
  const verbs = [' faz ', ' comete ', ' dá ', ' marca ', ' tem '];
  for (const verb of verbs) {
    if (name.toLowerCase().includes(verb)) {
      return name.split(new RegExp(verb, 'i'))[0].trim();
    }
  }
  return name;
}
