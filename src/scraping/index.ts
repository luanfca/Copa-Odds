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
import { getFlag, isClubTeam } from '../lib/flagMap';
import { classifyBrasileiraoStage } from '../lib/brasileiraoStage';
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

  // Browser compartilhado: aberto fora do try para ser acessível no finally
  let sharedBrowser: Awaited<ReturnType<typeof chromium.launch>> | undefined;

  try {
    // ── BetMGM + Superbet + Betsson (API direta): paralelos, sem browser ──
    // Foco principal: Brasileirão Série A + MLS
    // Override: SCRAPE_COMPETITIONS=brasileirao  ou  brasileirao,mls
    const competitionKeys = (process.env.SCRAPE_COMPETITIONS || 'brasileirao,mls')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const scrapeProfile = (process.env.SCRAPE_PROFILE || 'fast').toLowerCase();
    // Bet365/Betsson: OFF por padrão (não puxam dados estáveis). Ative com =true.
    const useBetfair = process.env.BETFAIR_ENABLED !== 'false';
    const useBetMGM = process.env.BETMGM_ENABLED !== 'false';
    const useSuperbet = process.env.SUPERBET_ENABLED !== 'false';
    const useBet365 = process.env.BET365_ENABLED === 'true';
    const useBetsson = process.env.BETSSON_ENABLED === 'true';
    const usePitaco = process.env.PITACO_ENABLED !== 'false';

    logger.info(
      `Iniciando scraping via API direta (BetMGM + Superbet` +
      `${useBetsson ? ' + Betsson' : ''}) ` +
      `[profile=${scrapeProfile}, comps=${competitionKeys.join(',')}]...`,
    );

    const apiJobs: Array<Promise<ScrapedMatch[]>> = [];
    if (useBetMGM) apiJobs.push(scrapeBetMGM(competitionKeys));
    else apiJobs.push(Promise.resolve([]));
    if (useSuperbet) apiJobs.push(scrapeSuperbet(competitionKeys));
    else apiJobs.push(Promise.resolve([]));
    if (useBetsson) apiJobs.push(scrapeBetsson());
    else apiJobs.push(Promise.resolve([]));

    const [betmgmResult, superbetResult, betssonApiResult] = await Promise.allSettled(apiJobs);

    const betmgmData = betmgmResult.status === 'fulfilled' ? betmgmResult.value : [];
    const superbetData = superbetResult.status === 'fulfilled' ? superbetResult.value : [];
    const betssonApiData = betssonApiResult.status === 'fulfilled' ? betssonApiResult.value : [];

    result.betmgmOk = betmgmResult.status === 'fulfilled' && betmgmData.length > 0;
    result.superbetOk = superbetResult.status === 'fulfilled' && superbetData.length > 0;
    result.betssonOk = useBetsson && betssonApiResult.status === 'fulfilled' && betssonApiData.length > 0;

    if (betmgmResult.status === 'rejected') logger.error('[BetMGM] Falhou:', { error: String(betmgmResult.reason) });
    if (superbetResult.status === 'rejected') logger.error('[Superbet] Falhou:', { error: String(superbetResult.reason) });
    if (useBetsson && betssonApiResult.status === 'rejected') {
      logger.error('[Betsson API] Falhou:', { error: String(betssonApiResult.reason) });
    }

    // ── Playwright: Betfair + Pitaco (Bet365/Betsson só se ENABLED=true) ──
    let betfairData: ScrapedMatch[] = [];
    let bet365Data: ScrapedMatch[] = [];
    let pitacoData: ScrapedMatch[] = [];
    let betssonData: ScrapedMatch[] = [...betssonApiData];

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

    // Browser compartilhado: abre UMA instância do Chromium e reutiliza
    // entre todos os adaptadores Playwright, evitando abrir vários browsers
    // em paralelo (o que causaria alto consumo de memória e lentidão).

    // Serializa o launch do browser para evitar race (vários jobs em paralelo
    // viam !sharedBrowser e abriam N Chromiums).
    let browserLaunchPromise: Promise<Awaited<ReturnType<typeof chromium.launch>>> | null = null;
    async function getSharedBrowser() {
      if (sharedBrowser) return sharedBrowser;
      if (!browserLaunchPromise) {
        browserLaunchPromise = chromium.launch(launchOptions).then((b) => {
          sharedBrowser = b;
          return b;
        });
      }
      return browserLaunchPromise;
    }

    async function runPlaywrightAdapter(
      name: string,
      scrapeFn: (ctx: BrowserContext) => Promise<ScrapedMatch[]>,
      sessionFile: string,
    ): Promise<ScrapedMatch[]> {
      try {
        const browser = await getSharedBrowser();
        const sessionPath = path.join(sessionDir, sessionFile);
        let ctx: BrowserContext;
        try {
          ctx = fs.existsSync(sessionPath)
            ? await browser.newContext({ ...contextOptions, storageState: sessionPath })
            : await browser.newContext(contextOptions);
        } catch {
          ctx = await browser.newContext(contextOptions);
        }
        const data = await scrapeFn(ctx);
        try { await ctx.storageState({ path: sessionPath }); } catch { /* */ }
        await ctx.close().catch(() => null);
        return data;
      } catch (error) {
        logger.error(`[${name}] Falhou:`, { error: String(error) });
        return [];
      }
    }

    const playwrightJobs: Array<() => Promise<{ name: string; data: ScrapedMatch[] }>> = [];

    if (useBetfair) {
      logger.info('Betfair: iniciando em paralelo...');
      const betfairComps = ['brasileirao', 'mls'];
      playwrightJobs.push(() =>
        runPlaywrightAdapter('Betfair', (ctx) => scrapeBetfair(ctx, betfairComps), 'betfair-session.json')
          .then(data => ({ name: 'Betfair', data })),
      );
    } else {
      logger.info('Betfair desabilitado');
    }

    if (useBet365) {
      logger.info('Bet365: iniciando em paralelo...');
      playwrightJobs.push(() =>
        runPlaywrightAdapter('Bet365', scrapeBet365, 'bet365-session.json')
          .then(data => ({ name: 'Bet365', data })),
      );
    } else {
      logger.info('Bet365 desabilitado');
    }

    if (usePitaco) {
      logger.info('Pitaco: iniciando em paralelo...');
      playwrightJobs.push(() =>
        runPlaywrightAdapter('Pitaco', (ctx) => scrapePitaco(ctx, competitionKeys), 'pitaco-session.json')
          .then(data => ({ name: 'Pitaco', data })),
      );
    } else {
      logger.info('Pitaco desabilitado');
    }

    if (useBetsson && !result.betssonOk) {
      logger.info('Betsson: fallback Playwright em paralelo...');
      playwrightJobs.push(() =>
        runPlaywrightAdapter('Betsson', scrapeBetsson, 'betsson-session.json')
          .then(data => ({ name: 'Betsson', data })),
      );
    }

    if (playwrightJobs.length > 0) {
      // Render Free tem 512 MB. Dois contextos pesados simultâneos
      // (Betfair + Pitaco) faziam o contêiner reiniciar com HTTP 502.
      // Nesse ambiente reutilizamos o mesmo browser, uma casa por vez.
      const lowMemory =
        scrapeProfile === 'low-memory' || process.env.RENDER === 'true';
      const pwResults: PromiseSettledResult<{
        name: string;
        data: ScrapedMatch[];
      }>[] = [];
      if (lowMemory) {
        logger.info('Playwright em modo de baixa memória: casas serializadas.');
        for (const job of playwrightJobs) {
          try {
            pwResults.push({ status: 'fulfilled', value: await job() });
          } catch (reason) {
            pwResults.push({ status: 'rejected', reason });
          }
        }
      } else {
        pwResults.push(...await Promise.allSettled(playwrightJobs.map((job) => job())));
      }
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

    // Mantém o lote anterior visível enquanto o novo é completado com
    // históricos e escalações. A troca dos snapshots só acontece no final.
    const { purgeOldOdds } = await import('../lib/apiSnapshot');
    const okHouses: string[] = [];
    if (result.betfairOk) okHouses.push('betfair');
    if (result.betmgmOk) okHouses.push('betmgm');
    if (result.superbetOk) okHouses.push('superbet');
    if (result.pitacoOk) okHouses.push('pitaco');
    if (result.bet365Ok) okHouses.push('bet365');
    if (result.betssonOk) okHouses.push('betsson');
    const purged = await purgeOldOdds(scrapeLog.startedAt, okHouses);
    logger.info(
      `[Scrape] Odds antigas removidas: ${purged} (casas OK: ${okHouses.join(',') || 'nenhuma'})`,
    );

    const { buildDailyDataset } = await import('../lib/dailyDataset');
    const daily = await buildDailyDataset(scrapeLog.startedAt);
    logger.info('[Scrape] Lote diário completo e publicado', daily);

    // Invalida caches in-memory
    const { invalidateDesCache, invalidateMatchCache, invalidateVoCache } = await import('../lib/cacheInvalidation');
    invalidateDesCache();
    invalidateMatchCache();
    invalidateVoCache();
    try {
      const { clearSharedHistoryL1 } = await import('../lib/sharedCache');
      clearSharedHistoryL1();
    } catch { /* */ }
    result.matchCount = stats.matchCount;
    result.playerCount = stats.playerCount;
    result.oddCount = stats.oddCount;
    result.success = true;

    // Sucesso = as 4 casas ativas (Betfair, BetMGM, Superbet, Pitaco)
    const coreOk = result.betfairOk && result.betmgmOk && result.superbetOk && result.pitacoOk;
    const anyOk = result.betmgmOk || result.superbetOk || result.betfairOk || result.pitacoOk
      || result.bet365Ok || result.betssonOk;
    const overallStatus = coreOk ? 'success' : (anyOk ? 'partial' : 'failed');

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
    // Fecha o browser compartilhado ao final do scraping
    await sharedBrowser?.close().catch(() => null);
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

  // Normaliza nomes de times de matches existentes no banco.
  // Scrapes anteriores salvaram nomes RAW (ex: "Botafogo Rj"), enquanto o
  // pipeline atual normaliza via normalizeTeamName() (ex: "Botafogo").
  // Sem esta normalização, o lookup no banco falha e cada scrape cria
  // NOVOS matches com nomes normalizados, duplicando os dados.
  //
  // IMPORTANTE: antes de atualizar, verifica se já existe outro match com
  // os mesmos valores normalizados. Se existir, deleta este (duplicado)
  // em vez de violar a unique constraint.
  try {
    const allDbMatches = await prisma.match.findMany();
    for (const dbm of allDbMatches) {
      const nh = normalizeTeamName(dbm.homeTeam);
      const na = normalizeTeamName(dbm.awayTeam);
      if (nh !== dbm.homeTeam || na !== dbm.awayTeam) {
        // Verifica se já existe match com nomes normalizados
        const duplicate = await prisma.match.findFirst({
          where: {
            homeTeam: nh,
            awayTeam: na,
            dateTime: dbm.dateTime,
            competition: dbm.competition,
            id: { not: dbm.id },
          },
        });
        if (duplicate) {
          logger.info(`Migrando duplicado ao normalizar: ${dbm.homeTeam} vs ${dbm.awayTeam} → ${duplicate.id}`);
          const players = await prisma.player.findMany({ where: { matchId: dbm.id } });
          for (const player of players) {
            try {
              const existing = await prisma.player.findUnique({
                where: { matchId_name: { matchId: duplicate.id, name: player.name } },
              });
              if (existing) {
                await prisma.oddSnapshot.updateMany({
                  where: { playerId: player.id },
                  data: { playerId: existing.id },
                });
                await prisma.player.delete({ where: { id: player.id } });
              } else {
                await prisma.player.update({
                  where: { id: player.id },
                  data: { matchId: duplicate.id },
                });
              }
            } catch (err) {
              logger.error(`Erro ao migrar player ${player.name}:`, { error: String(err) });
            }
          }
          await prisma.match.delete({ where: { id: dbm.id } });
        } else {
          await prisma.match.update({
            where: { id: dbm.id },
            data: { homeTeam: nh, awayTeam: na },
          });
          logger.info(`Match normalizado: ${dbm.homeTeam} vs ${dbm.awayTeam} → ${nh} vs ${na}`);
        }
      }
    }
  } catch (e) {
    logger.error('Erro ao normalizar matches:', e);
  }

  // Limpa matches órfãos criados por extração DOM (dateTime = hora da coleta).
  // ANTES: delete cascade apagava players/odds. AGORA: migra players para o
  // match real e só então remove o órfão.
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentMatches = await prisma.match.findMany({
      where: { dateTime: { gte: oneHourAgo } },
      include: { players: true },
    });
    for (const recent of recentMatches) {
      const realMatch = await prisma.match.findFirst({
        where: {
          OR: [
            { homeTeam: recent.homeTeam, awayTeam: recent.awayTeam },
            { homeTeam: recent.awayTeam, awayTeam: recent.homeTeam },
          ],
          dateTime: { lt: oneHourAgo },
          id: { not: recent.id },
        },
        orderBy: { dateTime: 'desc' },
      });
      if (!realMatch) continue;

      logger.info(
        `Migrando match órfão DOM: ${recent.homeTeam} vs ${recent.awayTeam} ` +
        `(${recent.dateTime.toISOString()}) → real ${realMatch.id}`,
      );

      for (const player of recent.players) {
        try {
          // Já existe o mesmo nome no match real? Move só os snapshots.
          const existing = await prisma.player.findUnique({
            where: { matchId_name: { matchId: realMatch.id, name: player.name } },
          });
          if (existing) {
            await prisma.oddSnapshot.updateMany({
              where: { playerId: player.id },
              data: { playerId: existing.id },
            });
            await prisma.player.delete({ where: { id: player.id } });
          } else {
            await prisma.player.update({
              where: { id: player.id },
              data: { matchId: realMatch.id },
            });
          }
        } catch (err) {
          logger.error(`Erro ao migrar player ${player.name}:`, { error: String(err) });
        }
      }

      await prisma.match.delete({ where: { id: recent.id } }).catch((e) =>
        logger.error('Erro ao deletar match órfão:', e),
      );
    }
  } catch (e) {
    logger.error('Erro ao limpar matches órfãos DOM:', e);
  }

  // Normaliza nomes de time antes do processamento.
  // Se o time do jogador não bate com casa nem visitante, limpa (scrapers
  // às vezes inventam o home como fallback e gravam visitante no time errado).
  const teamMatchesSide = (team: string, home: string, away: string): boolean => {
    const nt = slugify(team);
    if (!nt) return false;
    const nh = slugify(home);
    const na = slugify(away);
    return (
      nt === nh ||
      nt === na ||
      (nh.length >= 4 && (nt.includes(nh) || nh.includes(nt))) ||
      (na.length >= 4 && (nt.includes(na) || na.includes(nt)))
    );
  };
  const normalizedMatches = scrapedMatches.map(m => {
    const homeTeam = normalizeTeamName(m.homeTeam);
    const awayTeam = normalizeTeamName(m.awayTeam);
    return {
      ...m,
      homeTeam,
      awayTeam,
      odds: m.odds.map(o => {
        const team = o.team ? normalizeTeamName(o.team) : '';
        return {
          ...o,
          team: team && teamMatchesSide(team, homeTeam, awayTeam) ? team : '',
        };
      }),
    };
  });

  /**
   * Chave canônica do jogo: usa os nomes NORMALIZADOS na ordem em que
   * aparecem (home/away). Não ordenamos alfabeticamente porque isso
   * inverteria o mandante e quebraria o lookup no banco (que salva na
   * ordem real do confronto). Inversões de mandante são raras e, quando
   * ocorrem, o match simplesmente é criado/atualizado com a ordem vinda
   * da fonte — o que é aceitável para exibição.
   */
  // Chave canônica: times (ordem alfabética) + dia do jogo.
  // Sem a data, ida/volta ou duas rodadas do mesmo par no mesmo scrape
  // caíam no mesmo balde. Com dateIsNow usamos "today" como dia provisório.
  const matchDay = (d: Date) => {
    const x = new Date(d);
    // Normaliza para America/Sao_Paulo via offset fixo -3h (BRT) em ISO date
    const br = new Date(x.getTime() - 3 * 60 * 60 * 1000);
    return br.toISOString().slice(0, 10);
  };
  const matchKey = (h: string, a: string, date: Date) => {
    const sh = slugify(h);
    const sa = slugify(a);
    const pair = sh <= sa ? `${sh}__vs__${sa}` : `${sa}__vs__${sh}`;
    return `${pair}__${matchDay(date)}`;
  };

  // ── Passada 1: cria/atualiza o Match (com correção de data) ──
  // Processamos os matches "somente data" (dateOnly) por último, para que
  // primeiro o Pitaco/BetMGM criem o match (mesmo com data=agora) e depois a
  // Superbet corrija a dateTime.
  const ordered = [
    ...normalizedMatches.filter(m => !(m as { dateOnly?: boolean }).dateOnly),
    ...normalizedMatches.filter(m => (m as { dateOnly?: boolean }).dateOnly),
  ];

  const matchIds = new Map<string, string>(); // matchKey -> match.id

  for (const match of ordered) {
    try {
      const competition = match.competition || 'brasileirao';
      const dateOnly = (match as { dateOnly?: boolean }).dateOnly ?? false;

      const dateIsNow =
        Math.abs(match.dateTime.getTime() - Date.now()) < 3 * 60 * 60 * 1000;

      // Se a data é "agora" (fonte sem horário), tenta achar match existente
      // na janela ±6h e reutiliza a data real na chave.
      let keyDate = match.dateTime;
      if (dateIsNow) {
        const probe = await prisma.match.findFirst({
          where: {
            OR: [
              { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
              { homeTeam: match.awayTeam, awayTeam: match.homeTeam },
            ],
            dateTime: {
              gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              lte: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
            },
          },
          orderBy: { dateTime: 'asc' },
        });
        if (probe) keyDate = probe.dateTime;
      }
      const key = matchKey(match.homeTeam, match.awayTeam, keyDate);

      // Corrige o stage para o Brasileirão: casas marcam tudo como Série A,
      // mas o confronto pode ser da Série B. Classifica pelos times.
      let finalStage = match.stage;
      if (competition === 'brasileirao') {
        const classified = classifyBrasileiraoStage(match.homeTeam, match.awayTeam);
        if (classified) finalStage = classified;
      }

      // Exclui jogos da Série B (só queremos Série A + MLS por enquanto).
      if (finalStage === 'Brasileirão Série B') {
        logger.info(`[Scrape] Ignorando Série B: ${match.homeTeam} x ${match.awayTeam}`);
        continue;
      }

      // Exclui seleções (Copa do Mundo vazando na MLS via Superbet/BetMGM).
      if (!isClubTeam(match.homeTeam) || !isClubTeam(match.awayTeam)) {
        logger.info(`[Scrape] Ignorando seleção: ${match.homeTeam} x ${match.awayTeam}`);
        continue;
      }

      // Janela de datas: limita a Série A aos próximos 7 dias para não
      // puxar rodadas seguintes (o Pitaco retorna várias rodadas de uma vez).
      // MLS mantém janela maior (10 dias) por jogar com menos frequência.
      if (!dateIsNow) {
        const maxAhead = competition === 'brasileirao' ? 7 : 10;
        const limit = new Date(Date.now() + maxAhead * 24 * 60 * 60 * 1000);
        if (match.dateTime.getTime() > limit.getTime()) {
          logger.info(`[Scrape] Fora da janela (${maxAhead}d): ${match.homeTeam} x ${match.awayTeam} (${match.dateTime.toISOString()})`);
          continue;
        }
      }

      // Busca match existente: por times + janela de data (qualquer competição).
      // ANTES: procurava por times + competição específica (ex: 'brasileirao'),
      // mas a MLS na Betfair também lista jogos do Brasileirão, criando DUPLICATAS
      // do mesmo jogo com competição diferente. Agora ignora competição e usa
      // uma janela de ±6h para evitar duplicatas de fontes com timezone diferente.
      const dateWindow = 6 * 60 * 60 * 1000;
      let existing = await prisma.match.findFirst({
        where: {
          OR: [
            { homeTeam: match.homeTeam, awayTeam: match.awayTeam },
            { homeTeam: match.awayTeam, awayTeam: match.homeTeam },
          ],
          dateTime: {
            gte: new Date(match.dateTime.getTime() - dateWindow),
            lte: new Date(match.dateTime.getTime() + dateWindow),
          },
        },
        orderBy: { dateTime: 'desc' },
      });

      if (existing) {
        matchIds.set(key, existing.id);
        matchCount++;

        // Corrige a data se:
        //  a) a salva é "agora" (placeholder) e a fonte tem horário real
        //  b) diferença de ~2–4h (erro clássico de timezone) e a fonte parece melhor
        const existingIsNow =
          Math.abs(existing.dateTime.getTime() - Date.now()) < 3 * 60 * 60 * 1000;
        const deltaMs = Math.abs(existing.dateTime.getTime() - match.dateTime.getTime());
        const looksLikeTimezoneSkew =
          !dateIsNow &&
          deltaMs >= 2 * 60 * 60 * 1000 &&
          deltaMs <= 5 * 60 * 60 * 1000;
        // Prefere ISO com offset explícito (-03:00) ou openDate Betfair
        const sourceHasOffset = /[zZ]|[+-]\d{2}:\d{2}$/.test(
          String((match as any).dateTimeRaw ?? ''),
        );

        if (!dateIsNow && (existingIsNow || looksLikeTimezoneSkew || sourceHasOffset)) {
          // Só atualiza se a nova data for "mais confiável": não é agora, e
          // (existente é placeholder OU skew de timezone)
          if (existingIsNow || looksLikeTimezoneSkew) {
            await prisma.match.update({
              where: { id: existing.id },
              data: {
                dateTime: match.dateTime,
                stage: finalStage,
                homeFlag: getFlag(match.homeTeam),
                awayFlag: getFlag(match.awayTeam),
              },
            });
            logger.info(
              `[Scrape] Data corrigida: ${match.homeTeam} x ${match.awayTeam} -> ${match.dateTime.toISOString()} (delta=${Math.round(deltaMs / 60000)}min)`,
            );
          }
        } else if (dateOnly && existingIsNow && !dateIsNow) {
          await prisma.match.update({
            where: { id: existing.id },
            data: { dateTime: match.dateTime },
          });
          logger.info(
            `[Scrape] Data corrigida (dateOnly): ${match.homeTeam} x ${match.awayTeam} -> ${match.dateTime.toISOString()}`,
          );
        }
        continue;
      }

      // Match não existe: cria (mesmo que seja dateOnly — assim garante data real).
      const created = await prisma.match.create({
        data: {
          dateTime: match.dateTime,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          stage: finalStage,
          competition,
          homeFlag: getFlag(match.homeTeam),
          awayFlag: getFlag(match.awayTeam),
        },
      });
      matchIds.set(key, created.id);
      matchCount++;
      logger.info(`[Scrape] Match criado: ${match.homeTeam} x ${match.awayTeam} (${match.dateTime.toISOString()})`);

    } catch (error) {
      logger.error(
        `Erro ao criar/atualizar match ${match.homeTeam} vs ${match.awayTeam}:`,
        { error: String(error) },
      );
    }
  }

  // ── Passada 2: mescla as odds de TODAS as fontes no match correto ──
  // Agrupa odds de TODAS as fontes (BetMGM, Superbet, Pitaco, etc.) por match
  // ANTES de chamar mergePlayerOdds — sem isso, jogadores com nomes diferentes
  // entre fontes (ex: "A. Barboza" no Pitaco vs "Alexander Barboza" na Superbet)
  // ficavam como entries separados no DB com team="".
  const oddsByMatch = new Map<string, { matchHome: string; matchAway: string; allOdds: RawPlayerOdd[] }>();
  for (const match of normalizedMatches) {
    // Resolve a mesma chave usada na passada 1 (com data real se dateIsNow)
    let keyDate = match.dateTime;
    const dateIsNow =
      Math.abs(match.dateTime.getTime() - Date.now()) < 3 * 60 * 60 * 1000;
    if (dateIsNow) {
      // Procura chave já resolvida por qualquer ordem de times no map
      const candidates = Array.from(matchIds.keys()).filter((k) => {
        const sh = slugify(match.homeTeam);
        const sa = slugify(match.awayTeam);
        const pair = sh <= sa ? `${sh}__vs__${sa}` : `${sa}__vs__${sh}`;
        return k.startsWith(pair + '__');
      });
      if (candidates.length === 1) {
        const mid = matchIds.get(candidates[0])!;
        // Usa a chave já mapeada
        const key = candidates[0];
        const existing = oddsByMatch.get(key);
        if (existing) {
          existing.allOdds.push(...(match.odds as RawPlayerOdd[]));
        } else {
          oddsByMatch.set(key, {
            matchHome: match.homeTeam,
            matchAway: match.awayTeam,
            allOdds: [...(match.odds as RawPlayerOdd[])],
          });
        }
        continue;
      }
      if (candidates.length > 1) {
        // Escolhe o mais próximo da data atual da fonte
        const key = candidates[0];
        const existing = oddsByMatch.get(key);
        if (existing) {
          existing.allOdds.push(...(match.odds as RawPlayerOdd[]));
        } else {
          oddsByMatch.set(key, {
            matchHome: match.homeTeam,
            matchAway: match.awayTeam,
            allOdds: [...(match.odds as RawPlayerOdd[])],
          });
        }
        continue;
      }
    }
    const key = matchKey(match.homeTeam, match.awayTeam, keyDate);
    const matchId = matchIds.get(key);
    if (!matchId) continue;
    const existing = oddsByMatch.get(key);
    if (existing) {
      existing.allOdds.push(...(match.odds as RawPlayerOdd[]));
    } else {
      oddsByMatch.set(key, {
        matchHome: match.homeTeam,
        matchAway: match.awayTeam,
        allOdds: [...(match.odds as RawPlayerOdd[])],
      });
    }
  }

  for (const [key, entry] of Array.from(oddsByMatch.entries())) {
    const { matchHome, matchAway, allOdds } = entry;
    try {
      const matchId = matchIds.get(key);
      if (!matchId) continue;

      const mergedPlayers = mergePlayerOdds(allOdds);
      const collectedAt = new Date();

      for (const player of mergedPlayers) {
        const savedPlayer = await prisma.player.upsert({
          where: { matchId_name: { matchId, name: player.normalizedName } },
          create: {
            matchId,
            name: player.normalizedName,
            displayName: player.displayName,
            team: player.team || '',
          },
          // Não sobrescreve team com string vazia (fonte sem time apagava o preenchido)
          update: {
            displayName: player.displayName,
            ...(player.team ? { team: player.team } : {}),
          },
        });
        playerCount++;

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

        for (const chunk of chunkArray(snapshotData, SQLITE_BATCH_SIZE)) {
          await prisma.oddSnapshot.createMany({ data: chunk });
          oddCount += chunk.length;
        }
      }

      if (allOdds.length > 0) {
        logger.info(
          `Odds persistidas: ${matchHome} vs ${matchAway} — ` +
          `${mergedPlayers.length} jogadores, ${allOdds.length} odds`,
        );
      }
    } catch (error) {
      logger.error(
        `Erro ao persistir odds de ${matchHome} vs ${matchAway}:`,
        { error: String(error) },
      );
    }
  }

  return { matchCount, playerCount, oddCount };
}
