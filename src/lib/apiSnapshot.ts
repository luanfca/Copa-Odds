/**
 * Snapshots persistentes das respostas de API (ranking, matches).
 *
 * Objetivo: páginas abrirem em ms após restart — sem SofaScore nem
 * recomputar ranking a cada request.
 *
 * Usa SQL direto (CREATE TABLE IF NOT EXISTS) para não depender do
 * `prisma generate` quando o Next está com o DLL do client travado.
 *
 * Ciclo: scrape → purge odds antigas → rebuild snapshots → UI lê snapshot.
 */

import { prisma } from './prisma';
import { findBestOdds, type OddEntry } from './arbitrage';
import { isLikelyPlayerName, isSamePlayer } from './normalize';
import { applyRegularStarters, computeProbableStarterIds } from './starters';
import { attachFullHistory } from './historyEnrich';
import { applyPredictedLineups } from './lineups365';

// NÃO importar winston/logger aqui — este módulo é carregado por instrumentation.ts
// e o Next tenta bundlar winston no client/edge → "Can't resolve 'os'".
const log = {
  info: (msg: string) => console.log(msg),
  warn: (msg: string) => console.warn(msg),
  error: (msg: string) => console.error(msg),
};

const HOUSES = new Set(['betfair', 'betmgm', 'superbet', 'pitaco']);

export function rankingSnapshotKey(market: string, allComps = false, competition?: string): string {
  return `ranking:${market}:${allComps ? 'all' : 'def'}:${competition || 'all'}`;
}

/** O lote diário continua válido até ser substituído pela próxima coleta. */
export const SNAPSHOT_MAX_AGE_MS = 36 * 60 * 60 * 1000;

export async function getApiSnapshot<T = unknown>(
  cacheKey: string,
): Promise<T | null> {
  const meta = await getApiSnapshotWithAge<T>(cacheKey);
  return meta?.data ?? null;
}

export async function getApiSnapshotWithAge<T = unknown>(
  cacheKey: string,
): Promise<{ data: T; ageMs: number; updatedAt: Date } | null> {
  try {
    const row = await prisma.apiSnapshot.findUnique({ where: { cacheKey } });
    if (!row?.data) return null;
    const updatedAt = row.updatedAt;
    const ageMs = Number.isFinite(updatedAt.getTime())
      ? Date.now() - updatedAt.getTime()
      : Number.POSITIVE_INFINITY;
    return { data: JSON.parse(row.data) as T, ageMs, updatedAt };
  } catch {
    return null;
  }
}

export async function setApiSnapshot(cacheKey: string, kind: string, body: unknown): Promise<void> {
  const data = JSON.stringify(body);
  await prisma.apiSnapshot.upsert({
    where: { cacheKey },
    update: { kind, data },
    create: { cacheKey, kind, data },
  });
}

export async function clearApiSnapshots(): Promise<void> {
  try {
    await prisma.apiSnapshot.deleteMany();
  } catch (e) {
    log.warn(`[ApiSnapshot] clear falhou: ${String(e)}`);
  }
}

/**
 * Apaga odds antigas. Se `onlyHouses` for passado, só remove odds dessas casas
 * (casas que falharam no scrape mantêm a coleta anterior — evita sumir jogo
 * tipo Coritiba x Palmeiras quando um adapter falha).
 */
export async function purgeOldOdds(
  scrapeStartedAt: Date,
  onlyHouses?: string[],
): Promise<number> {
  if (onlyHouses && onlyHouses.length === 0) return 0;
  const res = await prisma.oddSnapshot.deleteMany({
    where: {
      collectedAt: { lt: scrapeStartedAt },
      ...(onlyHouses?.length ? { house: { in: onlyHouses } } : {}),
    },
  });
  return res.count;
}

/** Ranking leve: só odds do SQLite (sem SofaScore). */
export async function buildLightRanking(market: string, allComps = false, competition?: string) {
  // Odds das últimas 36h (pré-jogo + escalação oficial costuma sair 1–2h antes)
  const timeThreshold = new Date(Date.now() - 36 * 60 * 60 * 1000);
  // Mantém jogo desde 5h após início “passado” até +7 dias
  // (escalação oficial ~1h antes → usuário ainda vê o confronto às 18h pro 19:30)
  const matchFrom = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const matchTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  // Odds absurdas (boost/bug) poluem a UI
  const MAX_ODD = 50;

  // Corrige horários errados (timezone do scrape) com 365scores — 1x por rebuild
  try {
    const upcoming = await prisma.match.findMany({
      where: { dateTime: { gte: matchFrom, lte: matchTo } },
      select: { id: true, homeTeam: true, awayTeam: true, dateTime: true },
      take: 80,
    });
    if (upcoming.length) {
      const { syncKickoffsFrom365 } = await import('./lineups365');
      await syncKickoffsFrom365(upcoming);
    }
  } catch {
    /* best-effort */
  }

  const players = await prisma.player.findMany({
    where: {
      match: {
        dateTime: { gte: matchFrom, lte: matchTo },
        ...(competition ? { competition } : {}),
      },
    },
    include: {
      match: true,
      snapshots: {
        where: {
          collectedAt: { gte: timeThreshold },
          market,
          house: { in: Array.from(HOUSES) },
          value: { gt: 1, lte: MAX_ODD },
        },
        orderBy: { collectedAt: 'desc' },
      },
    },
  });

  const filtered = players;

  const starterIds = computeProbableStarterIds(
    filtered
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

  const HOUSE_FALLBACK: Record<string, string> = {
    betmgm: 'https://www.betmgm.bet.br',
    superbet: 'https://superbet.bet.br',
    betfair: 'https://www.betfair.bet.br',
    pitaco: 'https://pitaco.bet.br',
  };

  type PlayerResult = {
    id: string;
    displayName: string;
    team: string;
    matchId: string;
    match: {
      id: string;
      homeTeam: string;
      awayTeam: string;
      homeFlag: string | null;
      awayFlag: string | null;
      dateTime: string;
      stage: string;
      competition?: string;
    };
    isStarter: boolean;
    starterSource?: string;
    odds: OddEntry[];
    bestByLine: Record<string, OddEntry>;
    history: any;
    analysis?: any;
  };

  const results: PlayerResult[] = [];

  for (const player of filtered) {
    if (player.snapshots.length === 0) continue;
    if (!isLikelyPlayerName(player.displayName || player.name)) continue;

    const latestByHouseLine = new Map<string, (typeof player.snapshots)[0]>();
    for (const snap of player.snapshots) {
      if (!HOUSES.has(snap.house)) continue;
      const key = `${snap.house}_${snap.line}`;
      if (!latestByHouseLine.has(key)) latestByHouseLine.set(key, snap);
    }

    const odds: OddEntry[] = Array.from(latestByHouseLine.values()).map((s) => ({
      house: s.house as OddEntry['house'],
      line: s.line,
      value: s.value,
      url: s.url ?? HOUSE_FALLBACK[s.house] ?? undefined,
    }));
    if (odds.length === 0) continue;

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
      isStarter: starterIds.has(player.id),
      odds,
      bestByLine: Object.fromEntries(findBestOdds(odds)) as Record<string, OddEntry>,
      history: null,
    });
  }

  // Dedup: mesmo jogador no mesmo confronto (matchId OU mesmos times)
  // Evita 2× "Kaio Jorge" — um com odds e outro vazio (sumia Pitaco/2+).
  const deduped: PlayerResult[] = [];
  for (const r of results) {
    let merged = false;
    for (const existing of deduped) {
      const sameTeam = !existing.team || !r.team || existing.team === r.team;
      const sameMatchId = existing.matchId === r.matchId;
      const sameFixture =
        (existing.match.homeTeam === r.match.homeTeam && existing.match.awayTeam === r.match.awayTeam) ||
        (existing.match.homeTeam === r.match.awayTeam && existing.match.awayTeam === r.match.homeTeam);
      if ((sameMatchId || sameFixture) && sameTeam && isSamePlayer(existing.displayName, r.displayName)) {
        for (const odd of r.odds) {
          if (!HOUSES.has(odd.house)) continue;
          const ex = existing.odds.find((o) => o.house === odd.house && o.line === odd.line);
          if (!ex) existing.odds.push(odd);
          else if (odd.value > ex.value) {
            ex.value = odd.value;
            if (odd.url) ex.url = odd.url;
          }
        }
        if (r.odds.length > existing.odds.length) {
          existing.matchId = r.matchId;
          existing.match = r.match;
          existing.id = r.id;
        }
        existing.bestByLine = Object.fromEntries(findBestOdds(existing.odds)) as Record<string, OddEntry>;
        if (r.displayName.length > existing.displayName.length) existing.displayName = r.displayName;
        if (r.team && !existing.team) existing.team = r.team;
        merged = true;
        break;
      }
    }
    if (!merged) {
      r.odds = r.odds.filter((o) => HOUSES.has(o.house));
      if (r.odds.length === 0) continue;
      r.bestByLine = Object.fromEntries(findBestOdds(r.odds)) as Record<string, OddEntry>;
      deduped.push(r);
    }
  }

  deduped.sort((a, b) => {
    const ba = Math.max(...a.odds.map((o) => o.value), 0);
    const bb = Math.max(...b.odds.map((o) => o.value), 0);
    return bb - ba;
  });

  return {
    players: deduped,
    market,
    mock: false,
    fromSnapshot: true,
    builtAt: new Date().toISOString(),
  };
}

/** Value-odds leve (sem histórico externo) a partir das odds do banco. */
export async function buildLightValueOdds(
  rankings?: Map<string, any>,
) {
  const rankingMarkets = [
    'desarmes',
    'faltas_cometidas',
    'faltas_sofridas',
    'finalizacao',
    'chutes_ao_gol',
  ];
  const opportunities: any[] = [];

  for (const market of rankingMarkets) {
    const body = rankings?.get(market) ?? await buildLightRanking(market, true);
    for (const p of body.players) {
      const byLine = new Map<string, OddEntry[]>();
      for (const o of p.odds) {
        const list = byLine.get(o.line) ?? [];
        list.push(o);
        byLine.set(o.line, list);
      }
      for (const [line, odds] of byLine) {
        // Precisa de 2+ casas para haver "desajuste" entre elas
        if (odds.length < 2) continue;
        const sorted = [...odds].sort((a, b) => b.value - a.value);
        const best = sorted[0];
        const second = sorted[1];
        const diffPct = ((best.value - second.value) / second.value) * 100;
        // Limiar baixo (3%): captura mais jogadores; o filtro da UI corta o resto
        if (diffPct < 3) continue;
        opportunities.push({
          id: `${p.matchId}_${p.displayName}_${market}_${line}`,
          player: {
            id: p.id,
            name: p.displayName,
            displayName: p.displayName,
            team: p.team,
            isProbableStarter: p.isStarter,
            starterSource: p.starterSource,
          },
          match: p.match,
          market,
          line,
          odds,
          bestOddHouse: best.house,
          bestOddValue: best.value,
          secondBestOddValue: second.value,
          diffPct: parseFloat(diffPct.toFixed(1)),
          history: p.history ?? null,
          analysis: p.analysis ?? null,
        });
      }
    }
  }

  opportunities.sort((a, b) => b.diffPct - a.diffPct);
  return {
    opportunities: opportunities.slice(0, 3000),
    mock: false,
    fromSnapshot: true,
    builtAt: new Date().toISOString(),
  };
}

export async function buildLightMatches() {
  const matchFrom = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const matchTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const allMatches = await prisma.match.findMany({
    where: { dateTime: { gte: matchFrom, lte: matchTo } },
    orderBy: { dateTime: 'asc' },
    include: { _count: { select: { players: true } } },
  });

  const DUP_WINDOW = 6 * 60 * 60 * 1000;
  const deduped: typeof allMatches = [];
  for (const m of allMatches) {
    let found = false;
    for (const existing of deduped) {
      const sameTeams =
        (existing.homeTeam === m.homeTeam && existing.awayTeam === m.awayTeam) ||
        (existing.homeTeam === m.awayTeam && existing.awayTeam === m.homeTeam);
      if (!sameTeams) continue;
      const dateDiff = Math.abs(existing.dateTime.getTime() - m.dateTime.getTime());
      if (dateDiff > DUP_WINDOW) continue;
      found = true;
      if (m._count.players > existing._count.players) Object.assign(existing, m);
      break;
    }
    if (!found) deduped.push(m);
  }

  const lastScrape = await prisma.scrapeLog.findFirst({
    where: { status: { in: ['success', 'partial'] } },
    orderBy: { finishedAt: 'desc' },
  });

  return {
    matches: deduped.map((m) => ({
      id: m.id,
      dateTime: m.dateTime.toISOString(),
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      competition: m.competition,
      stage: m.stage,
      homeFlag: m.homeFlag,
      awayFlag: m.awayFlag,
      playerCount: m._count.players,
    })),
    mock: false,
    lastUpdated: lastScrape?.finishedAt?.toISOString() || null,
    scrapeStatus: lastScrape?.status || null,
    fromSnapshot: true,
    builtAt: new Date().toISOString(),
  };
}

const RANKING_MARKETS = [
  'desarmes',
  'faltas_cometidas',
  'faltas_sofridas',
  'finalizacao',
  'chutes_ao_gol',
];

export async function rebuildApiSnapshots(
  options: { includeHistory?: boolean; atomic?: boolean } = {},
): Promise<void> {
  const t0 = Date.now();
  const pending: Array<{ cacheKey: string; kind: string; body: any }> = [];
  const valueRankings = new Map<string, any>();

  for (const market of RANKING_MARKETS) {
    for (const allComps of [false, true]) {
      const key = rankingSnapshotKey(market, allComps);
      const body = await buildLightRanking(market, allComps);
      if (options.includeHistory) {
        const scope = allComps ? 'all' : 'league';
        await attachFullHistory(
          body.players,
          market,
          allComps,
          10,
          undefined,
          scope,
          undefined,
        );
        applyRegularStarters(body.players);
        await applyPredictedLineups(body.players, 30_000);
      }
      pending.push({ cacheKey: key, kind: 'ranking', body });
      if (allComps) valueRankings.set(market, body);
      log.info(`[ApiSnapshot] ${key}: ${body.players.length} jogadores`);
    }
  }

  const matchesBody = await buildLightMatches();
  pending.push({ cacheKey: 'matches', kind: 'matches', body: matchesBody });

  const voBody = await buildLightValueOdds(valueRankings);
  pending.push({ cacheKey: 'value-odds', kind: 'value-odds', body: voBody });

  if (options.atomic) {
    await prisma.$transaction(
      pending.map((snapshot) =>
        prisma.apiSnapshot.upsert({
          where: { cacheKey: snapshot.cacheKey },
          update: {
            kind: snapshot.kind,
            data: JSON.stringify(snapshot.body),
          },
          create: {
            cacheKey: snapshot.cacheKey,
            kind: snapshot.kind,
            data: JSON.stringify(snapshot.body),
          },
        }),
      ),
    );
  } else {
    for (const snapshot of pending) {
      await setApiSnapshot(snapshot.cacheKey, snapshot.kind, snapshot.body);
    }
  }

  log.info(
    `[ApiSnapshot] Rebuild OK em ${Date.now() - t0}ms — ${matchesBody.matches.length} jogos, ${voBody.opportunities.length} value-odds`,
  );
}
