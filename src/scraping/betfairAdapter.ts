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
import { normalizeLine, extractStage, isLikelyPlayerName } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';
import {
  fromBetfairMarketType as mapBetfairMarketType,
  resolveBetfairMarketKey as mapBetfairMarketKey,
  mapMultiColumnOdds,
  isStrictlyIncreasingOdds,
} from './marketMap';

// Re-export pure mappers for tests / callers
export {
  fromBetfairMarketType,
  resolveBetfairMarketKey,
  mapMultiColumnOdds,
  isStrictlyIncreasingOdds,
} from './marketMap';

function resolveBetfairMarketKey(marketNameLower: string, cardTitleLower: string): string {
  return mapBetfairMarketKey(marketNameLower, cardTitleLower) ?? '';
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const BETFAIR_BASE = 'https://www.betfair.bet.br';

/** URLs de competições na Betfair */
const COMPETITION_URLS: Record<string, { url: string; name: string }> = {
  copa: { url: `${BETFAIR_BASE}/apostas/futebol/copa-do-mundo-fifa/c-12469077`, name: 'Copa do Mundo' },
  premier_league: { url: `${BETFAIR_BASE}/apostas/futebol/premier-league/c-10999137`, name: 'Premier League' },
  la_liga: { url: `${BETFAIR_BASE}/apostas/futebol/la-liga/c-11901936`, name: 'La Liga' },
  brasileirao: { url: `${BETFAIR_BASE}/apostas/futebol/brasileir%C3%A3o-s%C3%A9rie-a/c-13`, name: 'Brasileirão' },
  mls: { url: `${BETFAIR_BASE}/apostas/futebol/estados-unidos-mls/c-141`, name: 'MLS' },
};

const TACKLE_KEYWORDS = [
  'desarme', 'tackle', 'abordagem', 'desarm',
  'falta', 'foul', 'comete', 'sofre', 'corte', 'cortes',
  'finalização', 'finalizac', 'chute', 'chutes', 'shot', 'shots',
] as const;

const PAGE_TIMEOUT_MS = parseInt(process.env.PLAYWRIGHT_TIMEOUT ?? '45000', 10);

/**
 * Perfil de velocidade (env BETFAIR_PROFILE / SCRAPE_PROFILE):
 *  - fast (default): menos scroll, só linhas 1–3, waits por rede, limite de jogos
 *  - full: mais linhas (1–6), mais scroll, mais jogos
 *
 * Não remove cobertura crítica (1+/2+/3+ de chutes/finalização).
 */
type BetfairProfile = 'fast' | 'full';
function resolveProfile(): BetfairProfile {
  const raw = (process.env.BETFAIR_PROFILE || process.env.SCRAPE_PROFILE || 'fast').toLowerCase();
  return raw === 'full' ? 'full' : 'fast';
}
const PROFILE = resolveProfile();
const IS_FAST = PROFILE === 'fast';

const SCROLL_ITERATIONS = parseInt(
  process.env.BETFAIR_SCROLL_ITERS ?? (IS_FAST ? '8' : '15'),
  10,
);
const SCROLL_WAIT_MS = parseInt(process.env.BETFAIR_SCROLL_WAIT_MS ?? (IS_FAST ? '200' : '300'), 10);
/** Linhas de aba a clicar em "Chutes por Jogador" etc. */
const LINE_TABS = (process.env.BETFAIR_LINES ?? (IS_FAST ? '1+,2+,3+' : '1+,2+,3+,4+,5+,6+'))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MATCH_CONCURRENCY = parseInt(process.env.BETFAIR_CONCURRENCY ?? (IS_FAST ? '4' : '3'), 10);
/** Máx. jogos por competição (0 = sem limite). Fast foca a rodada próxima. */
const MAX_MATCHES_PER_COMP = parseInt(process.env.BETFAIR_MAX_MATCHES ?? (IS_FAST ? '12' : '0'), 10);
const TAB_NETWORK_MS = parseInt(process.env.BETFAIR_TAB_WAIT_MS ?? (IS_FAST ? '900' : '1400'), 10);
const AFTER_GOTO_MS = parseInt(process.env.BETFAIR_GOTO_WAIT_MS ?? (IS_FAST ? '800' : '1500'), 10);

const randomDelay = (min: number, max: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));

/** Espera a próxima resposta JSON relevante OU timeout curto (não trava se a UI for só client-side). */
async function waitForBetfairData(page: Page, timeoutMs: number): Promise<void> {
  await Promise.race([
    page
      .waitForResponse(
        (r) => {
          if (r.status() !== 200) return false;
          const u = r.url();
          return (
            u.includes('graphql') ||
            u.includes('apitbd') ||
            u.includes('sib.betfair') ||
            u.includes('sca.betfair') ||
            u.includes('smp.betfair') ||
            u.includes('/api/') ||
            u.includes('getMarketPrices') ||
            u.includes('Cards')
          );
        },
        { timeout: timeoutMs },
      )
      .catch(() => null),
    page.waitForTimeout(timeoutMs),
  ]);
}

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
 *
 * @param context - BrowserContext do Playwright
 * @param competitionKeys - Chaves das competições para buscar
 */
export async function scrapeBetfair(
  context: BrowserContext,
  competitionKeys?: string[],
): Promise<ScrapedMatch[]> {
  const results: ScrapedMatch[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const capturedApiData: Array<{ url: string; data: unknown; pageUrl?: string }> = [];

  logger.info(
    `[Betfair] Iniciando scraping (profile=${PROFILE}, lines=${LINE_TABS.join(',')}, ` +
    `scroll=${SCROLL_ITERATIONS}, concurrency=${MATCH_CONCURRENCY}, maxMatches=${MAX_MATCHES_PER_COMP || '∞'})...`,
  );

  // Determina quais competições buscar
  const compsToScrape = competitionKeys?.length
    ? competitionKeys.filter(k => COMPETITION_URLS[k])
    : Object.keys(COMPETITION_URLS);

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

      // Processa cada competição: navega, entra nos jogos e extrai odds das APIs
      // Cada match é filtrado por competitionKey para separar por competição
      for (const compKey of compsToScrape) {
        const comp = COMPETITION_URLS[compKey];
        logger.info(`[Betfair] Buscando jogos da competição: ${compKey} (${comp.name})`);
        
        const matchData = await scrapeCompetitionMatches(mainPage, context, capturedApiData, comp.url, compKey);
        
        const newMatches = matchData.filter(m => m.competition === compKey);
        results.push(...newMatches);
        logger.info(`[Betfair] ${compKey}: ${newMatches.length} jogos com odds (de ${matchData.length} extraídos).`);
      }

  } catch (error) {
    logger.error('[Betfair] Erro durante scraping:', { error: String(error) });
  } finally {
    if (mainPage) {
      await mainPage.close().catch(() => null);
    }
  }

  logger.info(`[Betfair] Scraping finalizado. ${results.length} jogos encontrados (de ${capturedApiData.length} entradas de API capturadas).`);
  
  // Log detalhado para debug
  if (results.length === 0 && capturedApiData.length > 0) {
    const apiUrls = capturedApiData.map(c => c.url?.substring(0, 80) || '(no url)');
    logger.warn('[Betfair] 0 jogos apesar de capturadas ' + capturedApiData.length + ' respostas de API. Amostra:', { urls: apiUrls.slice(0, 5) });
  } else if (results.length === 0) {
    logger.warn('[Betfair] 0 jogos — nenhuma resposta de API capturada. Verifique se a página carregou corretamente.');
  }
  
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

    const looksJson =
      contentType.includes('application/json') ||
      contentType.includes('application/graphql') ||
      contentType.includes('+json') ||
      contentType === '' ||
      contentType.includes('text/plain');
    if (
      status === 200 &&
      looksJson &&
      !url.includes('/exchange/') &&
      (
        url.includes('/api/') ||
        url.includes('/sports/') ||
        url.includes('/betting/') ||
        url.includes('/graphql') ||
        url.includes('smp.betfair') ||
        url.includes('sib.betfair') ||
        url.includes('apitbd.betfair') ||
        url.includes('sca.betfair') ||
        url.includes('bff-gql')
      )
    ) {
      try {
        // text() + JSON.parse (igual force-betfair-123) — mais resiliente que response.json()
        const txt = await response.text();
        if (!txt || txt.length < 8) return;
        // Só guarda payloads com chance de ter mercados de jogador (evita lixo enorme)
        if (
          !/SHOT|chute|finaliz|Cards|marketType|runners|desarme|falta|tackle/i.test(
            txt,
          )
        ) {
          return;
        }
        const json = JSON.parse(txt);
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

/** Aceita os cookies e espera o banner desaparecer antes de prosseguir. */
async function suppressCookieBanner(page: Page): Promise<void> {
  try {
    // 1. Injeta CSS para esconder o banner visualmente
    await page.addStyleTag({ content: ONETRUST_CSS }).catch(() => null);

    // 2. Tenta clicar em "Aceitar todos os cookies"
    const aceitou = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText?.toLowerCase().includes('aceitar todos'));
      if (btn) { btn.click(); return true; }
      // Fallback: tenta botão "Permitir todos"
      const btn2 = btns.find(b => b.innerText?.toLowerCase().includes('permitir todos'));
      if (btn2) { btn2.click(); return true; }
      // Fallback: tenta botão "Aceitar"
      const btn3 = btns.find(b => /^aceitar/i.test(b.innerText?.trim() || ''));
      if (btn3) { btn3.click(); return true; }
      return false;
    });

    if (aceitou) {
      // 3. Espera o banner processar o clique
      await page.waitForTimeout(2_000);
      
      // 4. Recarrega a página para o SPA carregar o conteúdo AGORA que
      // os cookies foram aceitos (a Betfair pode travar o conteúdo atrás
      // do banner de cookies — aceitar não é suficiente, precisa recarregar).
      await page.reload({ waitUntil: 'load', timeout: PAGE_TIMEOUT_MS }).catch(() => null);
      await page.waitForTimeout(2_000);
      
      // 5. Remove manualmente os elementos do banner (caso o reload não tenha limpado)
      await page.evaluate(() => {
        document.querySelectorAll('#onetrust-consent-sdk, .onetrust-pc-dark-filter, .ot-sdk-container, #onetrust-banner-sdk, [class*="cookie"], [id*="cookie"]')
          .forEach(el => el.remove());
      }).catch(() => null);
    }
  } catch (err) {
    logger.warn('[Betfair] Falha ao suprimir cookie banner', { error: String(err) });
  }
}

/** Navega para uma competição, entra em cada jogo e extrai odds. */
async function scrapeCompetitionMatches(
  page: Page,
  context: BrowserContext,
  capturedData: Array<{ url: string; data: unknown; pageUrl?: string }>,
  competitionUrl: string,
  competitionKey: string,
): Promise<ScrapedMatch[]> {
  const matches: ScrapedMatch[] = [];

  try {
    await page.goto(competitionUrl, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(2_000); // Otimizado: 2s em vez de 5s — a página já carregou com 'load'


    // Coleta links de eventos individuais na página da Copa
    const matchLinks: string[] = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a'))
        .map(a => a.href)
        .filter(href => href?.includes('/e-') || href?.includes('/event-'))
    );

    let uniqueMatchLinks = Array.from(new Set(matchLinks))
      .filter(url => /\/e-\d+/.test(url))
      .map(url => {
        // Descodifica redirects (url=...)
        let targetUrl = url;
        if (url.includes('url=')) {
          targetUrl = decodeURIComponent(url.split('url=')[1].split('&')[0]);
        }
        // Anexa o parâmetro da aba Jogador para carregar diretamente os mercados
        if (!targetUrl.includes('tab=jogador')) {
          const sep = targetUrl.includes('?') ? '&' : '?';
          targetUrl = `${targetUrl}${sep}tab=jogador`;
        }
        return targetUrl;
      });

    // Limite prático: no modo fast prioriza os primeiros N eventos da listagem
    // (em geral a ordem da página já é cronológica / próximos jogos).
    if (MAX_MATCHES_PER_COMP > 0 && uniqueMatchLinks.length > MAX_MATCHES_PER_COMP) {
      logger.info(
        `[Betfair] Limitando de ${uniqueMatchLinks.length} para ${MAX_MATCHES_PER_COMP} jogos ` +
        `(BETFAIR_MAX_MATCHES / profile=${PROFILE})`,
      );
      uniqueMatchLinks = uniqueMatchLinks.slice(0, MAX_MATCHES_PER_COMP);
    }

    logger.info(`[Betfair] ${uniqueMatchLinks.length} jogos da competição para navegar (${matchLinks.length} links brutos).`);
    
    if (uniqueMatchLinks.length === 0) {
      // Tenta extrair URLs de eventos de outras formas
      const allLinks: string[] = await page.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]')).map(a => a.href).slice(0, 20)
      );
      logger.warn('[Betfair] Nenhum link de jogo encontrado. Amostra de links da página:', { links: allLinks });
      return matches;
    }

    // Navega em paralelo com concorrência configurável
    const CONCURRENCY_LIMIT = Math.max(1, Math.min(MATCH_CONCURRENCY, 6));
    const activePromises: Promise<void>[] = [];

    for (const matchUrl of uniqueMatchLinks) {
      if (activePromises.length >= CONCURRENCY_LIMIT) {
        await Promise.race(activePromises);
      }

      const p = (async () => {
        const matchPage = await createScrapingPage(context, capturedData);
        try {
          await scrapeMatchPage(matchPage, matchUrl, capturedData, competitionKey);
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

  // API/BFF primeiro, DOM por último.
  // DOM body de "Jogador comete uma falta" / "Chutes por jogador" (após sanitize
  // monotônico) prevalece sobre BFF com linha errada do switcher.
  const apiFirst = capturedData.filter(
    (c) => !(c.data && typeof c.data === 'object' && '_domOdds' in (c.data as object)),
  );
  const domLast = capturedData.filter(
    (c) => c.data && typeof c.data === 'object' && '_domOdds' in (c.data as object),
  );
  for (const captured of [...apiFirst, ...domLast]) {
    const apiMatches = extractMatchesFromApiData(captured, marketPricesMap, competitionKey);
    matches.push(...apiMatches);
  }

  // Rede de segurança: em finalização/SOT over, 3+ nunca pode ser ≥ 4+.
  // Se ainda sobrar (BFF + DOM parcial), descarta o 3+ poluído.
  for (const m of matches) {
    if (!m.odds?.length) continue;
    m.odds = dropPollutedOverLines(m.odds);
  }

  return matches;
}

/**
 * Remove linhas over inconsistentes (ex. finalizacao 3+ copiado do 4+).
 * 4+ deve ser estritamente maior que 3+; senão o 3+ é lixo de mapeamento.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dropPollutedOverLines(odds: any[]): any[] {
  if (!odds?.length) return odds;
  const overMarkets = new Set([
    'finalizacao',
    'chutes_ao_gol',
    'faltas_cometidas',
    'faltas_sofridas',
    'desarmes',
  ]);
  const byPlayerMarket = new Map<string, any[]>();
  for (const o of odds) {
    const mkt = String(o.market ?? '');
    if (!overMarkets.has(mkt)) continue;
    const k = `${mkt}|${String(o.playerName ?? '').toLowerCase()}`;
    if (!byPlayerMarket.has(k)) byPlayerMarket.set(k, []);
    byPlayerMarket.get(k)!.push(o);
  }
  const drop = new Set<any>();
  for (const rows of byPlayerMarket.values()) {
    const byLine: Record<string, any> = {};
    for (const r of rows) {
      const line = String(r.line);
      // se duplicata, fica a última
      byLine[line] = r;
    }
    const v3 = byLine['3+'] ? Number(byLine['3+'].value) : NaN;
    const v4 = byLine['4+'] ? Number(byLine['4+'].value) : NaN;
    if (Number.isFinite(v3) && Number.isFinite(v4) && !(v4 > v3 + 1e-9)) {
      drop.add(byLine['3+']);
    }
    // 2+ deve ser > 1+; se 1+ === 3+ sem 2+, já tratado em dropNonMonotonic
    const v1 = byLine['1+'] ? Number(byLine['1+'].value) : NaN;
    const v2 = byLine['2+'] ? Number(byLine['2+'].value) : NaN;
    if (Number.isFinite(v1) && Number.isFinite(v2) && Number.isFinite(v3)) {
      if (!(v2 > v1 + 1e-9) || !(v3 > v2 + 1e-9)) {
        // trio 1–3 quebrado: tira o 3+ se 1+ e 2+ estiverem ok entre si
        if (v2 > v1 + 1e-9 && byLine['3+']) drop.add(byLine['3+']);
      }
    }
  }
  if (drop.size === 0) return odds;
  return odds.filter((o) => !drop.has(o));
}

/** Navega para a página de um jogo específico e aciona o carregamento dos mercados. */
async function scrapeMatchPage(
  page: Page,
  matchUrl: string,
  capturedData: Array<{ url: string; data: unknown; pageUrl?: string }>,
  competitionKey: string,
): Promise<void> {
  try {
    // domcontentloaded + wait de rede: bem mais rápido que waitUntil:'load'
    await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS }).catch(() => {
      logger.warn('[Betfair] Timeout ao navegar para página do jogo: ' + matchUrl);
    });
    await waitForBetfairData(page, AFTER_GOTO_MS);

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

    await page.waitForTimeout(IS_FAST ? 400 : 800);

    // Scroll leve só p/ SPA montar (NÃO clicar "Mostrar mais" ainda —
    // force-betfair-123 faz mostrar-mais no fluxo de chutes, depois do range.
    // Clicar cedo demais expande seções erradas e some multi-col 1+/2+/3+).
    const warmScrolls = Math.min(SCROLL_ITERATIONS, IS_FAST ? 6 : 10);
    for (let i = 0; i < warmScrolls; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 900);
        const scrollables = Array.from(document.querySelectorAll('div')).filter(el => {
          const style = window.getComputedStyle(el);
          return (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight;
        });
        scrollables.forEach(div => {
          try { div.scrollBy(0, 900); } catch { /* ignora */ }
        });
      });
      await page.waitForTimeout(SCROLL_WAIT_MS);
    }
    await waitForBetfairData(page, IS_FAST ? 500 : 800);

    // ============================================================
    // EXPANDE SEÇÕES + CLICA LINHAS 1+/2+/3+ (Chutes por Jogador etc.)
    // ============================================================
    // Na Betfair, "Chutes por Jogador" / "Finalização" mostram abas
    // individuais "1+", "2+", "3+" (não só o range "1+ até 3+").
    // Sem clicar em cada linha, a API/DOM só traz a linha default (1+)
    // e odds como Kaio Jorge 2+ finalização (ex: 1.14) somem.
    // ============================================================

    const sectionHeaders = [
      'chutes por jogador', 'chutes no gol', 'finalização', 'finalizacoes',
      'finalizac', 'jogador comete uma falta', 'comete uma falta',
      'faltas cometidas', 'faltas sofridas',
      'desarmes', 'tackles', 'abordagens', 'jogador a ter',
    ];

    async function expandMarketSections(): Promise<number> {
      return page.evaluate((headers) => {
        let n = 0;
        const allEls = Array.from(document.querySelectorAll('button, [role="button"], a, label, h2, h3, h4, span, div'));
        for (const el of allEls) {
          const txt = (el.textContent || '').trim().toLowerCase();
          // Só cabeçalhos curtos (evita clicar no bloco inteiro da seção)
          if (txt.length > 0 && txt.length < 40 && headers.some((h) => txt === h || txt.includes(h))) {
            const clickable =
              (el.closest('button, [role="button"], a, label, [tabindex]') as HTMLElement | null) ||
              (el as HTMLElement);
            try {
              clickable.click();
              n++;
            } catch { /* */ }
          }
        }
        return n;
      }, sectionHeaders);
    }

    /**
     * Clica abas de linha com match EXATO do texto (ex: "2+").
     * includes("2+") casaria "1+ até 3+" e bagunçaria o fluxo.
     */
    async function clickExactLineTabs(label: string): Promise<number> {
      return page.evaluate((txt) => {
        const want = txt.toLowerCase().trim();
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, span, a, div, [role="tab"], [role="button"], label, li',
          ),
        );
        let clicked = 0;
        for (const el of elements) {
          // Preferir innerText (visível) e só o nó folha / curto
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (t !== want) continue;
          // Evita clicar em containers grandes que reúnem vários labels
          if (t.length > 6) continue;
          try {
            el.click();
            clicked++;
          } catch { /* */ }
        }
        return clicked;
      }, label);
    }

    async function clickRangeTabs(label: string): Promise<number> {
      return page.evaluate((txt) => {
        const want = txt.toLowerCase();
        const elements = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, span, a, div, [role="tab"], [role="button"], label, li',
          ),
        );
        let clicked = 0;
        for (const el of elements) {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (t === want || (t.includes(want) && t.length < 24)) {
            try {
              el.click();
              clicked++;
            } catch { /* */ }
          }
        }
        return clicked;
      }, label);
    }

    /** Extrai times do slug da URL (.../internacional-x-cruzeiro/...) */
    function teamsFromUrl(url: string): { homeTeam: string; awayTeam: string } {
      const parts = url.toLowerCase().split('/');
      let slug = parts.find((p) => p.includes('-x-') && p.length < 80) || '';
      if (!slug) return { homeTeam: '', awayTeam: '' };
      slug = slug.split('?')[0];
      const [h, a] = slug.split('-x-');
      const cap = (s: string) =>
        decodeURIComponent(s || '')
          .replace(/-/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase());
      return { homeTeam: cap(h), awayTeam: cap(a) };
    }

    /**
     * Lê odds renderizadas no DOM.
     * A Betfair coloca colunas 1+/2+/3+ como abas; após clicar "2+",
     * a grade mostra só a coluna ativa — então usamos activeLine
     * quando só há uma coluna visível.
     */
    async function extractDomOdds(
      activeLine?: string,
      preferredCols?: number[],
    ): Promise<
      Array<{ playerName: string; line: string; value: number; market: string }>
    > {
      try {
        return await page.evaluate(({ forcedLine, preferred }) => {
          type T = { t: string; isInteractive: boolean };
          const allTexts: T[] = [];
          const stack: Node[] = [document.documentElement];
          while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sr = (node as any).shadowRoot as Node | null;
            if (sr) stack.push(sr);
            for (let ni = 0; ni < node.childNodes.length; ni++) {
              const child = node.childNodes[ni];
              if (child.nodeType === 3) {
                const t = (child.textContent || '').trim();
                if (!t) continue;
                let el2 = child.parentElement;
                let isInter = false;
                while (el2) {
                  const tg = (el2.tagName || '').toLowerCase();
                  if (tg === 'button' || tg === 'a' || tg === 'label' || tg === 'select') {
                    isInter = true;
                    break;
                  }
                  el2 = el2.parentElement;
                }
                allTexts.push({ t, isInteractive: isInter });
              } else if (child.nodeType === 1) {
                stack.push(child);
              }
            }
          }

          // Colunas N+ visíveis (abas de linha / cabeçalhos da grade)
          // NÃO declarar function/const fn = () => {} aqui: tsx injeta __name e quebra o browser.
          const globalCols: number[] = [];
          for (let gi = 0; gi < allTexts.length; gi++) {
            const mc = allTexts[gi].t.match(/^([1-6])\+$/);
            if (mc) {
              const n = parseInt(mc[1], 10);
              if (!globalCols.includes(n)) globalCols.push(n);
            }
            if (globalCols.length >= 6) break;
          }
          let cols = globalCols.filter((n) => n >= 1 && n <= 6).sort((a, b) => a - b);
          // Se a UI mostra só a linha ativa após o click, força essa linha
          if (forcedLine) {
            const fl = parseInt(String(forcedLine).replace('+', ''), 10);
            if (fl >= 1 && fl <= 6) cols = [fl];
          } else if (preferred && preferred.length > 0) {
            // NÃO forçar [1,2,3] se a grade visível é claramente 4+/5+/6+
            // (senão odds do 4+ viram "3+" e vice-versa).
            const pref = preferred.slice() as number[];
            const wantLow = pref[0] <= 3 && pref.every((c: number) => c <= 3);
            const wantHigh = pref[0] >= 4;
            const actualLow = cols.filter((c) => c <= 3);
            const actualHigh = cols.filter((c) => c >= 4);
            if (wantLow && actualHigh.length >= 2 && actualLow.length === 0) {
              return []; // aba 4–6 ativa; pediram 1–3
            }
            if (wantHigh && actualLow.length >= 2 && actualHigh.length === 0) {
              return []; // aba 1–3 ativa; pediram 4–6
            }
            cols = pref;
          } else if (cols.length === 0) {
            cols = [1, 2, 3]; // fallback comum da UI "1+ até 3+"
          } else if (cols.length > 3) {
            // Prefere o bloco 1-3 se ambos existirem
            const c13 = cols.filter((c) => c <= 3);
            cols = c13.length >= 2 ? c13 : cols.slice(0, 3);
          }

          const result: Array<{ playerName: string; line: string; value: number; market: string }> = [];
          const sections: Array<{ start: number; end: number; market: string }> = [];
          for (let si = 0; si < allTexts.length; si++) {
            const sl = allTexts[si].t.toLowerCase();
            let market: string | null = null;
            if (/boost|aumentad|elevada|gr[aá]tis|promo/.test(sl)) market = null;
            else if (
              sl.includes('jogador comete') ||
              sl.includes('comete uma falta') ||
              (sl.includes('falta') && (sl.includes('comet') || sl.includes('comete')))
            ) {
              market = 'faltas_cometidas';
            }
            else if (sl.includes('falta') && (sl.includes('sofrida') || sl.includes('sofre'))) market = 'faltas_sofridas';
            else if (sl.includes('desarme') || sl.includes('tackle') || sl.includes('abordag')) market = 'desarmes';
            else if (sl.includes('chute') && sl.includes('gol')) market = 'chutes_ao_gol';
            else if (sl.includes('finaliza') || sl.includes('chutes por jogador') || (sl.includes('chute') && !sl.includes('gol'))) market = 'finalizacao';
            if (!market || allTexts[si].t.length > 60) continue;
            let endIdx = allTexts.length;
            for (let ei = si + 1; ei < allTexts.length; ei++) {
              const el = allTexts[ei].t.toLowerCase();
              let m2: string | null = null;
              if (/boost|aumentad|elevada|gr[aá]tis|promo/.test(el)) m2 = null;
              else if (
                el.includes('jogador comete') ||
                el.includes('comete uma falta') ||
                (el.includes('falta') && (el.includes('comet') || el.includes('comete')))
              ) {
                m2 = 'faltas_cometidas';
              }
              else if (el.includes('falta') && (el.includes('sofrida') || el.includes('sofre'))) m2 = 'faltas_sofridas';
              else if (el.includes('desarme') || el.includes('tackle') || el.includes('abordag')) m2 = 'desarmes';
              else if (el.includes('chute') && el.includes('gol')) m2 = 'chutes_ao_gol';
              else if (el.includes('finaliza') || el.includes('chutes por jogador') || (el.includes('chute') && !el.includes('gol'))) m2 = 'finalizacao';
              if ((m2 && el.length < 60) || (/^(boost|aumentad|cartao|escanteio)/.test(el) && el.length < 40)) {
                endIdx = ei;
                break;
              }
            }
            sections.push({ start: si, end: endIdx, market });
          }

          for (const sec of sections) {
            const slice = allTexts.slice(sec.start, sec.end);
            if (cols.length === 0) continue;
            let idx = 0;
            while (idx < slice.length) {
              const txt = slice[idx];
              if (!txt || txt.isInteractive) {
                idx++;
                continue;
              }
              const isName =
                txt.t.length >= 3 &&
                txt.t.length <= 40 &&
                /^[A-ZÀ-Ü]/.test(txt.t) &&
                !/^(mostrar|acima|abaixo|desarmes|mais|menos|cartoes|chutes|faltas|gols|escanteios|finalizacoes|preco|boost|odds|jogador|tempo|cada|substitui|1\+|2\+|3\+|4\+|5\+|6\+|\d)/i.test(
                  txt.t,
                ) &&
                !txt.t.includes('+');
              if (isName) {
                const vals: number[] = [];
                let j = idx + 1;
                while (j < slice.length && j < idx + 12) {
                  const next = slice[j];
                  if (!next || next.isInteractive) {
                    j++;
                    continue;
                  }
                  if (/^[1-6]\+$/.test(next.t)) break;
                  const isNextName =
                    next.t.length >= 3 &&
                    next.t.length <= 40 &&
                    /^[A-ZÀ-Ü]/.test(next.t) &&
                    !/^(mostrar|acima|abaixo|jogador|1\+|2\+|3\+|4\+|5\+|6\+|\d)/i.test(next.t) &&
                    !next.t.includes('+');
                  if (isNextName) break;
                  const v = parseFloat(next.t.replace(',', '.'));
                  const hasDecimal = next.t.includes('.') || next.t.includes(',');
                  const isShirt = !hasDecimal && v > 1 && v <= 99 && v % 1 === 0;
                  if (!isNaN(v) && v > 1 && v < 100 && !isShirt) vals.push(v);
                  j++;
                }
                // BACK/LAY: se sobram tokens, tenta pares (BACK) e sequencial
                let vv = vals;
                if (vals.length > cols.length) {
                  const even: number[] = [];
                  for (let vi = 0; vi < vals.length && even.length < cols.length; vi += 2) {
                    even.push(vals[vi]);
                  }
                  const seq = vals.slice(0, cols.length);
                  const isInc = (a: number[]) => {
                    for (let k = 1; k < a.length; k++) if (!(a[k] > a[k - 1])) return false;
                    return a.length >= 2;
                  };
                  if (even.length === cols.length && isInc(even)) vv = even;
                  else if (isInc(seq)) vv = seq;
                  else if (even.length === cols.length) vv = even;
                  else vv = seq;
                }
                // Over multi-col: só emite se odds forem estritamente crescentes
                if (cols.length >= 3 && vv.length >= 3) {
                  let ok = true;
                  for (let k = 1; k < Math.min(vv.length, cols.length); k++) {
                    if (!(vv[k] > vv[k - 1])) {
                      ok = false;
                      break;
                    }
                  }
                  if (!ok) {
                    idx++;
                    continue;
                  }
                }
                const maxCols = Math.min(vv.length, cols.length);
                for (let ci = 0; ci < maxCols; ci++) {
                  result.push({
                    playerName: txt.t,
                    line: `${cols[ci]}+`,
                    value: vv[ci],
                    market: sec.market,
                  });
                }
              }
              idx++;
            }
          }
          return result;
        }, { forcedLine: activeLine ?? null, preferred: preferredCols ?? null });
      } catch {
        return [];
      }
    }

    const teams = teamsFromUrl(matchUrl);
    const allDomOdds: Array<{ playerName: string; line: string; value: number; market: string }> = [];

    function mergeDomOdds(
      list: Array<{ playerName: string; line: string; value: number; market: string }>,
    ) {
      for (const o of list) {
        if (!o.playerName || !o.line || !(o.value > 1)) continue;
        // Descarta lixo de DOM (Empate/Empate, Intervalo/Final, etc.)
        if (!isLikelyPlayerName(o.playerName)) continue;
        const idx = allDomOdds.findIndex(
          (x) =>
            x.playerName === o.playerName &&
            x.line === o.line &&
            x.market === o.market,
        );
        if (idx >= 0) allDomOdds[idx] = o;
        else allDomOdds.push(o);
      }
      // Remove triples over não monotônicos (1+>=2+ ou 1+===3+)
      sanitizeOverTriples(allDomOdds);
    }

    /**
     * Se um jogador tem 1+/2+/3+ (ou 4+/5+/6+) de finalizacao/sot e as odds
     * não crescem, descarta o trio inteiro (lixo multi-col / BACK-LAY).
     */
    function sanitizeOverTriples(
      list: Array<{ playerName: string; line: string; value: number; market: string }>,
    ) {
      const groups = new Map<string, typeof list>();
      for (const o of list) {
        // Aplica a todos os mercados over multi-col (faltas também vinham 1+>2+)
        if (
          o.market !== 'finalizacao' &&
          o.market !== 'chutes_ao_gol' &&
          o.market !== 'faltas_cometidas' &&
          o.market !== 'faltas_sofridas' &&
          o.market !== 'desarmes'
        ) {
          continue;
        }
        const key = `${o.market}|${o.playerName}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)!.push(o);
      }
      const drop = new Set<string>();
      for (const [, rows] of groups) {
        const byLine: Record<string, number> = {};
        for (const r of rows) byLine[r.line] = r.value;
        for (const band of [
          ['1+', '2+', '3+'],
          ['4+', '5+', '6+'],
        ]) {
          const vals = band.map((l) => byLine[l]).filter((v) => typeof v === 'number');
          if (vals.length >= 3 && !isStrictlyIncreasingOdds(vals as number[])) {
            for (const l of band) drop.add(`${rows[0].market}|${rows[0].playerName}|${l}`);
          } else if (
            vals.length === 2 &&
            byLine['1+'] != null &&
            byLine['3+'] != null &&
            byLine['1+'] === byLine['3+']
          ) {
            drop.add(`${rows[0].market}|${rows[0].playerName}|1+`);
            drop.add(`${rows[0].market}|${rows[0].playerName}|3+`);
          }
        }
        // Over: 4+ deve ser > 3+. Se 3+ >= 4+, o 3+ foi poluído (ex. harvest
        // SOT [3,4] reescreveu finalização com a coluna 4+ da grade 4–6).
        // Descarta o 3+ (e não o bloco 4+/5+/6+, que costuma estar correto).
        if (
          byLine['3+'] != null &&
          byLine['4+'] != null &&
          !(byLine['4+'] > byLine['3+'] + 1e-9)
        ) {
          drop.add(`${rows[0].market}|${rows[0].playerName}|3+`);
        }
      }
      if (drop.size === 0) return;
      for (let i = list.length - 1; i >= 0; i--) {
        const o = list[i];
        if (drop.has(`${o.market}|${o.playerName}|${o.line}`)) list.splice(i, 1);
      }
    }

    /**
     * Extrai odds de FINALIZAÇÃO / CHUTES em grade multi-coluna.
     *
     * UI real da Betfair (confirmada 2026):
     *   [1+ até 3+] [4+ a 6+]     ← abas de range
     *   1+    2+    3+             ← colunas
     *   Kaio Jorge  1.04  1.14  1.53
     *
     * Sem clicar "1+ até 3+", a grade fica em 4+/5+/6+ e as linhas 1–3 somem.
     * forcedLine (opcional): se a grade mostrar 1 odd/jogador, atribui essa linha.
     */
    async function extractShotsMultiColumn(
      cols: number[],
      forcedLine?: string,
    ): Promise<
      Array<{ playerName: string; line: string; value: number; market: string }>
    > {
      try {
        const raw = await page.evaluate(
          ({ colNums, forceLine }) => {
            const out: Array<{
              playerName: string;
              market: string;
              odds: number[];
              forceLine: string | null;
            }> = [];

            // Helpers inline (sem const fn = () => — tsx __name quebra page.evaluate)
            const headers = Array.from(
              document.querySelectorAll('h1,h2,h3,h4,h5,span,div,button,p'),
            );
            const sectionRoots: { el: Element; market: string }[] = [];
            for (const el of headers) {
              const own = (
                el.childNodes.length
                  ? Array.from(el.childNodes)
                      .filter((n) => n.nodeType === 3)
                      .map((n) => (n.textContent || '').trim())
                      .join(' ')
                  : el.textContent || ''
              )
                .trim()
                .toLowerCase();
              const t = own || (el.textContent || '').trim().toLowerCase().slice(0, 56);
              if (t.length < 5 || t.length > 56) continue;
              let market = '';
              if (
                t.includes('chutes por jogador') ||
                t === 'finalização' ||
                t === 'finalizacoes' ||
                t === 'finalizacao' ||
                t.includes('total de chutes') ||
                (t.includes('shots') && t.includes('player'))
              ) {
                market = 'finalizacao';
              } else if (
                (t.includes('chute') && t.includes('gol')) ||
                t.includes('shots on target') ||
                t.includes('chutes no gol') ||
                t.includes('chutes no gol do jogador')
              ) {
                market = 'chutes_ao_gol';
              } else continue;

              const root =
                el.closest(
                  'section, article, [class*="card"], [class*="Card"], [class*="market"], [class*="Market"], [data-testid]',
                ) ||
                el.parentElement?.parentElement ||
                el.parentElement;
              if (root && root !== document.body) {
                // evita duplicar o mesmo root
                if (!sectionRoots.some((s) => s.el === root && s.market === market)) {
                  sectionRoots.push({ el: root, market });
                }
              }
            }

            if (sectionRoots.length === 0) return out;

            const seen = new Set<string>();
            for (const { el: root, market } of sectionRoots) {
              const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
              const texts: string[] = [];
              let node: Node | null;
              while ((node = walker.nextNode())) {
                const t = (node.textContent || '').trim();
                if (t) texts.push(t);
              }

              // Detecta colunas N+ visíveis nesta seção (cabeçalhos da grade)
              const detected: number[] = [];
              for (const tok of texts) {
                const m = tok.match(/^([1-6])\+$/);
                if (m) {
                  const n = parseInt(m[1], 10);
                  if (!detected.includes(n)) detected.push(n);
                }
              }
              // CRÍTICO: se pedimos 1–3 mas a grade visível é só 4+/5+/6+ (ou o
              // contrário), NÃO mapear — era isso que fazia 3+ = odd do 4+.
              const wantLow = colNums.length > 0 && colNums[0] <= 3 && colNums.every((c: number) => c <= 3);
              const wantHigh = colNums.length > 0 && colNums[0] >= 4;
              const detLow = detected.filter((d) => d <= 3);
              const detHigh = detected.filter((d) => d >= 4);
              if (wantLow && detHigh.length >= 2 && detLow.length === 0) {
                continue; // seção na aba 4–6; caller pediu 1–3
              }
              if (wantHigh && detLow.length >= 2 && detHigh.length === 0) {
                continue; // seção na aba 1–3; caller pediu 4–6
              }
              // Sempre confia nas colunas pedidas pelo caller (range 1–3 ou 4–6).
              // Detectar headers no DOM costumava pular o "2+" e mapear odds em [1,3].
              let useCols = colNums.slice();
              if (detected.length >= colNums.length) {
                const overlap = detected.filter((d) => colNums.includes(d)).sort((a, b) => a - b);
                // só sobrescreve se a interseção for exatamente as colunas pedidas
                if (overlap.length === colNums.length) useCols = overlap;
              }

              for (let i = 0; i < texts.length; i++) {
                const name = texts[i];
                // isPlayerName inline (sem helper nomeado)
                {
                  const t = name.replace(/\s+/g, ' ').trim();
                  if (t.length < 3 || t.length > 40) continue;
                  if (!/^[A-ZÀ-Ü]/.test(t)) continue;
                  if (/[\/|]/.test(t) || /\bvs\b/i.test(t)) continue;
                  if (/\d[.,]\d/.test(t) || /^[1-6]\+$/.test(t)) continue;
                  if (/^(mostrar|mais|menos|chutes|faltas|desarmes|jogador|finaliz|odds|preco|boost|empate|intervalo|final|placar|casa|fora|time|cada tempo|a - z|a-z)/i.test(t)) continue;
                  if (/\b(empate|intervalo|placar|resultado|ambas|dupla)\b/i.test(t)) continue;
                  if (!/[a-zà-ü]/.test(t) && t.split(/\s+/).length < 2) continue;
                }

                const candidates: { value: number; decimal: boolean }[] = [];
                for (let j = i + 1; j < Math.min(i + 16, texts.length); j++) {
                  const tok = texts[j];
                  // next player name?
                  {
                    const t2 = tok.replace(/\s+/g, ' ').trim();
                    const looksName =
                      t2.length >= 3 &&
                      t2.length <= 40 &&
                      /^[A-ZÀ-Ü]/.test(t2) &&
                      !/[\/|]/.test(t2) &&
                      !/\d[.,]\d/.test(t2) &&
                      !/^[1-6]\+$/.test(t2) &&
                      !/^(mostrar|mais|menos|chutes|faltas|1\+|2\+|3\+|4\+|5\+|6\+)/i.test(t2) &&
                      (/[a-zà-ü]/.test(t2) || t2.split(/\s+/).length >= 2);
                    if (looksName) break;
                  }
                  if (/^[1-6]\+$/.test(tok)) continue;
                  if (/^(mostrar|menos|mais|cada|tempo|a - z|a-z)$/i.test(tok)) continue;
                  // parseOddToken inline
                  const raw = tok.replace(',', '.');
                  const v = parseFloat(raw);
                  if (isNaN(v) || v <= 1.01 || v > 80) continue;
                  const decimal = raw.includes('.') || raw.includes(',');
                  if (!decimal && (v < 2 || v > 80 || v % 1 !== 0)) continue;
                  candidates.push({ value: v, decimal });
                  if (candidates.length >= useCols.length + 1) break;
                }

                // Se o 1º token é inteiro e o resto tem decimais suficientes → camisa
                let odds: number[] = [];
                if (
                  candidates.length > useCols.length &&
                  !candidates[0].decimal &&
                  candidates.slice(1).filter((c) => c.decimal).length >= useCols.length
                ) {
                  odds = candidates
                    .slice(1)
                    .map((c) => c.value)
                    .slice(0, useCols.length);
                } else if (
                  candidates.filter((c) => c.decimal).length >= useCols.length
                ) {
                  // Preferir só decimais quando bastam (evita camisa no meio)
                  odds = candidates
                    .filter((c) => c.decimal)
                    .map((c) => c.value)
                    .slice(0, useCols.length);
                } else {
                  // Mistura: aceita inteiros como odd real (2, 6, 11…)
                  odds = candidates.map((c) => c.value).slice(0, useCols.length);
                }

                if (odds.length === 0) continue;
                // Devolve odds brutas; mapeamento sequencial via mapMultiColumnOdds fora do browser
                const key = `${market}|${name.toLowerCase()}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({
                  playerName: name,
                  market,
                  odds,
                  forceLine: forceLine || null,
                });
              }
            }
            return out;
          },
          { colNums: cols, forceLine: forcedLine ?? null },
        );
        const mapped: Array<{ playerName: string; line: string; value: number; market: string }> = [];
        for (const r of raw || []) {
          if (!isLikelyPlayerName(r.playerName)) continue;
          if (r.forceLine && r.odds.length === 1) {
            mapped.push({
              playerName: r.playerName,
              line: r.forceLine,
              value: r.odds[0],
              market: r.market,
            });
            continue;
          }
          // SHIPPED mapper — nunca pular coluna do meio (2+)
          for (const m of mapMultiColumnOdds(r.odds, cols)) {
            mapped.push({
              playerName: r.playerName,
              line: m.line,
              value: m.value,
              market: r.market,
            });
          }
        }
        return mapped;
      } catch {
        return [];
      }
    }

    /** Compat: linha forçada (1 odd/jogador) */
    async function extractShotsWithForcedLine(forcedLine: string) {
      const n = parseInt(forcedLine.replace('+', ''), 10);
      const cols = n >= 1 && n <= 6 ? [n] : [1, 2, 3];
      return extractShotsMultiColumn(cols, forcedLine);
    }

    /** Clica aba de linha preferindo a região de "Chutes por Jogador". */
    async function clickLineNearShots(lineLabel: string): Promise<number> {
      // 1) Playwright getByText exact
      let clicked = 0;
      try {
        const loc = page.getByText(lineLabel, { exact: true });
        const n = await loc.count();
        for (let i = 0; i < Math.min(n, 12); i++) {
          try {
            await loc.nth(i).click({ timeout: 400, force: true });
            clicked++;
          } catch { /* */ }
        }
      } catch { /* */ }

      // 2) evaluate: prioriza nós próximos a "chutes"/"finaliz"
      const extra = await page.evaluate((txt) => {
        const want = txt.toLowerCase();
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('button, span, a, div, [role="tab"], label, li'),
        );
        const scored: { el: HTMLElement; score: number }[] = [];
        for (const el of nodes) {
          const t = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (t !== want) continue;
          if (t.length > 6) continue;
          let score = 1;
          let p: HTMLElement | null = el;
          for (let d = 0; d < 8 && p; d++) {
            const pt = (p.innerText || '').toLowerCase().slice(0, 200);
            if (pt.includes('chutes por jogador') || pt.includes('finaliz') || pt.includes('shots')) score += 10;
            if (pt.includes('chute') && pt.includes('gol')) score += 5;
            p = p.parentElement;
          }
          scored.push({ el, score });
        }
        scored.sort((a, b) => b.score - a.score);
        let n = 0;
        for (const { el } of scored.slice(0, 6)) {
          try {
            el.click();
            n++;
          } catch { /* */ }
        }
        return n;
      }, lineLabel);

      return clicked + extra;
    }

    // NÃO expandir seções genéricas ANTES dos chutes:
    // expandMarketSections() clica "chutes por jogador"/headers e troca o
    // switcher p/ "Marca ou Faz Assistência" — some multi-col 1+/2+/3+ e
    // PLAYER_TO_HAVE_1/2/3_OR_MORE_SHOTS (diagnóstico _diag-prod-path.mjs).
    // force-betfair-123 NÃO faz isso e PASS.
    logger.info(`[Betfair] Iniciando force-sequence chutes (${matchUrl.slice(-40)})`);

    /**
     * "Chutes por jogador" (finalização total) é lazy-load.
     * Scroll + "Mostrar mais" + clique em qualquer aba N+ até o texto/API aparecer.
     * Sem isso a API só manda 4+/5+/6+ (default) ou nem manda o card.
     */
    async function ensureShotsCardsLoaded(): Promise<boolean> {
      for (let attempt = 0; attempt < 10; attempt++) {
        const state = await page.evaluate(() => {
          const body = (document.body?.innerText || '').toLowerCase();
          return {
            hasPor: body.includes('chutes por jogador'),
            hasGol: body.includes('chutes no gol'),
            bodyLen: body.length,
          };
        });
        if (state.hasPor) return true;

        await page.evaluate(() => {
          window.scrollBy(0, 900);
          const scrollables = Array.from(document.querySelectorAll('div')).filter((el) => {
            const style = window.getComputedStyle(el);
            return (
              (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
              el.scrollHeight > el.clientHeight
            );
          });
          scrollables.forEach((div) => {
            try { div.scrollBy(0, 900); } catch { /* */ }
          });
          for (const btn of Array.from(document.querySelectorAll<HTMLElement>('button, span, a'))) {
            const t = (btn.innerText || '').toLowerCase();
            if (t.includes('mostrar mais') || t.includes('ver mais') || t.includes('show more')) {
              try { btn.click(); } catch { /* */ }
            }
          }
        });

        // A cada 2 tentativas: clica em abas de range genéricas para forçar lazy BFF
        if (attempt % 2 === 1) {
          await page.evaluate(() => {
            const nodes = Array.from(
              document.querySelectorAll<HTMLElement>(
                'button, span, a, div, [role="tab"], label, li',
              ),
            );
            for (const el of nodes) {
              const t = (el.innerText || '').trim();
              if (
                /^(1\+ até 3\+|4\+ a 6\+|4\+ até 6\+|1\+ e 2\+|3\+ e 4\+)$/i.test(t) ||
                (/[1-6]\+/.test(t) && t.length < 16)
              ) {
                try { el.click(); } catch { /* */ }
              }
            }
          });
          await waitForBetfairData(page, 900);
        }

        await waitForBetfairData(page, 500);
        await page.waitForTimeout(280);
      }
      return page.evaluate(() =>
        (document.body?.innerText || '').toLowerCase().includes('chutes por jogador'),
      );
    }

    /**
     * Clica aba de range DENTRO do card certo.
     *
     * Bug antigo: "1+ até 3+" existe em FALTAS e em CHUTES. Clicar o 1º da
     * página só mudava faltas → API nunca mandava
     * PLAYER_TO_HAVE_1/2/3_OR_MORE_SHOTS.
     *
     * Estratégia: achar o header do card (prefer keywords), subir até um
     * container local (~card), e só então clicar labels de range DENTRO dele.
     * NÃO pontuar ancestrais do body (innerText do body tem tudo e zera o score).
     */
    async function clickRangeInCard(
      labels: string[],
      prefer: string[],
      avoid: string[] = [],
    ): Promise<{ label: string | null; score: number; clicks: number }> {
      // NÃO usar funções nomeadas nem const fn = () => {} dentro do evaluate:
      // o tsx/esbuild injeta __name() e o browser quebra.
      return page.evaluate(
        ({ labels: labs, prefer: pref, avoid: av }) => {
          const roots: HTMLElement[] = [];
          const allEls = Array.from(document.querySelectorAll<HTMLElement>('*'));
          for (let i = 0; i < allEls.length; i++) {
            const el = allEls[i];
            const parts: string[] = [];
            const kids = el.childNodes;
            for (let ki = 0; ki < kids.length; ki++) {
              const n = kids[ki];
              if (n.nodeType === 3) {
                const t = (n.textContent || '').trim();
                if (t) parts.push(t);
              } else if (n.nodeType === 1) {
                const t = ((n as HTMLElement).innerText || '').trim();
                if (t && t.length < 80) parts.push(t);
              }
            }
            const ot = parts.join(' ').toLowerCase();
            if (ot.length < 5 || ot.length > 60) continue;
            let hitKw = false;
            for (let pi = 0; pi < pref.length; pi++) {
              if (ot.includes(pref[pi].toLowerCase())) { hitKw = true; break; }
            }
            if (!hitKw) continue;
            let root: HTMLElement | null = el;
            for (let d = 0; d < 10 && root && root !== document.body; d++) {
              const cls = String(root.className || '');
              const tag = root.tagName;
              const big = (root.innerText || '').length;
              if (
                tag === 'SECTION' ||
                tag === 'ARTICLE' ||
                /card|Card|market|Market|pebble|Pebble/i.test(cls) ||
                (big > 200 && big < 12000)
              ) {
                if (big >= 150 && big < 8000) break;
              }
              root = root.parentElement;
            }
            if (root && root !== document.body && roots.indexOf(root) < 0) {
              const blob = (root.innerText || '').toLowerCase().slice(0, 300);
              let hitsPref = 0;
              let hitsAvoid = 0;
              for (let pi = 0; pi < pref.length; pi++) {
                if (blob.includes(pref[pi].toLowerCase())) hitsPref++;
              }
              for (let ai = 0; ai < av.length; ai++) {
                if (blob.includes(av[ai].toLowerCase())) hitsAvoid++;
              }
              if (hitsPref > 0 && hitsAvoid > hitsPref + 1) continue;
              roots.push(root);
            }
          }

          const searchRoots: ParentNode[] = roots.length > 0 ? roots : [document];
          const cands: { el: HTMLElement; label: string; score: number }[] = [];

          for (let ri = 0; ri < searchRoots.length; ri++) {
            const qroot = searchRoots[ri] as HTMLElement;
            const nodes = qroot.querySelectorAll
              ? Array.from(
                  qroot.querySelectorAll<HTMLElement>(
                    'button, span, a, div, [role="tab"], [role="button"], label, li',
                  ),
                )
              : [];
            const rootBlob = (qroot.innerText || '').toLowerCase().slice(0, 400);
            let base = 10;
            for (let pi = 0; pi < pref.length; pi++) {
              if (rootBlob.includes(pref[pi].toLowerCase())) base += 20;
            }
            for (let ai = 0; ai < av.length; ai++) {
              if (rootBlob.includes(av[ai].toLowerCase())) base -= 12;
            }

            for (let ni = 0; ni < nodes.length; ni++) {
              const el = nodes[ni];
              const t = (el.innerText || el.textContent || '').trim();
              if (!t || t.length > 28) continue;
              const tl = t.toLowerCase();
              let matched: string | null = null;
              for (let li = 0; li < labs.length; li++) {
                const lab = labs[li].toLowerCase();
                if (tl === lab || tl === lab + ' tempo') {
                  matched = labs[li];
                  break;
                }
              }
              if (!matched) continue;
              let score = base;
              if (roots.length > 0) score += 30;
              cands.push({ el, label: matched, score });
            }
          }

          cands.sort((a, b) => b.score - a.score);
          let clicks = 0;
          let bestLabel: string | null = null;
          let bestScore = -999;
          const seenEls: HTMLElement[] = [];
          for (let ci = 0; ci < cands.length && ci < 4; ci++) {
            const c = cands[ci];
            if (seenEls.indexOf(c.el) >= 0) continue;
            seenEls.push(c.el);
            try {
              c.el.scrollIntoView({ block: 'center', inline: 'nearest' });
              c.el.click();
              clicks++;
              if (c.score > bestScore) {
                bestScore = c.score;
                bestLabel = c.label;
              }
            } catch { /* */ }
          }
          return { label: bestLabel, score: bestScore, clicks };
        },
        { labels, prefer, avoid },
      );
    }

    /**
     * Fallback bruto: lê innerText do body a partir de um header de mercado
     * (ex. "Chutes por jogador", "Jogador comete uma falta") e mapeia
     * Name + N odds → colunas via mapMultiColumnOdds.
     */
    async function extractShotsFromBodyText(
      cols: number[],
      market:
        | 'finalizacao'
        | 'chutes_ao_gol'
        | 'faltas_cometidas'
        | 'faltas_sofridas'
        | 'desarmes',
      headerHints: string[],
      extraStopWords: string[] = [],
    ): Promise<Array<{ playerName: string; line: string; value: number; market: string }>> {
      try {
        const raw = await page.evaluate(
          ({ colNums, mkt, hints, stops }) => {
            const body = document.body?.innerText || '';
            const lower = body.toLowerCase();
            // Prefere o header mais longo / específico (ex. "jogador comete uma falta")
            let start = -1;
            let bestLen = 0;
            for (let hi = 0; hi < hints.length; hi++) {
              const h = hints[hi].toLowerCase();
              const i = lower.indexOf(h);
              if (i >= 0 && h.length >= bestLen) {
                start = i;
                bestLen = h.length;
              }
            }
            if (start < 0) return [];

            // corta até o próximo bloco de mercado conhecido
            let end = body.length;
            const stopWords = [
              'chutes por jogador',
              'chutes no gol do jogador',
              'chutes no gol',
              'jogador comete uma falta',
              'comete uma falta',
              // NÃO parar em "Jogador que sofre falta" se for só aba irmã no mesmo card
              // (senão a grade 1+/2+/3+ some). Para ao bloco SEGUINTE de mercado:
              'faltas sofridas',
              'falta sofrida',
              'desarmes',
              'cartões do jogador',
              'cartoes do jogador',
              'marcador',
              'escanteio',
              ...stops,
            ];
            // Não parar no próprio header
            const headerEnd = start + bestLen;
            for (let si = 0; si < stopWords.length; si++) {
              const sw = stopWords[si];
              // pula se o stop é o próprio hint que abriu a seção
              if (hints.some((h: string) => h.toLowerCase().includes(sw) || sw.includes(h.toLowerCase()))) {
                // só ignora se o match do stop está dentro do header
                const j0 = lower.indexOf(sw, start);
                if (j0 >= start && j0 < headerEnd + 5) continue;
              }
              const j = lower.indexOf(sw, headerEnd + 5);
              if (j > start && j < end) end = j;
            }
            const slice = body.slice(start, end);
            const lines = slice.split(/\n+/).map((s) => s.trim()).filter(Boolean);
            // Detecta se a grade ativa no texto é 1–3 ou 4–6 (headers N+)
            const headerCols: number[] = [];
            for (let hi = 0; hi < Math.min(lines.length, 40); hi++) {
              const hm = lines[hi].match(/^([1-6])\+$/);
              if (hm) {
                const n = parseInt(hm[1], 10);
                if (!headerCols.includes(n)) headerCols.push(n);
              }
              if (headerCols.length >= 6) break;
            }
            const wantLow = colNums[0] <= 3 && colNums.every((c: number) => c <= 3);
            const wantHigh = colNums[0] >= 4;
            const hLow = headerCols.filter((c) => c <= 3);
            const hHigh = headerCols.filter((c) => c >= 4);
            if (wantLow && hHigh.length >= 2 && hLow.length === 0) {
              return []; // body ainda em 4–6
            }
            if (wantHigh && hLow.length >= 2 && hHigh.length === 0) {
              return []; // body ainda em 1–3
            }
            const out: Array<{ playerName: string; market: string; odds: number[] }> = [];
            const seen: Record<string, boolean> = {};

            for (let i = 0; i < lines.length; i++) {
              let rawLine = lines[i];
              if (rawLine.length < 3 || rawLine.length > 80) continue;
              if (!/^[A-ZÀ-Ü]/.test(rawLine)) continue;
              if (/[\/|]/.test(rawLine)) continue;
              if (
                /^(mostrar|chutes|faltas|jogador|comete|desarmes|1\+|2\+|3\+|4\+|5\+|6\+|a - z|cada|tempo|substitui)/i.test(
                  rawLine,
                )
              ) {
                continue;
              }

              // Suporta "Kaio Jorge 1.04 1.14 1.53" na mesma linha
              const sameLineOdds: number[] = [];
              const oddRe = /\d+[.,]\d+|\b[2-9]\d?\b/g;
              let m: RegExpExecArray | null;
              const namePart = rawLine.replace(oddRe, '').replace(/\s+/g, ' ').trim();
              oddRe.lastIndex = 0;
              while ((m = oddRe.exec(rawLine)) !== null) {
                const rawTok = m[0].replace(',', '.');
                const v = parseFloat(rawTok);
                if (!isNaN(v) && v > 1.01 && v < 80) sameLineOdds.push(v);
              }
              const name = namePart || rawLine;
              if (name.length < 3 || name.length > 40) continue;
              if (/\d[.,]\d/.test(name)) continue;
              if (!/[a-zà-ü]/.test(name) && name.split(/\s+/).length < 2) continue;

              const odds: number[] = sameLineOdds.slice();
              if (odds.length < colNums.length) {
                for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
                  const tok = lines[j];
                  if (
                    /^[A-ZÀ-Ü]/.test(tok) &&
                    tok.length >= 3 &&
                    !/\d[.,]\d/.test(tok) &&
                    !/^[1-6]\+$/.test(tok)
                  ) {
                    if (/[a-zà-ü]/.test(tok) || tok.split(/\s+/).length >= 2) break;
                  }
                  if (/^[1-6]\+$/.test(tok)) continue;
                  if (/^(mostrar|a - z|tempo|substitui)/i.test(tok)) continue;
                  const rawTok = tok.replace(',', '.');
                  const v = parseFloat(rawTok);
                  if (
                    !isNaN(v) &&
                    v > 1.01 &&
                    v < 80 &&
                    (rawTok.includes('.') || rawTok.includes(',') || v >= 2)
                  ) {
                    odds.push(v);
                    if (odds.length >= colNums.length) break;
                  }
                }
              }
              if (odds.length === 0) continue;
              // Precisa de pelo menos 2 odds na grade multi-coluna (evita 1 odd errado)
              if (colNums.length >= 3 && odds.length < 2) continue;
              const key = mkt + '|' + name.toLowerCase();
              if (seen[key]) continue;
              seen[key] = true;
              out.push({ playerName: name, market: mkt, odds });
            }
            return out;
          },
          { colNums: cols, mkt: market, hints: headerHints, stops: extraStopWords },
        );
        const mapped: Array<{ playerName: string; line: string; value: number; market: string }> = [];
        for (const r of raw || []) {
          if (!isLikelyPlayerName(r.playerName)) continue;
          for (const m of mapMultiColumnOdds(r.odds, cols)) {
            mapped.push({
              playerName: r.playerName,
              line: m.line,
              value: m.value,
              market: r.market,
            });
          }
        }
        return mapped;
      } catch {
        return [];
      }
    }

    async function harvestShots(
      cols: number[],
      forcedLine?: string,
      /**
       * Se definido, só mescla odds desse mercado.
       * Crítico: harvest SOT [3,4] NÃO pode reescrever finalização 3+/4+
       * com a grade "Chutes por jogador" ainda em 4+/5+/6+.
       */
      onlyMarket?: 'finalizacao' | 'chutes_ao_gol',
    ): Promise<number> {
      // Sempre tenta multi-coluna + DOM + body-text e MESCLA (não short-circuit).
      // force-betfair-123 prova que body-text sozinho traz Kaio 1+/2+/3+;
      // se multi-col devolver lixo parcial, body completa as linhas que faltam.
      const parts: Array<{ playerName: string; line: string; value: number; market: string }>[] = [];
      parts.push(await extractShotsMultiColumn(cols, forcedLine));
      parts.push(await extractDomOdds(forcedLine, cols));
      const wantFin =
        !onlyMarket || onlyMarket === 'finalizacao';
      const wantSot =
        !onlyMarket || onlyMarket === 'chutes_ao_gol';
      if (
        wantFin &&
        cols[0] <= 3 &&
        cols.includes(1) &&
        cols.includes(2) &&
        cols.includes(3)
      ) {
        parts.push(
          await extractShotsFromBodyText(cols, 'finalizacao', [
            'chutes por jogador',
            'total de chutes',
          ]),
        );
      }
      if (
        wantSot &&
        (cols[0] <= 2 || (cols.length <= 2 && cols.every((c) => c <= 4)))
      ) {
        parts.push(
          await extractShotsFromBodyText(cols, 'chutes_ao_gol', [
            'chutes no gol do jogador',
            'chutes no gol',
          ]),
        );
      }
      const before = allDomOdds.length;
      for (const part of parts) {
        const filtered = onlyMarket
          ? part.filter((o) => o.market === onlyMarket)
          : part;
        mergeDomOdds(filtered);
      }
      return allDomOdds.length - before;
    }

    /** Conta linhas de finalização já colhidas no DOM (jogadores reais). */
    function finLineCounts(): Record<string, number> {
      const c: Record<string, number> = {};
      for (const o of allDomOdds) {
        if (o.market !== 'finalizacao') continue;
        if (!isLikelyPlayerName(o.playerName)) continue;
        c[o.line] = (c[o.line] || 0) + 1;
      }
      return c;
    }

    function hasFinLines(need: string[]): boolean {
      const c = finLineCounts();
      return need.every((l) => (c[l] || 0) > 0);
    }

    /** Clica TODAS as ocorrências de um label (força BFF a carregar switchers). */
    async function bruteClickLabels(labs: string[]): Promise<number> {
      return page.evaluate((wantLabels) => {
        let n = 0;
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button, span, a, div, [role="tab"], [role="button"], label, li',
          ),
        );
        for (const el of nodes) {
          const t = (el.innerText || '').trim().toLowerCase();
          if (!t || t.length > 24) continue;
          for (let i = 0; i < wantLabels.length; i++) {
            if (t === wantLabels[i].toLowerCase()) {
              try {
                el.scrollIntoView({ block: 'center' });
                el.click();
                n++;
              } catch { /* */ }
              break;
            }
          }
        }
        return n;
      }, labs);
    }

    /**
     * Fluxo real da UI Betfair (dica do user):
     *   1) Clicar aba "1+ até 3+" (ou "4+ a 6+")
     *   2) DEPOIS clicar "Mostrar mais" — senão a lista fica truncada
     *      e jogadores como Kaio Jorge somem.
     *
     * Prioriza botões perto de "chutes por jogador" / "chutes no gol".
     */
    async function clickShowMoreNear(
      preferNear: string[] = ['chutes por jogador', 'chutes no gol', 'finaliz'],
      maxRounds = 6,
    ): Promise<number> {
      let total = 0;
      for (let round = 0; round < maxRounds; round++) {
        // 1) Playwright getByText — pega o botão mesmo com markup estranho
        let pwClicks = 0;
        try {
          const loc = page.getByText(/mostrar\s+mais/i);
          const n = await loc.count();
          for (let i = 0; i < Math.min(n, 6); i++) {
            try {
              const el = loc.nth(i);
              if (await el.isVisible().catch(() => false)) {
                await el.click({ timeout: 600, force: true });
                pwClicks++;
              }
            } catch { /* */ }
          }
        } catch { /* */ }

        // 2) evaluate com score por proximidade do card
        const n = await page.evaluate((prefs) => {
          const nodes = Array.from(
            document.querySelectorAll<HTMLElement>('button, span, a, div, [role="button"], p, li'),
          );
          const cands: { el: HTMLElement; score: number }[] = [];
          for (let i = 0; i < nodes.length; i++) {
            const el = nodes[i];
            // preferir texto próprio curto do nó (não o card inteiro)
            let t = '';
            const kids = el.childNodes;
            for (let ki = 0; ki < kids.length; ki++) {
              if (kids[ki].nodeType === 3) {
                const x = (kids[ki].textContent || '').trim();
                if (x) t += (t ? ' ' : '') + x;
              }
            }
            if (!t) t = (el.innerText || el.textContent || '').trim();
            const tl = t.toLowerCase().replace(/\s+/g, ' ');
            const isShowMore =
              tl === 'mostrar mais' ||
              tl === 'ver mais' ||
              tl === 'show more' ||
              tl === 'mostrar todos' ||
              /^mostrar mais$/i.test(tl) ||
              (tl.includes('mostrar mais') && tl.length <= 40);
            if (!isShowMore) continue;
            if (tl.length > 48) continue;

            let score = 5;
            let p: HTMLElement | null = el;
            for (let d = 0; d < 12 && p; d++) {
              const blob = (p.innerText || '').toLowerCase().slice(0, 400);
              for (let pi = 0; pi < prefs.length; pi++) {
                if (blob.includes(prefs[pi].toLowerCase())) score += 25;
              }
              if (blob.includes('comete uma falta') || blob.includes('marcador a qualquer')) score -= 10;
              p = p.parentElement;
            }
            cands.push({ el, score });
          }
          cands.sort((a, b) => b.score - a.score);
          let clicks = 0;
          for (let ci = 0; ci < Math.min(5, cands.length); ci++) {
            try {
              cands[ci].el.scrollIntoView({ block: 'center', inline: 'nearest' });
              cands[ci].el.click();
              clicks++;
            } catch { /* */ }
          }
          return clicks;
        }, preferNear);

        const roundClicks = Math.max(pwClicks, n);
        total += roundClicks;
        if (roundClicks === 0) break;
        await waitForBetfairData(page, 800);
        await page.waitForTimeout(400);
      }
      if (total > 0) {
        logger.info(`[Betfair] "Mostrar mais" clicado ${total}x (após range tab)`);
      }
      return total;
    }

    // ═══ FINALIZAÇÃO = "Chutes por jogador" ═══
    // Sequência CANÔNICA = scripts/force-betfair-123.mjs (PASS live):
    //   scroll+mostrar-mais → clicar TODAS abas → 1+ até 3+ → Mostrar mais → harvest 1|2|3
    const preferFin = ['chutes por jogador', 'total de chutes', 'finaliz'];
    const avoidFin = ['comete uma falta', 'faltas comet', 'falta sofr', 'cartão', 'marcador'];

    /** Mostrar mais simples (igual force) — clickShowMoreNear às vezes dava showMore=0. */
    async function forceShowMoreSimple(rounds = 8): Promise<number> {
      let total = 0;
      for (let r = 0; r < rounds; r++) {
        const n = await page.evaluate(() => {
          let c = 0;
          for (const el of Array.from(
            document.querySelectorAll<HTMLElement>('button,span,a,div,[role="button"]'),
          )) {
            const t = (el.innerText || '').trim().toLowerCase().replace(/\s+/g, ' ');
            if (t.includes('mostrar mais') && t.length < 40) {
              try { el.click(); c++; } catch { /* */ }
            }
          }
          return c;
        });
        total += n;
        if (n === 0) break;
        await page.waitForTimeout(600);
      }
      return total;
    }

    // 0) Scroll agressivo + mostrar mais DURANTE o scroll (force)
    for (let i = 0; i < 16; i++) {
      await page.evaluate(() => {
        window.scrollBy(0, 900);
        document.querySelectorAll('div').forEach((el) => {
          const s = getComputedStyle(el);
          if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
            try { el.scrollBy(0, 900); } catch { /* */ }
          }
        });
      });
      await page.waitForTimeout(220);
      if (i % 4 === 3) {
        await forceShowMoreSimple(1);
        await page.waitForTimeout(400);
      }
    }

    const shotsLoaded = await ensureShotsCardsLoaded();
    logger.info(`[Betfair] Card "Chutes por jogador" carregado=${shotsLoaded}`);

    // 1) Pré-carga BFF: clicar TODAS as abas de range/coluna
    await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll<HTMLElement>('button, span, a, div, [role="tab"], label, li'),
      );
      for (let i = 0; i < nodes.length; i++) {
        const t = (nodes[i].innerText || '').trim();
        if (!t || t.length > 28) continue;
        if (
          /^[1-6]\+$/.test(t) ||
          /^[1-6]\+\s*(até|a|e|-)/i.test(t) ||
          /até\s*3|a\s*6|e\s*2|e\s*4/i.test(t)
        ) {
          try { nodes[i].click(); } catch { /* */ }
        }
      }
    });
    await waitForBetfairData(page, 2000);
    await page.waitForTimeout(600);

    // 2) Focus 1+ até 3+
    let r13 = await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+', '1+ - 3+', '1+ até 3', '1+ a 3'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    for (const lab of ['1+ até 3+', '1+ a 3+']) {
      try {
        const loc = page.getByText(lab, { exact: true });
        const nLoc = await loc.count();
        for (let i = 0; i < Math.min(nLoc, 5); i++) {
          await loc.nth(i).click({ force: true, timeout: 500 }).catch(() => null);
        }
      } catch { /* */ }
    }
    const brute13 = await bruteClickLabels(['1+ até 3+', '1+ a 3+', '1+ - 3+']);
    await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+', '1+ - 3+'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1600));
    await page.waitForTimeout(1500);

    // 3) Mostrar mais DEPOIS do range
    const showMore13 = await forceShowMoreSimple(8);
    const showMore13b = await clickShowMoreNear(
      ['chutes por jogador', 'total de chutes', 'finaliz', '1+ até 3'],
      4,
    );
    await waitForBetfairData(page, 1000);

    await page.getByText('1+ até 3+', { exact: true }).first().click({ force: true }).catch(() => null);
    await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    await page.waitForTimeout(1000);

    // 4) Harvest multi-col + body (só finalização — não misturar com SOT)
    let added = await harvestShots([1, 2, 3], undefined, 'finalizacao');
    if (added < 6 || !hasFinLines(['1+', '2+', '3+'])) {
      await forceShowMoreSimple(4);
      await page.getByText('1+ até 3+', { exact: true }).first().click({ force: true }).catch(() => null);
      await waitForBetfairData(page, 1200);
      added += await harvestShots([1, 2, 3], undefined, 'finalizacao');
    }

    // 5) Backup por coluna se faltar 1+/2+/3+
    if (!hasFinLines(['1+', '2+', '3+'])) {
      for (const col of ['1+', '2+', '3+']) {
        if (hasFinLines([col])) continue;
        await clickRangeInCard(
          ['1+ até 3+', '1+ a 3+'],
          preferFin,
          [...avoidFin, 'chutes no gol'],
        );
        const n = await clickLineNearShots(col);
        await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1400));
        added += await harvestShots([1, 2, 3], col, 'finalizacao');
        logger.info(
          `[Betfair] Finalização ${col} (faltava): lineClicks=${n} +odds=${added} ` +
            `domFin=${JSON.stringify(finLineCounts())}`,
        );
      }
      await clickRangeInCard(
        ['1+ até 3+', '1+ a 3+'],
        preferFin,
        [...avoidFin, 'chutes no gol'],
      );
      added += await harvestShots([1, 2, 3], undefined, 'finalizacao');
    }

    let api1 = 0;
    let api2 = 0;
    let api3 = 0;
    let api46 = 0;
    try {
      const blob = JSON.stringify(capturedData);
      api1 = (blob.match(/PLAYER_TO_HAVE_1_OR_MORE_SHOTS"/g) || []).length;
      api2 = (blob.match(/PLAYER_TO_HAVE_2_OR_MORE_SHOTS"/g) || []).length;
      api3 = (blob.match(/PLAYER_TO_HAVE_3_OR_MORE_SHOTS"/g) || []).length;
      api46 = (blob.match(/PLAYER_TO_HAVE_[456]_OR_MORE_SHOTS"/g) || []).length;
    } catch { /* */ }
    const finCounts = finLineCounts();
    logger.info(
      `[Betfair] Finalização 1–3: tab=${r13.label} score=${r13.score} clicks=${r13.clicks} ` +
        `brute=${brute13} showMore=${showMore13 + showMore13b} +odds=${added} total=${allDomOdds.length} ` +
        `api1=${api1} api2=${api2} api3=${api3} api4-6=${api46} domFin=${JSON.stringify(finCounts)}`,
    );

    // ── Range 4+ a 6+ → Mostrar mais → extrair ──
    const r46 = await clickRangeInCard(
      ['4+ a 6+', '4+ até 6+', '4+ - 6+', '4+ a 6', '4+ até 6'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    if (r46.clicks === 0) {
      await bruteClickLabels(['4+ a 6+', '4+ até 6+']);
    }
    await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1400));
    await page.waitForTimeout(400);
    const showMore46 = await clickShowMoreNear(
      ['chutes por jogador', 'total de chutes', '4+ a 6', '4+ até 6'],
      6,
    );
    await clickRangeInCard(
      ['4+ a 6+', '4+ até 6+'],
      preferFin,
      [...avoidFin, 'chutes no gol'],
    );
    added = await harvestShots([4, 5, 6], undefined, 'finalizacao');
    logger.info(
      `[Betfair] Finalização 4–6: tab=${r46.label} score=${r46.score} clicks=${r46.clicks} ` +
        `showMore=${showMore46} +odds=${added} total=${allDomOdds.length}`,
    );

    // ═══ CHUTES NO GOL (SOT) = "1+ e 2+" / "3+ e 4+" ═══
    // onlyMarket=chutes_ao_gol: sem isso o extract multi-col/DOM também lê
    // "Chutes por jogador" e reescreve finalização 3+ com a odd do 4+.
    const preferSot = ['chutes no gol', 'shots on target', 'chute no gol'];
    const avoidSot = ['chutes por jogador', 'falta', 'cartão', 'marcador'];

    const s12 = await clickRangeInCard(
      ['1+ e 2+', '1+ e 2', '1+ até 2+'],
      preferSot,
      avoidSot,
    );
    await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1200));
    await clickShowMoreNear(['chutes no gol', 'shots on target'], 4);
    added = await harvestShots([1, 2], undefined, 'chutes_ao_gol');
    logger.info(
      `[Betfair] SOT range 1–2: tab=${s12.label} score=${s12.score} +odds=${added}`,
    );

    const s34 = await clickRangeInCard(
      ['3+ e 4+', '3+ e 4', '3+ até 4+'],
      preferSot,
      avoidSot,
    );
    await waitForBetfairData(page, Math.max(TAB_NETWORK_MS, 1200));
    await clickShowMoreNear(['chutes no gol', 'shots on target'], 4);
    added = await harvestShots([3, 4], undefined, 'chutes_ao_gol');
    logger.info(
      `[Betfair] SOT range 3–4: tab=${s34.label} score=${s34.score} +odds=${added}`,
    );

    // Complemento: desarmes/faltas
    const expandedAfter = await expandMarketSections();
    logger.info(`[Betfair] Seções pós-chutes: ${expandedAfter}`);

    // ═══ FALTAS COMETIDAS = "Jogador comete uma falta" ═══
    // Recarrega a página do jogo e roda a sequência PROVADA (scripts/_force-faltas.mjs):
    // após o fluxo de chutes o DOM fica em estado errado (odds 1.22/2/3.7 em vez de 1.04/1.22/1.91).
    const preferFalta = [
      'jogador comete uma falta',
      'comete uma falta',
      'jogador comete',
    ];
    const avoidFalta = [
      'chutes por jogador',
      'chutes no gol',
      'shot',
      'desarme',
      'cartão',
      'marcador',
      'finaliz',
    ];

    for (let i = allDomOdds.length - 1; i >= 0; i--) {
      if (allDomOdds[i].market === 'faltas_cometidas') allDomOdds.splice(i, 1);
    }

    try {
      await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
      await waitForBetfairData(page, 2000);
      await page.waitForTimeout(1500);

      // force-faltas: scroll + mostrar mais
      for (let i = 0; i < 16; i++) {
        await page.evaluate(() => {
          window.scrollBy(0, 900);
          document.querySelectorAll('div').forEach((el) => {
            const s = getComputedStyle(el);
            if (
              (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
              el.scrollHeight > el.clientHeight
            ) {
              try {
                el.scrollBy(0, 900);
              } catch { /* */ }
            }
          });
        });
        await page.waitForTimeout(220);
        if (i % 4 === 3) await forceShowMoreSimple(1);
      }

      // Clica abas de range genéricas
      await page.evaluate(() => {
        for (const el of Array.from(
          document.querySelectorAll<HTMLElement>(
            'button,span,a,div,[role="tab"],label,li',
          ),
        )) {
          const t = (el.innerText || '').trim();
          if (!t || t.length > 28) continue;
          if (
            /^[1-6]\+$/.test(t) ||
            /^[1-6]\+\s*(até|a|e|-)/i.test(t) ||
            /até\s*3|a\s*6/i.test(t)
          ) {
            try {
              el.click();
            } catch { /* */ }
          }
        }
      });
      await page.waitForTimeout(1000);

      // Clica 1+ até 3+ priorizando card "comete uma falta"
      const fClick = await page.evaluate(() => {
        const want = ['1+ até 3+', '1+ a 3+'];
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>(
            'button,span,a,div,[role="tab"],label,li',
          ),
        );
        const cands: { el: HTMLElement; score: number }[] = [];
        for (let i = 0; i < nodes.length; i++) {
          const el = nodes[i];
          const t = (el.innerText || '').trim();
          if (!want.includes(t)) continue;
          let score = 1;
          let p: HTMLElement | null = el;
          for (let d = 0; d < 10 && p; d++) {
            const blob = (p.innerText || '').toLowerCase().slice(0, 300);
            if (blob.includes('comete uma falta') || blob.includes('jogador comete')) {
              score += 30;
            }
            if (blob.includes('chutes por') || blob.includes('desarme')) score -= 15;
            p = p.parentElement;
          }
          cands.push({ el, score });
        }
        cands.sort((a, b) => b.score - a.score);
        let n = 0;
        for (let ci = 0; ci < Math.min(4, cands.length); ci++) {
          try {
            cands[ci].el.scrollIntoView({ block: 'center' });
            cands[ci].el.click();
            n++;
          } catch { /* */ }
        }
        return { n, top: cands[0]?.score ?? -1 };
      });
      await page.waitForTimeout(1500);
      const smFalta = await forceShowMoreSimple(6);
      await page.waitForTimeout(500);

      const faltaBody = await extractShotsFromBodyText(
        [1, 2, 3],
        'faltas_cometidas',
        ['jogador comete uma falta'],
        ['desarmes', 'chutes por jogador', 'chutes no gol', 'cartões'],
      );
      mergeDomOdds(faltaBody);

      const byF: Record<string, Record<string, number>> = {};
      const faltaCounts: Record<string, number> = {};
      for (const o of allDomOdds) {
        if (o.market !== 'faltas_cometidas') continue;
        faltaCounts[o.line] = (faltaCounts[o.line] || 0) + 1;
        if (!byF[o.playerName]) byF[o.playerName] = {};
        byF[o.playerName][o.line] = o.value;
      }
      const refLog = ['Luighi', 'Wallisson', 'Fernando Sobral', 'Jhon Arias']
        .map((name) => {
          const hit = Object.entries(byF).find(([p]) =>
            p.toLowerCase().includes(name.toLowerCase().split(' ')[0]),
          );
          return hit ? `${hit[0]}=${JSON.stringify(hit[1])}` : null;
        })
        .filter(Boolean);
      logger.info(
        `[Betfair] Faltas cometidas (reload+force): clickN=${fClick.n} topScore=${fClick.top} ` +
          `showMore=${smFalta} byLine=${JSON.stringify(faltaCounts)} refs=${JSON.stringify(refLog)}`,
      );
    } catch (e) {
      logger.warn(`[Betfair] Faltas force-reload falhou: ${String(e)}`);
      // fallback sem reload
      await clickRangeInCard(
        ['1+ até 3+', '1+ a 3+'],
        preferFalta,
        avoidFalta,
      );
      mergeDomOdds(
        await extractShotsFromBodyText(
          [1, 2, 3],
          'faltas_cometidas',
          ['jogador comete uma falta'],
        ),
      );
    }

    // Faltas sofridas
    await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+'],
      ['falta sofr', 'sofre', 'faltas ganhas'],
      ['chutes', 'comet', 'desarme'],
    );
    await page.waitForTimeout(300);
    mergeDomOdds(
      await extractShotsFromBodyText(
        [1, 2, 3],
        'faltas_sofridas',
        ['faltas sofridas', 'falta sofrida', 'jogador sofre'],
        ['comete uma falta', 'desarmes', 'chutes'],
      ),
    );

    // Desarmes / tackles
    await clickRangeInCard(
      ['1+ até 3+', '1+ a 3+', '1+', '2+', '3+'],
      ['desarme', 'tackle', 'abordag'],
      ['chutes', 'falta', 'shot'],
    );
    await forceShowMoreSimple(2).catch(() => 0);
    await page.waitForTimeout(300);
    mergeDomOdds(
      await extractShotsFromBodyText(
        [1, 2, 3],
        'desarmes',
        ['desarmes', 'desarme', 'tackles'],
        ['comete uma falta', 'chutes', 'faltas'],
      ),
    );

    if (allDomOdds.length > 0) {
      const byMarketLine: Record<string, number> = {};
      for (const o of allDomOdds) {
        const k = `${o.market}:${o.line}`;
        byMarketLine[k] = (byMarketLine[k] || 0) + 1;
      }
      capturedData.push({
        url: matchUrl + '#dom-odds',
        pageUrl: matchUrl,
        data: {
          _domOdds: allDomOdds,
          _homeTeam: teams.homeTeam,
          _awayTeam: teams.awayTeam,
        },
      });
      logger.info(
        `[Betfair] DOM odds: ${allDomOdds.length} (${teams.homeTeam} x ${teams.awayTeam}) by=${JSON.stringify(byMarketLine)} sample=${JSON.stringify(allDomOdds.slice(0, 6))}`,
      );
    }

    // Scroll final p/ lazy API (mais curto no fast)
    const endScrolls = IS_FAST ? 2 : 4;
    for (let i = 0; i < endScrolls; i++) {
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(IS_FAST ? 120 : 200);
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

// ─── Extração de dados da API capturada ──────────────────────────────────────

/**
 * Walk recursivo: acha marketType *SHOTS* + runners + live odds.
 * Complementa extractFromBffCard (que depende de Cards/edges).
 * Validado por force-betfair-123 → Kaio finalizacao 1+=1.04 2+=1.14 3+=1.53.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractShotMarketsDeepWalk(
  root: any,
  pageUrl: string | undefined,
  competitionKey: string,
): ScrapedMatch[] {
  const oddsAcc: ScrapedOdd[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const walk = (obj: any) => {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      obj.forEach(walk);
      return;
    }
    const mt = String(obj.marketType ?? obj.market?.marketType ?? '');
    if (mt && /SHOT/i.test(mt)) {
      const info = mapBetfairMarketType(mt);
      let market = info.market as ScrapedOdd['market'] | undefined;
      let line = info.line;
      const mname = String(obj.name ?? obj.market?.name ?? '');
      if (!line) line = normalizeLine(mname) || undefined;
      if (!market && /chute|shot|finaliz/i.test(mname)) {
        market = /gol|target/i.test(mname) ? 'chutes_ao_gol' : 'finalizacao';
      }
      // Só mercados de chute (evita misturar com outros)
      if (
        market &&
        line &&
        (market === 'finalizacao' || market === 'chutes_ao_gol')
      ) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const runners: any[] = obj.runners ?? obj.market?.runners ?? [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const live: any[] =
          obj.liveData?.runners ?? obj.market?.liveData?.runners ?? [];
        for (const r of runners) {
          const playerName = String(r.name ?? r.displayName?.name ?? '');
          if (!isLikelyPlayerName(playerName)) continue;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lr = live.find(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (x: any) =>
              x.selectionId === r.selectionId || x.runnerURN === r.runnerURN,
          );
          const val = parseFloat(
            String(lr?.odds?.decimal ?? lr?.displayOdds?.decimal ?? 0),
          );
          if (!(val > 1) || val >= 200) continue;
          oddsAcc.push({
            playerName,
            team: '',
            line,
            value: val,
            house: 'betfair',
            market,
            url: pageUrl,
            competition: competitionKey,
          });
        }
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(root);
  if (oddsAcc.length === 0) return [];
  // Times do slug da URL (.../atletico-mg-x-bahia/e-...) — NÃO do último path (e-id)
  const teams = teamsFromMatchUrl(pageUrl || '');
  return [
    {
      homeTeam: teams.homeTeam || '',
      awayTeam: teams.awayTeam || '',
      dateTime: new Date(),
      stage: extractStage(pageUrl ?? ''),
      competition: competitionKey,
      odds: oddsAcc,
    },
  ];
}

/** Parse "internacional-x-cruzeiro" do path da URL do evento. */
function teamsFromMatchUrl(url: string): { homeTeam: string; awayTeam: string } {
  const parts = (url || '').toLowerCase().split('/');
  let slug = parts.find((p) => p.includes('-x-') && p.length < 80) || '';
  if (!slug) {
    slug = parts.find((p) => /-x-/.test(p)) || '';
  }
  if (!slug) return { homeTeam: '', awayTeam: '' };
  slug = slug.split('?')[0];
  const [h, a] = slug.split('-x-');
  const cap = (s: string) =>
    decodeURIComponent(s || '')
      .replace(/-/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  return { homeTeam: cap(h), awayTeam: cap(a) };
}

/** Remove linhas de um trio over não monotônico (por jogador+mercado). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dropNonMonotonicOverRows(rows: any[]): any[] {
  const byKey = new Map<string, any[]>();
  for (const o of rows) {
    const m = String(o.market ?? '');
    if (
      m !== 'finalizacao' &&
      m !== 'chutes_ao_gol' &&
      m !== 'faltas_cometidas' &&
      m !== 'faltas_sofridas' &&
      m !== 'desarmes'
    ) {
      continue;
    }
    const k = `${m}|${o.playerName}`;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(o);
  }
  const drop = new Set<string>();
  for (const [, group] of byKey) {
    const byLine: Record<string, number> = {};
    for (const r of group) byLine[String(r.line)] = Number(r.value);
    for (const band of [
      ['1+', '2+', '3+'],
      ['4+', '5+', '6+'],
    ]) {
      const vals = band.map((l) => byLine[l]).filter((v) => typeof v === 'number' && v > 1);
      if (vals.length >= 3 && !isStrictlyIncreasingOdds(vals)) {
        for (const l of band) {
          if (byLine[l] != null) {
            drop.add(`${group[0].market}|${group[0].playerName}|${l}`);
          }
        }
      }
    }
    // 3+ poluído com odd do 4+ (3+ === 4+ ou 3+ > 4+) → descarta só o 3+
    if (
      byLine['3+'] != null &&
      byLine['4+'] != null &&
      !(byLine['4+'] > byLine['3+'] + 1e-9)
    ) {
      drop.add(`${group[0].market}|${group[0].playerName}|3+`);
    }
  }
  if (drop.size === 0) return rows;
  return rows.filter(
    (o) => !drop.has(`${o.market}|${o.playerName}|${o.line}`),
  );
}

/**
 * Processa um payload de API capturado e extrai ScrapedMatches.
 * Suporta:
 * 1. Betfair Sportsbook BFF (GraphQL) — `data.Cards[]`
 * 2. SSR preloaded data — `data.__TBD_PRELOADED_CATALOG__`
 * 3. Odds do DOM (`_domOdds`) — após clicar abas 1+/2+/3+
 * 4. Deep walk de marketType SHOTS (1+/2+/3+ total shots)
 *
 * NOTA: Exchange API foi removida (as odds não correspondem ao Sportsbook).
 */
function extractMatchesFromApiData(
  captured: { url: string; data: unknown; pageUrl?: string },
  marketPricesMap: Map<string, number>,
  competitionKey: string,
): ScrapedMatch[] {
  const matches: ScrapedMatch[] = [];
  const { data, pageUrl } = captured;

  if (!data) return matches;

  const items = Array.isArray(data) ? data : [data];

  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const obj = item as Record<string, any>;

    // ── Formato DOM: odds após clicar 1+/2+/3+ em "Chutes por Jogador" ──
    if (Array.isArray(obj._domOdds) && obj._domOdds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let filtered = (obj._domOdds as any[]).filter((o) =>
        isLikelyPlayerName(String(o.playerName ?? '')),
      );
      // Descarta triples over não monotônicos (1+===3+ etc.)
      filtered = dropNonMonotonicOverRows(filtered);
      const urlTeams = teamsFromMatchUrl(pageUrl || '');
      const homeTeam = String(obj._homeTeam || urlTeams.homeTeam || '');
      const awayTeam = String(obj._awayTeam || urlTeams.awayTeam || '');
      if (filtered.length > 0) {
        matches.push({
          homeTeam,
          awayTeam,
          dateTime: new Date(),
          stage: extractStage(pageUrl ?? ''),
          competition: competitionKey,
          odds: filtered.map((o) => ({
            playerName: String(o.playerName ?? ''),
            line: String(o.line ?? ''),
            value: Number(o.value),
            market: String(o.market ?? ''),
            house: 'betfair' as const,
            team: '',
            url: pageUrl,
            competition: competitionKey,
          })),
        });
      }
      continue;
    }

    // ── Deep walk: marketType SHOTS (1/2/3 total) que o card switcher carrega ──
    // force-betfair-123 prova que isso traz Kaio 1+=1.04 2+=1.14 3+=1.53
    {
      const deep = extractShotMarketsDeepWalk(obj, pageUrl, competitionKey);
      if (deep.length > 0) matches.push(...deep);
    }

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
    // Alguns payloads trazem o card na raiz
    if (Array.isArray(obj.Cards)) cards = cards.concat(obj.Cards);
    if (Array.isArray(obj.GenericSwitcherCard)) cards = cards.concat(obj.GenericSwitcherCard);
    
    if (cards.length > 0) {
      for (const card of cards) {
        const extracted = extractFromBffCard(card, pageUrl, marketPricesMap, competitionKey);
        matches.push(...extracted);
      }
    }

  }

  return matches;
}

/** @see marketMap.fromBetfairMarketType */
function fromBetfairMarketType(marketType: string): { market?: string; line?: string } {
  return mapBetfairMarketType(marketType);
}

/**
 * Tenta achar a linha (1+/2+/…) no card/switcher/mercado do BFF.
 * Em "Chutes por Jogador" o nome do mercado muitas vezes NÃO traz a linha —
 * ela vem no filtro/switcher selecionado (ex: "2+").
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractLineFromBffContext(card: any, market: any, mWrap: any, marketName: string, cardTitle: string): string {
  const candidates: string[] = [
    marketName,
    cardTitle,
    String(market?.name ?? ''),
    String(market?.handicap ?? ''),
    String(market?.line ?? ''),
    String(market?.marketHandicap ?? ''),
    String(mWrap?.handicap ?? ''),
    String(mWrap?.line ?? ''),
    String(card?.selectedOption ?? ''),
    String(card?.selectedFilter ?? ''),
    String(card?.activeSwitcher?.label ?? ''),
    String(card?.switcher?.selected?.label ?? ''),
    String(card?.switcher?.selected?.name ?? ''),
    String(card?.switcher?.selectedOption?.translated ?? ''),
    String(card?.filter?.selected?.translated ?? ''),
    String(card?.pebbleCardGroupTitle?.translated ?? ''),
  ];

  // switchers / tabs arrays comuns no GenericSwitcherCard
  const switcherArrays = [
    card?.switchers,
    card?.tabs,
    card?.filters,
    card?.options,
    card?.full?.switchers,
  ];
  for (const arr of switcherArrays) {
    if (!Array.isArray(arr)) continue;
    for (const s of arr) {
      if (!s || typeof s !== 'object') continue;
      if (s.selected === true || s.isSelected === true || s.active === true) {
        candidates.push(String(s.label ?? s.name ?? s.translated ?? s.title ?? s.value ?? ''));
      }
    }
  }

  for (const c of candidates) {
    const line = normalizeLine(c);
    if (line) return line;
  }

  // handicap numérico solto
  for (const raw of [market?.handicap, market?.line, mWrap?.handicap]) {
    const h = parseFloat(String(raw ?? '').replace(',', '.'));
    if (!Number.isFinite(h) || h < 0 || h >= 20) continue;
    if (Math.abs(h % 1 - 0.5) < 0.01) return `${Math.floor(h) + 1}+`;
    if (Number.isInteger(h) && h >= 1) return `${h}+`;
  }

  return '';
}

/** Extrai matches de um card do formato BFF (Betfair Sportsbook GraphQL). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFromBffCard(card: any, pageUrl?: string, marketPricesMap?: Map<string, number>, competitionKey?: string): ScrapedMatch[] {
  const matches: ScrapedMatch[] = [];
  if (!card || typeof card !== 'object') return matches;

  const cardTitle: string = String(
    card.cardGroupTitle ?? card.pebbleCardGroupTitle?.translated ?? card.title ?? '',
  ).toLowerCase();

  const isTackleCard = TACKLE_KEYWORDS.some(kw => cardTitle.includes(kw));
  const isPromoCard = cardTitle.includes('aumentada') || cardTitle.includes('boost');

  // Cards de "Chutes por Jogador" às vezes vêm só como GenericSwitcher sem keyword no title
  const isShotsSwitcher =
    /chute|shot|finaliz/i.test(cardTitle) ||
    /chute|shot|finaliz/i.test(String(card?.switcher?.name ?? card?.marketName ?? ''));

  if (!isTackleCard && !isPromoCard && !isShotsSwitcher) return matches;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const edges: any[] = card.full?.edges ?? card.edges ?? [];

  // Linha do switcher do card (compartilhada por todos os runners do card)
  const cardLevelLine = extractLineFromBffContext(card, {}, {}, '', cardTitle);

  for (const edge of edges) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const markets: any[] = edge?.node?.markets ?? [];
    if (edge?.node?.market) markets.push({ market: edge.node.market });
    // Linha às vezes vem no próprio edge (switcher option)
    const edgeLine = normalizeLine(
      String(
        edge?.node?.label ??
          edge?.node?.name ??
          edge?.node?.title ??
          edge?.node?.translated ??
          edge?.label ??
          '',
      ),
    );

    for (const m of markets) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const market: Record<string, any> = m.market ?? m ?? {};
      const marketName: string = String(market.name ?? '');
      const marketNameLower = marketName.toLowerCase();

      const isTackleMarket = TACKLE_KEYWORDS.some(kw => marketNameLower.includes(kw));
      // Em cards de chutes, o market.name pode ser só o nome do jogador
      // ou vazio — ainda assim processamos se o card é de shots.
      if (!isTackleMarket && !isTackleCard && !isShotsSwitcher) continue;

      const typeInfo = fromBetfairMarketType(String(market.marketType ?? m.marketType ?? ''));
      let marketKey =
        typeInfo.market ||
        resolveBetfairMarketKey(marketNameLower, cardTitle);
      // Card de chutes com market name = nome do jogador (sem keyword)
      if (!marketKey && (isShotsSwitcher || /chute|finaliz|shot/.test(cardTitle))) {
        // "Chutes no gol" no título do card → chutes_ao_gol; senão finalizacao
        marketKey = /chute.*gol|shots on target/i.test(cardTitle)
          ? 'chutes_ao_gol'
          : 'finalizacao';
      }

      // Pula mercados não suportados / desconhecidos
      if (!marketKey || marketKey === 'envolvimentos_faltas') continue;
      // Faltas cometidas: fonte da verdade é o DOM multi-col
      // ("Jogador comete uma falta" → 1+|2+|3+). O BFF manda linhas/odds
      // desalinhadas (ex. Wallisson 1.08/1.4/2.1 em vez de 1.06/1.36/2.3).
      if (marketKey === 'faltas_cometidas') continue;
      // Ignora marcador/cartões etc.
      if (/GOALSCORER|BOOKED|CARD|ASSIST/i.test(String(market.marketType ?? ''))) continue;
      
      const sportevent = market.hierarchy?.sportevent ?? {};
      const eventName: string = String(sportevent.name ?? '');
      if (!eventName) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const runners: any[] = market.runners ?? [];
      const odds: ScrapedOdd[] = [];

      // Linha: marketType (N_OR_MORE) > nome ("1 ou mais") > edge/switcher
      const marketLine =
        typeInfo.line ||
        normalizeLine(marketName) || // "Jogador dá 2 ou mais chutes no gol"
        edgeLine ||
        extractLineFromBffContext(card, market, m, marketName, cardTitle) ||
        cardLevelLine;

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
          const line =
            (isPromoCard ? normalizeLine(playerName) : '') ||
            marketLine ||
            normalizeLine(playerName);

          if (!line) {
            // Sem linha — no DOM path ainda podemos pegar; na API pulamos
            continue;
          }

          // Filtra só odds claramente promocionais (501, 1000…).
          // Antes max 2+=15 matava finalização 2+ de laterais/zagueiros (17–50),
          // e com isso sumiam linhas 1+/2+/3+ inteiras do ranking.
          const lineNum = parseInt(line.replace('+', ''), 10) || 0;
          const maxOddByLine: Record<number, number> = {
            1: 25,
            2: 80,
            3: 150,
            4: 200,
            5: 350,
            6: 500,
          };
          const maxOdd = maxOddByLine[lineNum] || 500;
          if (oddValue > maxOdd) {
            logger.debug(`[Betfair] BFF: odd boostada filtrada: ${playerName} ${line} = ${oddValue} (max: ${maxOdd})`);
            continue;
          }

          const cleanName = isPromoCard ? cleanPromoPlayerName(playerName) : playerName;
          if (!isLikelyPlayerName(cleanName)) continue;

          odds.push({
            playerName: cleanName,
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
            competition: competitionKey,
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
          competition: competitionKey,
          odds,
        });
      }
    }
  }

  return matches;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
