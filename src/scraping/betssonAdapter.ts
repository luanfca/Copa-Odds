/**
 * Adaptador de scraping para Betsson Brasil.
 *
 * Estratégia em camadas:
 * 1. API direta (sem browser) — tenta endpoints internos plausíveis baseados
 *    no padrão de mercado de outras casas (BetMGM/Superbet). Betsson costuma
 *    expor JSON em rotas /api/v1/ ou via CDN.
 * 2. Playwright com stealth — se a API direta falhar ou retornar 0 jogos,
 *    abre a SPA AngularJS da Betsson, intercepta respostas XHR com palavras-
 *    chave de desarmes/faltas e extrai odds via DOM/JSON.
 *
 * APIs plausíveis testadas (sujeito a mudança pela Betsson):
 *  - https://www.betsson.bet.br/api/v1/sports/football/events
 *  - https://www.betsson.bet.br/api/v2/events?competitionId=...
 *  - https://cdn.betsson.com/events
 *
 * O Betsson BR é uma SPA AngularJS com proteção anti-bot. Por isso o fallback
 * Playwright usa puppeteer-extra-plugin-stealth (já instalado em package.json).
 *
 * MUDANÇAS:
 * - Sem `BrowserContext` na assinatura (igual betmgm/superbet) — recebe via parâmetro
 *   opcional apenas se o fallback Playwright for ativado, para manter a interface
 *   consistente com os outros adapters que rodam em paralelo sem browser.
 */

import { logger } from '../lib/logger';
import { normalizePlayerNameFormat, normalizeLine, extractStage } from '../lib/normalize';
import type { ScrapedMatch, ScrapedOdd } from '../types/scraping';
import type { BrowserContext } from 'playwright';

// ─── Configuração ─────────────────────────────────────────────────────────────

/**
 * Endpoints candidatos da API Betsson Brasil.
 *
 * Estes são chutes educados baseados no padrão do mercado (BetMGM, Superbet,
 * Betfair). Betsson atualiza rotas com frequência — se todos falharem, o
 * fallback Playwright é acionado.
 *
 * Cada candidato é tentado em ordem até que um retorne 200 OK com JSON válido.
 */
const BETSSON_API_CANDIDATES: ReadonlyArray<string> = [
  'https://www.betsson.bet.br/api/v1/sports/football/events',
  'https://www.betsson.bet.br/api/v2/sports/football/events',
  'https://www.betsson.bet.br/api/sports/football/events',
];

const BETSSON_BASE = 'https://www.betsson.bet.br';

const COPA_KEYWORDS = [
  'copa do mundo', 'world cup', 'fifa', 'mundial', 'world cup 2026',
] as const;

const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Accept': 'application/json',
  'Accept-Language': 'pt-BR,pt;q=0.9',
  'Referer': 'https://www.betsson.bet.br/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Origin': 'https://www.betsson.bet.br',
};

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 500;

const delay = (ms: number): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, ms));

// ─── Tipos internos ───────────────────────────────────────────────────────────

interface BetssonEvent {
  id: string | number;
  homeTeam?: string;
  awayTeam?: string;
  startTime?: string;
  leagueName?: string;
  tournamentName?: string;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Ponto de entrada do scraping Betsson.
 *
 * Fluxo:
 * 1. Tenta descobrir eventos da Copa via API direta (candidatos em BETSSON_API_CANDIDATES).
 * 2. Se a API retornar eventos, busca mercados de jogador em paralelo.
 * 3. Se nada funcionar via API, ativa fallback Playwright (se BrowserContext fornecido).
 *
 * @param browserContext - Opcional. Se fornecido E a API direta falhar,
 *   ativa o modo Playwright com interceptação XHR.
 */
export async function scrapeBetsson(browserContext?: BrowserContext): Promise<ScrapedMatch[]> {
  logger.info('[Betsson] Iniciando scraping...');
  const results: ScrapedMatch[] = [];

  // ── Tentativa 1: API direta ──
  try {
    const apiResults = await scrapeViaApi();
    if (apiResults.length > 0) {
      logger.info(`[Betsson] API direta retornou ${apiResults.length} jogos.`);
      return apiResults;
    }
    logger.warn('[Betsson] API direta não retornou jogos. Considerando fallback Playwright...');
  } catch (err) {
    logger.warn('[Betsson] Falha na API direta:', { error: String(err) });
  }

  // ── Tentativa 2: Playwright (fallback) ──
  if (browserContext) {
    try {
      logger.info('[Betsson] Ativando fallback Playwright...');
      const playwrightResults = await scrapeViaPlaywright(browserContext);
      return playwrightResults;
    } catch (err) {
      logger.error('[Betsson] Fallback Playwright também falhou:', { error: String(err) });
    }
  } else {
    logger.warn('[Betsson] BrowserContext não fornecido — pulando fallback Playwright.');
  }

  logger.info(`[Betsson] Scraping finalizado. ${results.length} jogos com odds.`);
  return results;
}

// ─── Camada 1: API direta ─────────────────────────────────────────────────────

/**
 * Tenta cada candidato de endpoint até um retornar eventos da Copa.
 */
async function scrapeViaApi(): Promise<ScrapedMatch[]> {
  const events = await discoverCopaEvents();
  if (events.length === 0) return [];

  logger.info(`[Betsson] ${events.length} jogos da Copa encontrados via API.`);

  const results: ScrapedMatch[] = [];

  // Processa em lotes para não sobrecarregar a API (mesma estratégia do BetMGM)
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    const batchMatches = await fetchPlayerMarketsForEvents(batch);
    results.push(...batchMatches);

    const hasMore = i + BATCH_SIZE < events.length;
    if (hasMore) await delay(BATCH_DELAY_MS);
  }

  return results;
}

/**
 * Descobre eventos da Copa do Mundo tentando cada endpoint candidato.
 * Retorna a primeira lista não-vazia encontrada.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function discoverCopaEvents(): Promise<BetssonEvent[]> {
  for (const endpoint of BETSSON_API_CANDIDATES) {
    try {
      logger.info(`[Betsson] Tentando endpoint: ${endpoint}`);
      const res = await fetch(endpoint, { headers: BASE_HEADERS });

      if (!res.ok) {
        logger.warn(`[Betsson] ${endpoint} → status ${res.status}`);
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const json = await res.json() as any;
      const events = extractEventsFromPayload(json);

      if (events.length === 0) {
        logger.warn(`[Betsson] ${endpoint} → JSON sem eventos reconhecíveis`);
        continue;
      }

      const copaEvents = events.filter(isCopaEvent);
      if (copaEvents.length > 0) {
        logger.info(`[Betsson] ${endpoint} → ${copaEvents.length} eventos da Copa`);
        return copaEvents;
      }
    } catch (err) {
      logger.warn(`[Betsson] ${endpoint} falhou:`, { error: String(err) });
      continue;
    }
  }
  return [];
}

/**
 * Extrai uma lista de eventos de diferentes formatos de payload JSON.
 *
 * Betsson pode responder com:
 * - { events: [...] }
 * - { data: { events: [...] } }
 * - { data: [...] }
 * - [...]
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEventsFromPayload(json: any): BetssonEvent[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let raw: any[] = [];

  if (Array.isArray(json)) {
    raw = json;
  } else if (Array.isArray(json?.events)) {
    raw = json.events;
  } else if (Array.isArray(json?.data)) {
    raw = json.data;
  } else if (Array.isArray(json?.data?.events)) {
    raw = json.data.events;
  } else {
    return [];
  }

  return raw.map(normalizeEvent).filter((e): e is BetssonEvent => e !== null);
}

/**
 * Normaliza um evento de qualquer formato para BetssonEvent.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeEvent(raw: any): BetssonEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id ?? raw.eventId ?? raw.event_id;
  if (id === undefined || id === null) return null;

  const homeTeam =
    raw.homeTeam?.name ?? raw.home_team?.name ?? raw.home?.name ??
    raw.participants?.[0]?.name ?? raw.homeTeamName;
  const awayTeam =
    raw.awayTeam?.name ?? raw.away_team?.name ?? raw.away?.name ??
    raw.participants?.[1]?.name ?? raw.awayTeamName;

  return {
    id,
    homeTeam,
    awayTeam,
    startTime: raw.startTime ?? raw.start_time ?? raw.kickoff ?? raw.startDate,
    leagueName: raw.leagueName ?? raw.league?.name ?? raw.tournamentName ?? raw.categoryName,
    tournamentName: raw.tournamentName ?? raw.tournament?.name ?? raw.categoryName,
  };
}

/** Filtra apenas eventos da Copa do Mundo. */
function isCopaEvent(event: BetssonEvent): boolean {
  const haystack = `${event.leagueName ?? ''} ${event.tournamentName ?? ''}`.toLowerCase();
  return COPA_KEYWORDS.some(kw => haystack.includes(kw));
}

/**
 * Busca mercados de jogador (desarmes/faltas) para um lote de eventos.
 *
 * NOTA: Como o endpoint específico da Betsson é desconhecido, tentamos um
 * padrão genérico `/api/v1/events/{id}/markets`. Se Betsson não responder
 * a este padrão (provável na primeira tentativa), o orquestrador cai no
 * fallback Playwright.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchPlayerMarketsForEvents(events: BetssonEvent[]): Promise<ScrapedMatch[]> {
  const results: ScrapedMatch[] = [];

  // Tenta buscar mercados em paralelo para os eventos do lote
  const marketPromises = events.map(ev => fetchEventMarkets(ev));
  const allMarkets = await Promise.allSettled(marketPromises);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const settled = allMarkets[i];

    if (settled.status !== 'fulfilled' || !settled.value) continue;

    const homeTeam = ev.homeTeam ?? '';
    const awayTeam = ev.awayTeam ?? '';
    if (!homeTeam || !awayTeam) continue;

    const odds = extractOddsFromMarkets(settled.value, homeTeam, ev.id);
    if (odds.length === 0) continue;

    results.push({
      homeTeam,
      awayTeam,
      dateTime: new Date(ev.startTime ?? Date.now()),
      stage: extractStage(ev.leagueName ?? ev.tournamentName ?? ''),
      odds,
    });
  }

  return results;
}

/**
 * Busca mercados de um evento específico.
 * Retorna o JSON bruto de markets ou null se falhar.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchEventMarkets(event: BetssonEvent): Promise<any> {
  const endpoints = [
    `${BETSSON_BASE}/api/v1/events/${event.id}/markets`,
    `${BETSSON_BASE}/api/v2/events/${event.id}/markets`,
    `${BETSSON_BASE}/api/events/${event.id}/markets`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetch(url, { headers: BASE_HEADERS });
      if (!res.ok) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return await res.json() as any;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Extrai odds de desarmes/faltas de um payload de markets.
 * Mapeia estruturas Betsson comuns para o formato ScrapedOdd.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOddsFromMarkets(payload: any, homeTeam: string, eventId: BetssonEvent['id']): ScrapedOdd[] {
  const odds: ScrapedOdd[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markets: any[] = Array.isArray(payload?.markets)
    ? payload.markets
    : Array.isArray(payload?.data?.markets)
      ? payload.data.markets
      : Array.isArray(payload)
        ? payload
        : [];

  const eventUrl = `${BETSSON_BASE}/sports/futebol/evento/${eventId}`;

  for (const market of markets) {
    const marketName: string = market.name ?? market.displayName ?? '';
    const marketKey = resolveBetssonMarketKey(marketName);
    if (!marketKey) continue;

    // Betsson pode usar 'selections', 'outcomes', ou 'odds' como chave
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outcomes: any[] = market.selections ?? market.outcomes ?? market.odds ?? [];

    for (const outcome of outcomes) {
      const rawName: string = outcome.name ?? outcome.displayName ?? outcome.selectionName ?? '';
      const playerName = normalizePlayerNameFormat(
        rawName.split(/\s+[-–]\s+/)[0] ?? rawName, // remove sufixo " - Mais de X.5"
      );
      const price = Number(outcome.price ?? outcome.odds ?? outcome.decimal ?? 0);

      if (!playerName || price <= 1) continue;

      const lineRaw = outcome.handicap ?? outcome.line ?? outcome.total ?? '';
      const line = resolveBetssonLine(lineRaw, marketName);

      odds.push({
        playerName,
        team: homeTeam, // Betsson costuma não separar por time; preenche com home como fallback
        line,
        value: price,
        house: 'betsson',
        market: marketKey,
        url: eventUrl,
      });
    }
  }

  return odds;
}

/** Resolve o marketKey a partir do nome do mercado Betsson. */
function resolveBetssonMarketKey(marketName: string): string | null {
  const lower = marketName.toLowerCase();

  if (
    lower.includes('desarme') ||
    lower.includes('tackle') ||
    lower.includes('total de desarmes')
  ) return 'desarmes';

  if (
    lower.includes('falta cometida') ||
    lower.includes('cometer falta') ||
    lower.includes('faltas cometidas')
  ) return 'faltas_cometidas';

  if (
    lower.includes('falta sofrida') ||
    lower.includes('sofrer falta') ||
    lower.includes('faltas sofridas')
  ) return 'faltas_sofridas';

  return null;
}

/**
 * Resolve a linha de apostas a partir do handicap/total ou do nome do mercado.
 * Betsson usa "0.5" para 1+, "1.5" para 2+, etc. — mesmo padrão da Superbet.
 */
function resolveBetssonLine(total: string | number | null | undefined, marketName: string): string {
  if (total !== null && total !== undefined && total !== '') {
    const t = parseFloat(String(total));
    if (!Number.isNaN(t)) {
      if (t <= 0.5) return '1+';
      if (t <= 1.5) return '2+';
      if (t <= 2.5) return '3+';
      if (t <= 3.5) return '4+';
      return `${Math.ceil(t)}+`;
    }
  }
  return normalizeLine(marketName);
}

// ─── Camada 2: Fallback Playwright ─────────────────────────────────────────────

/**
 * Fallback Playwright: navega pela Betsson seguindo o fluxo real do usuário:
 * 1. Abre a Copa do Mundo
 * 2. Encontra jogos e clica em cada um
 * 3. Expande "Estatísticas do Jogador"
 * 4. Abre seção "Total de desarmes" / "Faltas cometidas"
 * 5. Clica "Mostrar Todos Jogadores" e extrai odds do DOM
 */
async function scrapeViaPlaywright(context: BrowserContext): Promise<ScrapedMatch[]> {
  const results: ScrapedMatch[] = [];
  const page = await context.newPage();

  try {
    // 1) Navega para Copa do Mundo
    logger.info('[Betsson] Navegando para Copa do Mundo...');
    await page.goto(`${BETSSON_BASE}/apostas-esportivas/futebol/copa-do-mundo/copa-do-mundo`, {
      waitUntil: 'load',
      timeout: 30000,
    });
    await page.waitForTimeout(5000);

    // Aceita cookies
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const accept = btns.find(b => (b.textContent || '').toLowerCase().includes('aceitar'));
      if (accept) accept.click();
    });
    await page.waitForTimeout(5000);

    // 2) Encontra links de jogos usando locator que penetra Shadow DOM
    const gameLinkLocators = await page.locator('a[href*="eventId"]').all();
    const gameUrls: string[] = [];
    for (const loc of gameLinkLocators) {
      const href = await loc.getAttribute('href');
      if (href && href.includes('eventId=')) {
        const fullUrl = href.startsWith('http') ? href : `${BETSSON_BASE}${href}`;
        gameUrls.push(fullUrl);
      }
    }
    const uniqueLinks = [...new Set(gameUrls)];
    logger.info(`[Betsson] ${uniqueLinks.length} jogos encontrados via locator`);

    if (uniqueLinks.length === 0) {
      await page.close().catch(() => null);
      return [];
    }

    // 3) Para cada jogo: clica, expande stats, coleta odds
    for (const gameUrl of uniqueLinks.slice(0, 20)) {
      try {
        const gamePage = await context.newPage();
        await gamePage.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await gamePage.waitForTimeout(3000);

        // Lê times do header
        const header = await gamePage.evaluate(() => {
          const h1 = document.querySelector('h1')?.textContent ?? '';
          const parts = h1.split(/\s+vs?\s+/i);
          return { home: parts[0]?.trim() ?? '', away: parts[1]?.trim() ?? '' };
        });

        if (!header.home || !header.away) {
          await gamePage.close().catch(() => null);
          continue;
        }

        // Clica em "Estatísticas do Jogador" ou setinha para expandir
        await gamePage.evaluate(() => {
          const tabs = Array.from(document.querySelectorAll('*'));
          const tab = tabs.find(e => {
            const txt = (e.textContent || '').trim().toLowerCase();
            return txt.includes('estatísticas do jogador') || txt.includes('estatisticas do jogador');
          });
          if (tab) (tab.closest('button,a,[role="tab"]') as HTMLElement)?.click();
        });
        await gamePage.waitForTimeout(2000);

        // Rola para encontrar as seções de desarmes/faltas
        for (let i = 0; i < 5; i++) {
          await gamePage.evaluate(() => window.scrollBy(0, 500));
          await gamePage.waitForTimeout(300);
        }

        const gameOdds = await extractBetssonPlayerOdds(gamePage, header.home);

        if (gameOdds.length > 0) {
          results.push({
            homeTeam: header.home,
            awayTeam: header.away,
            dateTime: new Date(),
            stage: extractStage('Copa do Mundo 2026'),
            odds: gameOdds,
          });
          logger.info(`[Betsson] ${header.home} vs ${header.away}: ${gameOdds.length} odds`);
        }

        await gamePage.close().catch(() => null);
        await delay(500);
      } catch (err) {
        logger.warn(`[Betsson] Erro no jogo:`, { error: String(err) });
      }
    }
  } catch (err) {
    logger.error('[Betsson] Erro geral Playwright:', { error: String(err) });
  } finally {
    await page.close().catch(() => null);
  }

  return results;
}

/**
 * Extrai odds de desarmes/faltas do DOM de um jogo Betsson.
 * Clica em cada seção para expandir e lê os valores.
 */
async function extractBetssonPlayerOdds(
  page: import('playwright').Page,
  homeTeam: string,
): Promise<ScrapedOdd[]> {
  const odds: ScrapedOdd[] = [];

  const sections: Array<{ search: string; market: ScrapedOdd['market'] }> = [
    { search: 'desarmes', market: 'desarmes' },
    { search: 'faltas cometidas', market: 'faltas_cometidas' },
    { search: 'faltas sofridas', market: 'faltas_sofridas' },
  ];

  for (const section of sections) {
    // Clica na seção para expandir
    const sectionLoc = page.locator(`text=/${section.search}/i`).first();
    if (await sectionLoc.count() === 0) continue;
    try { await sectionLoc.click(); } catch { continue; }
    await page.waitForTimeout(5000);

    // Clica "Mostrar Todos Jogadores" se existir
    for (let attempt = 0; attempt < 3; attempt++) {
      const moreLoc = page.locator('text=/Mostrar Todos Jogadores/i').first();
      if (await moreLoc.count() > 0) {
        try { await moreLoc.click(); await page.waitForTimeout(2000); } catch { break; }
      } else break;
    }

    // Lê textos de Shadow DOM via page.locator (penetra Shadow DOM)
    const acimaLocs = await page.locator('text=/Acima de/').all();
    logger.debug(`[Betsson] ${section.search}: ${acimaLocs.length} elementos "Acima de"`);

    // Para cada "Acima de", tenta pegar o jogador ao lado
    const sectionOdds: Array<{ player: string; line: string; value: number }> = [];
    for (const loc of acimaLocs) {
      try {
        const visible = await loc.isVisible();
        if (!visible) continue;

        const text = await loc.textContent();
        const acimaMatch = text?.match(/Acima de ([\d.]+)/);
        if (!acimaMatch) continue;

        const lineVal = parseFloat(acimaMatch[1]);
        // O valor da odd está no elemento irmão (próximo sibling)
        const oddText = await loc.locator('+ *').textContent().catch(() => '');
        const oddVal = parseFloat(oddText ?? '');
        if (isNaN(oddVal) || oddVal <= 1) continue;

        // O nome do jogador está no elemento pai
        const parentText = await loc.locator('..').textContent().catch(() => '');
        // Procura por padrão "Sobrenome, Nome" no parent
        const playerMatch = parentText?.match(/([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*,\s*[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+(?:\s+[A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ]+)*)/);

        if (playerMatch) {
          const lineStr = lineVal <= 0.5 ? '1+' : lineVal <= 1.5 ? '2+' : lineVal <= 2.5 ? '3+' : lineVal <= 3.5 ? '4+' : Math.ceil(lineVal) + '+';
          sectionOdds.push({ player: playerMatch[1], line: lineStr, value: oddVal });
        }
      } catch {
        // ignora erros de elemento
      }
    }

    logger.info(`[Betsson] ${section.search}: ${sectionOdds.length} odds`);

    for (const o of sectionOdds) {
      const normalizedLine = normalizeLine(o.line);
      if (!normalizedLine) continue;
      odds.push({
        playerName: normalizePlayerNameFormat(o.player),
        team: homeTeam,
        line: normalizedLine,
        value: o.value,
        house: 'betsson',
        market: section.market,
        url: '',
      });
    }
  }

  return odds;
}
