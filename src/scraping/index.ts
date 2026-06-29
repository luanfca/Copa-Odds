/**
 * Orquestrador do scraping.
 * Coordena os 3 adaptadores, normaliza e persiste os dados.
 *
 * Estratégia:
 * - BetMGM e Superbet: API REST direta (sem browser) — paralelos.
 * - Betfair: Playwright (browser) — necessário pois a API exige sessão autenticada.
 *
 * MUDANÇAS vs versão anterior:
 * - REMOVIDO: FLAG_MAP local (90 entradas) + loop O(n) → usa flagMap.ts (O(1))
 * - REMOVIDO: interfaces ScrapedOdd/ScrapedMatch locais → usa src/types/scraping.ts
 * - CORRIGIDO: persistência com createMany + chunking de 500 (SQLite safe)
 *   ANTES: ~9.500 queries individuais por scraping.
 *   AGORA: ~20 queries (1 createMany por jogador com batch de snapshots).
 *
 * Compatibilidade PostgreSQL:
 * - `createMany` funciona nativamente no Postgres sem chunking.
 * - Ao migrar, remova o `chunkArray` e passe o array diretamente.
 * - A interface tipada de dados já está preparada para essa transição.
 */

import { chromium, BrowserContext } from 'playwright';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import {
  mergePlayerOdds,
  slugify,
  normalizeTeamName,
  type RawPlayerOdd,
} from '../lib/normalize';
import { getFlag } from '../lib/flagMap';
import { scrapeBetfair } from './betfairAdapter';
import { scrapeBetMGM } from './betmgmAdapter';
import { scrapeSuperbet } from './superbetAdapter';
import { scrapeBet365 } from './bet365Adapter';
import { scrapeBetsson } from './betssonAdapter';
import { scrapePitaco } from './pitaco';
import type { ScrapedMatch } from '../types/scraping';
import path from 'path';
import fs from 'fs';

// ─── Configuração ─────────────────────────────────────────────────────────────

/**
 * Tamanho máximo de lote para `createMany` no SQLite.
 *
 * SQLite tem um limite de ~999 variáveis por statement. Cada OddSnapshot
 * tem ~7 campos, então 999 / 7 ≈ 142 linhas por batch. Usamos 100 como
 * margem de segurança.
 *
 * Para PostgreSQL: não há limite prático — pode-se usar valores muito maiores
 * (ex: 5000) ou remover o chunking completamente.
 */
const SQLITE_BATCH_SIZE = 100;

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface ScrapeResult {
  success: boolean;
  betfairOk: boolean;
  betmgmOk: boolean;
  superbetOk: boolean;
  bet365Ok: boolean;
  betssonOk: boolean;
  pitacoOk: boolean;
  matchCount: number;
  playerCount: number;
  oddCount: number;
  error?: string;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Executa o scraping completo das 3 casas e persiste no banco.
 *
 * BetMGM e Superbet são executados em paralelo (sem browser).
 * Betfair é executado depois (requer browser Playwright).
 */
export async function scrapeAll(): Promise<ScrapeResult> {
  const scrapeLog = await prisma.scrapeLog.create({
    data: { status: 'running' },
  });

  logger.info('=== INÍCIO DO SCRAPING ===');

  const result: ScrapeResult = {
    success: false,
    betfairOk: false,
    betmgmOk: false,
    superbetOk: false,
    bet365Ok: false,
    betssonOk: false,
    pitacoOk: false,
    matchCount: 0,
    playerCount: 0,
    oddCount: 0,
  };

  try {
    // ── BetMGM + Superbet + Betsson (API direta): paralelos, sem browser ──
    logger.info('Iniciando scraping via API direta (BetMGM + Superbet + Betsson em paralelo)...');
    const [betmgmResult, superbetResult, betssonApiResult] = await Promise.allSettled([
      scrapeBetMGM(),
      scrapeSuperbet(),
      scrapeBetsson(), // chamada sem BrowserContext — só tenta API direta
    ]);

    const betmgmData  = betmgmResult.status  === 'fulfilled' ? betmgmResult.value  : [];
    const superbetData = superbetResult.status === 'fulfilled' ? superbetResult.value : [];
    const betssonApiData = betssonApiResult.status === 'fulfilled' ? betssonApiResult.value : [];

    result.betmgmOk  = betmgmResult.status  === 'fulfilled' && betmgmData.length  > 0;
    result.superbetOk = superbetResult.status === 'fulfilled' && superbetData.length > 0;
    result.betssonOk = betssonApiResult.status === 'fulfilled' && betssonApiData.length > 0;

    if (betmgmResult.status  === 'rejected') logger.error('[BetMGM] Falhou:',  { error: String(betmgmResult.reason) });
    if (superbetResult.status === 'rejected') logger.error('[Superbet] Falhou:', { error: String(superbetResult.reason) });
    if (betssonApiResult.status === 'rejected') logger.error('[Betsson API] Falhou:', { error: String(betssonApiResult.reason) });

    // ── Playwright: Betfair, Bet365, Pitaco, Betsson em PARALELO ──
    let betfairData: ScrapedMatch[] = [];
    let bet365Data: ScrapedMatch[] = [];
    let pitacoData: ScrapedMatch[] = [];
    let betssonData: ScrapedMatch[] = [...betssonApiData];

    const useBetfair = process.env.BETFAIR_ENABLED !== 'false';
    const useBetMGM = process.env.BETMGM_ENABLED !== 'false';
    const useSuperbet = process.env.SUPERBET_ENABLED !== 'false';
    const useBet365 = process.env.BET365_ENABLED !== 'false';
    const useBetsson = process.env.BETSSON_ENABLED !== 'false';
    const usePitaco = process.env.PITACO_ENABLED !== 'false';

    const sessionDir = path.join(process.cwd(), '.playwright-sessions');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const launchOptions: Parameters<typeof chromium.launch>[0] = {
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--lang=pt-BR',
      ],
    };
    if (process.env.PROXY_URL) {
      launchOptions.proxy = { server: process.env.PROXY_URL };
      logger.info(`Usando proxy: ${process.env.PROXY_URL.split('@').pop()}`);
    }

    const contextOptions = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo',
      viewport: { width: 1440, height: 900 },
      acceptDownloads: false,
    };

    async function runPlaywrightAdapter(
      name: string,
      scrapeFn: (ctx: BrowserContext) => Promise<ScrapedMatch[]>,
      sessionFile: string,
    ): Promise<ScrapedMatch[]> {
      let b: Awaited<ReturnType<typeof chromium.launch>> | undefined;
      try {
        b = await chromium.launch(launchOptions);
        const sessionPath = path.join(sessionDir, sessionFile);
        let ctx: BrowserContext;
        try {
          ctx = fs.existsSync(sessionPath)
            ? await b.newContext({ ...contextOptions, storageState: sessionPath })
            : await b.newContext(contextOptions);
        } catch {
          ctx = await b.newContext(contextOptions);
        }
        const data = await scrapeFn(ctx);
        try { await ctx.storageState({ path: sessionPath }); } catch { /* */ }
        await ctx.close().catch(() => null);
        return data;
      } catch (error) {
        logger.error(`[${name}] Falhou:`, { error: String(error) });
        return [];
      } finally {
        await b?.close().catch(() => null);
      }
    }

    const playwrightJobs: Array<Promise<{ name: string; data: ScrapedMatch[] }>> = [];

    if (useBetfair) {
      logger.info('Betfair: iniciando em paralelo...');
      playwrightJobs.push(
        runPlaywrightAdapter('Betfair', scrapeBetfair, 'betfair-session.json')
          .then(data => ({ name: 'Betfair', data })),
      );
    } else {
      logger.info('Betfair desabilitado');
    }

    if (useBet365) {
      logger.info('Bet365: iniciando em paralelo...');
      playwrightJobs.push(
        runPlaywrightAdapter('Bet365', scrapeBet365, 'bet365-session.json')
          .then(data => ({ name: 'Bet365', data })),
      );
    } else {
      logger.info('Bet365 desabilitado');
    }

    if (usePitaco) {
      logger.info('Pitaco: iniciando em paralelo...');
      playwrightJobs.push(
        runPlaywrightAdapter('Pitaco', scrapePitaco, 'pitaco-session.json')
          .then(data => ({ name: 'Pitaco', data })),
      );
    } else {
      logger.info('Pitaco desabilitado');
    }

    if (useBetsson && !result.betssonOk) {
      logger.info('Betsson: fallback Playwright em paralelo...');
      playwrightJobs.push(
        runPlaywrightAdapter('Betsson', scrapeBetsson, 'betsson-session.json')
          .then(data => ({ name: 'Betsson', data })),
      );
    }

    if (playwrightJobs.length > 0) {
      const pwResults = await Promise.allSettled(playwrightJobs);
      for (const r of pwResults) {
        if (r.status === 'fulfilled') {
          const { name, data } = r.value;
          if (name === 'Betfair') { betfairData = data; result.betfairOk = data.length > 0; }
          if (name === 'Bet365') { bet365Data = data; result.bet365Ok = data.length > 0; }
          if (name === 'Pitaco') { pitacoData = data; result.pitacoOk = data.length > 0; }
          if (name === 'Betsson') { betssonData = data; result.betssonOk = data.length > 0; }
          logger.info(`${name}: ${data.length} jogos`);
        }
      }
    }

    // ── Unifica e persiste ──
    const allData = [...betmgmData, ...superbetData, ...betfairData, ...bet365Data, ...betssonData, ...pitacoData];

    if (allData.length === 0) {
      logger.warn('Nenhum dado coletado. Encerrando sem persistir.');
      await prisma.scrapeLog.update({
        where: { id: scrapeLog.id },
        data: {
          finishedAt: new Date(),
          status: 'failed',
          errorMsg: 'Nenhum dado coletado',
          betfairOk: result.betfairOk,
          betmgmOk: result.betmgmOk,
          superbetOk: result.superbetOk,
          bet365Ok: result.bet365Ok,
          betssonOk: result.betssonOk,
          pitacoOk: result.pitacoOk,
        },
      });
      return result;
    }

    const stats = await persistScrapedData(allData);

    // Invalida caches server-side para forçar dados frescos
    const { invalidateDesCache } = await import('../app/api/desarmes/route');
    const { invalidateVoCache } = await import('../app/api/value-odds/route');
    const { invalidateMatchCache } = await import('../app/api/matches/[id]/route');
    invalidateDesCache();
    invalidateVoCache();
    invalidateMatchCache();
    result.matchCount = stats.matchCount;
    result.playerCount = stats.playerCount;
    result.oddCount = stats.oddCount;
    result.success = true;

    const overallStatus = result.betfairOk && result.betmgmOk && result.superbetOk && result.bet365Ok && result.betssonOk && result.pitacoOk
      ? 'success'
      : (result.betmgmOk || result.superbetOk || result.betfairOk || result.bet365Ok || result.betssonOk || result.pitacoOk ? 'partial' : 'failed');

    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        finishedAt: new Date(),
        status: overallStatus,
        betfairOk: result.betfairOk,
        betmgmOk: result.betmgmOk,
        superbetOk: result.superbetOk,
        bet365Ok: result.bet365Ok,
        betssonOk: result.betssonOk,
        pitacoOk: result.pitacoOk,
        matchCount: result.matchCount,
        playerCount: result.playerCount,
        oddCount: result.oddCount,
      },
    });

  } catch (error) {
    const errorMsg = String(error);
    logger.error('Erro crítico no scraping:', { error: errorMsg });
    result.error = errorMsg;

    await prisma.scrapeLog.update({
      where: { id: scrapeLog.id },
      data: {
        finishedAt: new Date(),
        status: 'failed',
        errorMsg,
      },
    }).catch(() => null);

  } finally {
    logger.info('=== FIM DO SCRAPING ===');
  }

  return result;
}

// ─── Persistência ─────────────────────────────────────────────────────────────

/**
 * Divide um array em lotes de tamanho `size`.
 * Necessário para contornar o limite de variáveis do SQLite (~999).
 *
 * TODO: ao migrar para PostgreSQL, remover o chunking e passar o array completo
 * diretamente para `createMany` — o Postgres não tem esse limite.
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Persiste os dados coletados no banco.
 *
 * Performance:
 * - ANTES: N×M×K queries individuais via `create()` (ex: 9.500 queries/scraping)
 * - AGORA: 1 query por jogador via `createMany()` em chunks de SQLITE_BATCH_SIZE
 *
 * Estratégia de deduplicação:
 * - Jogos: upsert com ID canônico (homeSlug-awaySlug-data)
 * - Jogadores: upsert com (matchId, name) único
 * - Snapshots: insert always (histórico de variação de odds)
 *
 * Exportada para reuso pelo endpoint `/api/scrape/bet365`, que recebe
 * dados do scraper Python (nodriver) e usa o mesmo pipeline de
 * persistência. A assinatura é estável — adicionar parâmetros opcionais
 * em vez de quebrá-la.
 */
export async function persistScrapedData(
  scrapedMatches: ScrapedMatch[],
): Promise<{ matchCount: number; playerCount: number; oddCount: number }> {
  let matchCount = 0;
  let playerCount = 0;
  let oddCount = 0;

  // Limpa possíveis jogos "Event X" salvos por falhas passadas
  try {
    await prisma.match.deleteMany({
      where: { homeTeam: { startsWith: 'Event ' } }
    });
  } catch (e) {
    logger.error('Erro ao limpar jogos Event residuais:', e);
  }

  // Normaliza nomes de time antes do agrupamento
  const normalizedMatches = scrapedMatches.map(m => ({
    ...m,
    homeTeam: normalizeTeamName(m.homeTeam),
    awayTeam: normalizeTeamName(m.awayTeam),
    odds: m.odds.map(o => ({
      ...o,
      team: o.team ? normalizeTeamName(o.team) : '',
    })),
  }));

  // Agrupa por jogo (chave canônica com times ordenados para que
  // "A x B" e "B x A" — inversão de mandante — caiam no mesmo slot)
  const matchMap = new Map<string, typeof normalizedMatches[0]>();

  for (const match of normalizedMatches) {
    const key = [slugify(match.homeTeam), slugify(match.awayTeam)]
      .sort()
      .join('_vs_');

    const existing = matchMap.get(key);
    if (!existing) {
      matchMap.set(key, { ...match, odds: [...match.odds] });
    } else {
      // Mescla odds de diferentes casas no mesmo jogo
      existing.odds = [...existing.odds, ...match.odds];
    }
  }

  for (const matchData of Array.from(matchMap.values())) {
    try {
      // ── Upsert do jogo ──
      const matchDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(matchData.dateTime);
      const matchId = [
        slugify(matchData.homeTeam),
        slugify(matchData.awayTeam),
        matchDate,
      ].join('-');

      const match = await prisma.match.upsert({
        where: { id: matchId },
        create: {
          id: matchId,
          dateTime: matchData.dateTime,
          homeTeam: matchData.homeTeam,
          awayTeam: matchData.awayTeam,
          stage: matchData.stage,
          homeFlag: getFlag(matchData.homeTeam),
          awayFlag: getFlag(matchData.awayTeam),
        },
        update: {
          dateTime: matchData.dateTime,
          stage: matchData.stage,
          homeFlag: getFlag(matchData.homeTeam),
          awayFlag: getFlag(matchData.awayTeam),
        },
      });
      matchCount++;

      // ── Normaliza e mescla jogadores de todas as casas ──
      const mergedPlayers = mergePlayerOdds(matchData.odds as RawPlayerOdd[]);
      const collectedAt = new Date();

      for (const player of mergedPlayers) {
        // ── Upsert do jogador ──
        const savedPlayer = await prisma.player.upsert({
          where: {
            matchId_name: {
              matchId: match.id,
              name: player.normalizedName,
            },
          },
          create: {
            matchId: match.id,
            name: player.normalizedName,
            displayName: player.displayName,
            team: player.team,
          },
          update: {
            displayName: player.displayName,
            team: player.team,
          },
        });
        playerCount++;

        // ── Insere snapshots em batch (createMany + chunking SQLite) ──
        // Filtra odds sem linha reconhecida antes de inserir
        const validOdds = player.odds.filter(o => o.line !== '');

        if (validOdds.length === 0) continue;

        const snapshotData = validOdds.map(odd => ({
          playerId: savedPlayer.id,
          house: odd.house,
          line: odd.line,
          value: odd.value,
          market: odd.market,
          url: odd.url ?? null,
          collectedAt,
        }));

        // Chunk para respeitar o limite de variáveis do SQLite.
        // Ao migrar para PostgreSQL: substituir o loop por uma única chamada:
        //   await prisma.oddSnapshot.createMany({ data: snapshotData });
        for (const chunk of chunkArray(snapshotData, SQLITE_BATCH_SIZE)) {
          await prisma.oddSnapshot.createMany({ data: chunk });
          oddCount += chunk.length;
        }
      }

      logger.info(
        `Jogo persistido: ${matchData.homeTeam} vs ${matchData.awayTeam} — ` +
        `${mergedPlayers.length} jogadores, ${matchData.odds.length} odds`,
      );

    } catch (error) {
      logger.error(
        `Erro ao persistir ${matchData.homeTeam} vs ${matchData.awayTeam}:`,
        { error: String(error) },
      );
    }
  }

  return { matchCount, playerCount, oddCount };
}
