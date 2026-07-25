import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { computeProbableStarterIds } from '@/lib/starters';
import { getStartersForMatch } from '@/lib/lineups365';
import { findBestOdds, type OddEntry } from '@/lib/arbitrage';
import { isLikelyPlayerName, isSamePlayer } from '@/lib/normalize';
import {
  attachFullHistory,
  scheduleHistoryEnrich,
  enrichJobKey,
  getEnrichJobStatus,
  isHistoryCoverageOk,
  applyHistoryAnalysis,
} from '@/lib/historyEnrich';
import { applyRegularStarters } from '@/lib/starters';
import { applyPredictedLineups } from '@/lib/lineups365';

import { desCache, DES_TTL } from '@/lib/cacheInvalidation';
import { broadcastScrapeError } from '@/lib/ws-server';
import {
  getApiSnapshot,
  getApiSnapshotWithAge,
  setApiSnapshot,
  rankingSnapshotKey,
  buildLightRanking,
} from '@/lib/apiSnapshot';

export const dynamic = 'force-dynamic';

/** Preserva history/analysis de um snapshot anterior ao reconstruir odds (light). */
function mergeHistoryFromPrev(light: any, prev: any): any {
  if (!light?.players?.length || !prev?.players?.length) return light;
  const prevByKey = new Map<string, any>();
  for (const p of prev.players) {
    if (p?.history?.entries?.length) {
      prevByKey.set(`${p.team || ''}::${p.displayName}`, p);
      prevByKey.set(`::${p.displayName}`, p);
    }
  }
  for (const p of light.players) {
    if (p.history?.entries?.length) continue;
    const hit =
      prevByKey.get(`${p.team || ''}::${p.displayName}`) ||
      prevByKey.get(`::${p.displayName}`);
    if (hit?.history) {
      p.history = hit.history;
      if (hit.analysis) p.analysis = hit.analysis;
    }
  }
  return light;
}

function withHistoryMeta(
  body: any,
  filled: number,
  missing: number,
  resolved: number,
  job: ReturnType<typeof getEnrichJobStatus>,
) {
  const total = filled + missing;
  // Job terminou ⇒ cobertura ok mesmo se alguns sem dados no 365
  const coverageOk =
    (job?.done === true) || isHistoryCoverageOk(filled, total, resolved);
  return {
    ...body,
    historyMeta: {
      filled,
      missing,
      resolved,
      total,
      coverageOk,
      job,
    },
  };
}

/** Snapshot diário já foi completamente processado; ausências são definitivas
 * para este lote e não devem iniciar polling no navegador. */
function withCompletedSnapshotMeta(body: any) {
  const players = Array.isArray(body?.players) ? body.players : [];
  const filled = players.filter(
    (player: any) => player?.history?.entries?.length > 0,
  ).length;
  const total = players.length;
  const missing = total - filled;
  return {
    ...body,
    historyMeta: {
      filled,
      missing,
      resolved: total,
      total,
      coverageOk: true,
      job: {
        running: false,
        done: true,
        total,
        filled,
        missing,
      },
    },
  };
}

async function prepareBodyWithHistory(
  body: any,
  market: string,
  allComps: boolean,
  maxGames: number | undefined,
  year: number | undefined,
  competition: string | undefined,
  startJob: boolean,
  historyScope: 'league' | 'all' = 'league',
) {
  const sanitized = body;
  // historyScope=all → Liberta + copas; league → só BR ou só MLS
  const scope: 'league' | 'all' = historyScope === 'all' ? 'all' : 'league';
  const histAllComps = scope === 'all';
  const compFilter = competition && competition !== 'all' ? competition : undefined;
  const jobKey = enrichJobKey(market, histAllComps, compFilter, year, scope);
  const cap = maxGames && maxGames > 0 ? Math.min(maxGames, 10) : 10;

  const first = await attachFullHistory(
    sanitized?.players ?? [],
    market,
    histAllComps,
    cap,
    year,
    scope,
    compFilter,
  );

  // Job barato se o SQLite já tem o histórico (só atualiza com jogo novo)
  if (startJob && sanitized?.players?.length) {
    scheduleHistoryEnrich(
      jobKey,
      sanitized.players,
      market,
      histAllComps,
      year,
      compFilter,
      scope,
    );
  }

  const again = await attachFullHistory(
    sanitized?.players ?? [],
    market,
    histAllComps,
    cap,
    year,
    scope,
    compFilter,
  );

  if (Array.isArray(sanitized?.players) && sanitized.players.length) {
    // 1) Fallback: quem mais joga (histórico) — útil se não houver escalação
    applyRegularStarters(sanitized.players);
    // 2) Primário: escalação PREVISTA/confirmada do 365scores (XI de cada time)
    try {
      await applyPredictedLineups(sanitized.players, 10_000);
    } catch {
      /* mantém heurística de regulares */
    }
  }

  const job = getEnrichJobStatus(jobKey);
  return withHistoryMeta(sanitized, again.filled, again.missing, again.resolved, job);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.has('refresh');
  // enrich/history: o job roda em background; a resposta sempre anexa o que já tiver no cache
  const market = url.searchParams.get('market') ?? 'desarmes';
  const allComps = url.searchParams.get('allComps') === 'true';
  const competition = url.searchParams.get('competition') ?? undefined;
  const maxGamesRaw = url.searchParams.has('maxGames')
    ? parseInt(url.searchParams.get('maxGames')!)
    : 10;
  const maxGames = Number.isFinite(maxGamesRaw)
    ? Math.min(Math.max(maxGamesRaw || 10, 1), 10)
    : 10;
  const year = url.searchParams.has('year') ? parseInt(url.searchParams.get('year')!) : undefined;
  // league (default) = só BR/MLS | all = todos os jogos (Liberta etc.)
  const historyScopeParam = url.searchParams.get('historyScope');
  const historyScope: 'league' | 'all' =
    historyScopeParam === 'all' ? 'all' : 'league';

  const cacheKey = `${market}_${allComps}_${competition || 'all'}_${maxGames}_${year ?? 'cur'}_${historyScope}`;
  const snapKey = rankingSnapshotKey(market, allComps, competition);

  const ACTIVE = new Set(['betfair', 'betmgm', 'superbet', 'pitaco']);
  function sanitizeRankingBody(body: any) {
    if (!body?.players) return body;
    return {
      ...body,
      players: body.players
        .map((p: any) => {
          const odds = (p.odds || []).filter((o: any) => ACTIVE.has(o.house));
          if (odds.length === 0) return null;
          // recalcula bestByLine só com casas ativas
          const bestByLine: Record<string, any> = {};
          for (const o of odds) {
            if (!bestByLine[o.line] || o.value > bestByLine[o.line].value) bestByLine[o.line] = o;
          }
          // NÃO remove history/analysis — só limpa casas inativas nas odds
          return { ...p, odds, bestByLine };
        })
        .filter(Boolean),
    };
  }

  // 1) Snapshot fresco / memória / rebuild light do banco
  //    Snapshot >90s → reconstrói do SQLite (evita sumir Coritiba×Palmeiras
  //    depois de scrape parcial ou escalação saindo e cache velho).
  if (!forceRefresh) {
    const snapMeta = await getApiSnapshotWithAge(snapKey);
    if (snapMeta) {
      // O lote diário já contém histórico e escalações. Aqui só fazemos uma
      // cópia e fatiamos 5/10 jogos em memória, sem chamadas externas.
      const body = sanitizeRankingBody(
        JSON.parse(JSON.stringify(snapMeta.data)),
      );
      for (const player of body?.players ?? []) {
        applyHistoryAnalysis(player, maxGames);
      }
      return NextResponse.json(withCompletedSnapshotMeta(body), {
        headers: {
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
          'X-Cache': 'SNAPSHOT',
          'X-Snapshot-Age-Ms': String(Math.round(snapMeta.ageMs)),
        },
      });
    }

    const cached = desCache.get(cacheKey);
    // Memória curta (45s) — ranking pré-jogo muda com scrape/escalação
    if (
      cached &&
      Date.now() - cached.t < 45_000 &&
      cached.allComps === allComps
    ) {
      const body = await prepareBodyWithHistory(
        sanitizeRankingBody(cached.body),
        market,
        allComps,
        maxGames,
        year,
        competition,
        true,
        historyScope,
      );
      return NextResponse.json(body, { headers: { 'X-Cache': 'MEMORY' } });
    }

    try {
      const prev = await getApiSnapshot(snapKey);
      let light = sanitizeRankingBody(await buildLightRanking(market, allComps, competition));
      light = mergeHistoryFromPrev(light, prev);
      const body = await prepareBodyWithHistory(
        light,
        market,
        allComps,
        maxGames,
        year,
        competition,
        true,
        historyScope,
      );
      await setApiSnapshot(snapKey, 'ranking', {
        players: body.players,
        market: body.market,
        mock: body.mock,
        builtAt: body.builtAt,
      });
      desCache.set(cacheKey, { body, t: Date.now(), allComps });
      return NextResponse.json(body, {
        headers: {
          'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=30',
          'X-Cache': 'BUILT-LIGHT',
        },
      });
    } catch {
      // cai no path completo abaixo
    }
  }

  try {
    // Janela fixa de 48h: mostra odds de todos os scrapes recentes,
    // independente de qual scrape as coletou.
    // ANTES usava o startedAt do último scrape, o que fazia odds de
    // scrapes anteriores sumirem quando um novo scrape rodava.
    const timeThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);

    // Filtra por competition se especificado
    const matchFilter: any = {};
    if (competition) {
      matchFilter.competition = competition;
    }

    const hasCompetitionFilter = Object.keys(matchFilter).length > 0;

    const players = await prisma.player.findMany({
      include: {
        match: true,
        snapshots: {
          where: { collectedAt: { gte: timeThreshold }, market },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    // Filtra jogadores por competition apÃ³s buscar (mais seguro que relation filter)
    const filteredPlayers = hasCompetitionFilter
      ? players.filter((p) => p.match?.competition === competition)
      : players;

    const starterIds = computeProbableStarterIds(
      filteredPlayers
        .filter((p) => p.snapshots.length > 0)
        .map((p) => ({
          playerId: p.id,
          matchId: p.matchId,
          team: p.team,
          houses: p.snapshots.map((s) => s.house),
          lines: p.snapshots.map((s) => s.line),
          snapshotCount: p.snapshots.length,
        })),
    );

    const matchById = new Map<string, (typeof filteredPlayers)[number]['match']>();
    for (const p of filteredPlayers) {
      if (p.snapshots.length > 0 && !matchById.has(p.matchId)) {
        matchById.set(p.matchId, p.match);
      }
    }

    const startersByMatch = new Map<string, any>();
    await Promise.race([
      Promise.all(
        Array.from(matchById.entries()).map(async ([matchId, m]) => {
          const ms = await getStartersForMatch(m.homeTeam, m.awayTeam, m.dateTime.toISOString());
          startersByMatch.set(matchId, ms);
        })
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 5000)),
    ]);

    const isProbableStarter = (player: (typeof filteredPlayers)[number]): boolean => {
      const ms = startersByMatch.get(player.matchId);
      if (ms) return ms.isStarter(player.displayName || player.name, player.team);
      return starterIds.has(player.id);
    };

    const HOUSE_FALLBACK: Record<string, string> = {
      betmgm: 'https://www.betmgm.bet.br',
      superbet: 'https://superbet.bet.br',
      betfair: 'https://www.betfair.bet.br',
      bet365: 'https://www.bet365.bet.br',
      betsson: 'https://www.betsson.bet.br',
      pitaco: 'https://pitaco.bet.br',
    };

    interface PlayerResult {
      id: string;
      displayName: string;
      team: string;
      matchId: string;
      match: { id: string; homeTeam: string; awayTeam: string; homeFlag: string | null; awayFlag: string | null; dateTime: string; stage: string; competition?: string };
      isStarter: boolean;
      odds: OddEntry[];
      bestByLine: Record<string, OddEntry>;
      history: { entries: { date: string; opponent: string; value: number; minutes: number | null }[]; total: number; average: number } | null;
      analysis?: Array<{ line: string; probability: number; fairOdds: number; bestOdd: number; ev: number; hasValue: boolean }>;
    }

    const results: PlayerResult[] = [];

    for (const player of filteredPlayers) {
      if (player.snapshots.length === 0) continue;
      if (!isLikelyPlayerName(player.displayName || player.name)) continue;

      const latestByHouseLine = new Map<string, (typeof player.snapshots)[0]>();
      for (const snap of player.snapshots) {
        const key = `${snap.house}_${snap.line}`;
        if (!latestByHouseLine.has(key)) {
          latestByHouseLine.set(key, snap);
        }
      }

      const ACTIVE = new Set(['betfair', 'betmgm', 'superbet', 'pitaco']);
      const odds: OddEntry[] = Array.from(latestByHouseLine.values())
        .filter((s) => ACTIVE.has(s.house))
        .map((s) => ({
          house: s.house as OddEntry['house'],
          line: s.line,
          value: s.value,
          url: s.url ?? HOUSE_FALLBACK[s.house] ?? undefined,
        }));

      if (odds.length === 0) continue;

      const bestByLine = Object.fromEntries(findBestOdds(odds)) as Record<string, OddEntry>;

      results.push({
        id: player.id,
        displayName: player.displayName,
        team: player.team,
        matchId: player.matchId,
        match: {
          id: player.match.id,
          homeTeam: player.match.homeTeam,
          awayTeam: player.match.awayTeam,
          homeFlag: player.match.homeFlag,
          awayFlag: player.match.awayFlag,
          dateTime: player.match.dateTime.toISOString(),
          stage: player.match.stage,
          competition: player.match.competition,
        },
        isStarter: isProbableStarter(player),
        odds,
        bestByLine,
        history: null,
      });
    }

    // DEDUPLICAÃ‡ÃƒO: mescla jogadores duplicados do banco (ex: "J. Arias" + "Jhon Arias")
    // que foram criados por scrapes anteriores antes da correÃ§Ã£o do matchKey.
    // Usa isSamePlayer da lib normalize (fuzzy match por sobrenome + inicial + Levenshtein).
    // O dedup Ã© feito ANTES do uniquePlayers para evitar buscar histÃ³rico duplicado.
    const deduped: PlayerResult[] = [];
    for (const r of results) {
      let merged = false;
      for (const existing of deduped) {
        // SÃ³ mescla no mesmo match E mesmo time (evita fundir dois jogadores
        // diferentes com mesmo nome em times opostos)
        const sameTeam = !existing.team || !r.team || existing.team === r.team;
        if (existing.matchId === r.matchId && sameTeam && isSamePlayer(existing.displayName, r.displayName)) {
          // Mescla odds do duplicado no existente (mantÃ©m maior odd por casa+linha)
          for (const odd of r.odds) {
            const exists = existing.odds.find(o => o.house === odd.house && o.line === odd.line);
            if (!exists) {
              existing.odds.push(odd);
            } else if (odd.value > exists.value) {
              exists.value = odd.value;
              if (odd.url) exists.url = odd.url;
            }
          }
          // Recalcula bestByLine via findBestOdds (jÃ¡ importado)
          existing.bestByLine = Object.fromEntries(findBestOdds(existing.odds)) as Record<string, OddEntry>;
          // MantÃ©m o displayName mais longo (mais completo)
          if (r.displayName.length > existing.displayName.length) {
            existing.displayName = r.displayName;
          }
          merged = true;
          break;
        }
      }
      if (!merged) {
        deduped.push(r);
      }
    }
    results.length = 0;
    results.push(...deduped);

    // Histórico: cache full (15) + job em background — NÃO bloqueia 180s
    // (trocar de aba / abrir outra página não cancela o job do servidor)
    const bodyBase = {
      players: results,
      market,
      mock: false,
      builtAt: new Date().toISOString(),
    };
    const body = await prepareBodyWithHistory(
      bodyBase,
      market,
      allComps,
      maxGames,
      year,
      competition,
      true,
      historyScope,
    );

    // Ordena por média de desarmes (decrescente), depois por melhor odd
    function bestOddValue(r: (typeof results)[0]): number {
      return Math.max(...r.odds.map((o) => o.value), 0);
    }
    body.players.sort((a: any, b: any) => {
      const avgA = a.history?.average ?? 0;
      const avgB = b.history?.average ?? 0;
      if (avgB !== avgA) return avgB - avgA;
      return bestOddValue(b) - bestOddValue(a);
    });

    desCache.set(cacheKey, { body, t: Date.now(), allComps });
    await setApiSnapshot(snapKey, 'ranking', {
      players: body.players,
      market: body.market,
      mock: false,
      builtAt: body.builtAt,
    }).catch(() => null);

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60',
        'X-Cache': 'FULL-LIGHT-HIST',
      },
    });
  } catch (error) {
    broadcastScrapeError(String(error))
    return NextResponse.json({ error: 'Erro ao buscar ranking de desarmes', detail: String(error) }, { status: 500 });
  }
}

