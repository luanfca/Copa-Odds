import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockOddsData, mockMatches } from '@/lib/mockData';
import { computeProbableStarterIds } from '@/lib/starters';
import { getStartersForMatch, type MatchStarters } from '@/lib/lineups365';
import { getPlayerHistory } from '@/lib/playerStats365';
import { SHARED_HISTORY_CACHE } from '@/lib/sharedCache';

export const dynamic = 'force-dynamic';
const VO_TTL = 60_000;       // 1 min: serve fresco
const VO_STALE_TTL = 600_000; // 10 min: serve stale enquanto revalida
let voCache: { body: any; t: number } | null = null;
let voRevalidating = false; // evita revalidações paralelas

/** Invalida cache server-side. Chamado após nova coleta. */
export function invalidateVoCache(): void {
  voCache = null;
}
// v5: evita cache de nulos devido a rate limit
const CACHE_VERSION = 'v6-shared-cache-fix';

function hKey(team: string, name: string, market: string) {
  return `${CACHE_VERSION}::${team}::${name}::${market}`;
}

// Executa o recálculo completo e atualiza voCache + HISTORY_CACHE3 em background
async function revalidateCache() {
  if (voRevalidating) return;
  voRevalidating = true;
  try {
    await buildResponse();
  } finally {
    voRevalidating = false;
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.has('refresh') || url.searchParams.has('bust');
  const age = voCache ? Date.now() - voCache.t : Infinity;

  // Serve cache fresco imediatamente
  if (!forceRefresh && voCache && age < VO_TTL) {
    return NextResponse.json(voCache.body);
  }
  // Cache expirou mas ainda está dentro do stale window: serve stale + revalida em bg
  if (!forceRefresh && voCache && age < VO_STALE_TTL) {
    revalidateCache(); // fire-and-forget
    return NextResponse.json(voCache.body);
  }
  // Cache inválido ou forceRefresh: recalcula na hora e aguarda
  return buildResponse();
}

async function buildResponse(): Promise<NextResponse> {
  try {
    const useMock = process.env.USE_MOCK === 'true';

    if (useMock) {
      // Oportunidades fictícias para o modo de demonstração
      const mockValueOdds = [];

      for (const m of mockMatches) {
        const matchOdds = mockOddsData.find(o => o.matchId === m.id);
        if (!matchOdds) continue;

        for (const p of matchOdds.players) {
          const oddsByLine = new Map<string, typeof p.odds>();
          for (const o of p.odds) {
            const list = oddsByLine.get(o.line) ?? [];
            list.push(o);
            oddsByLine.set(o.line, list);
          }

          for (const [line, odds] of Array.from(oddsByLine.entries())) {
            if (odds.length >= 2) {
              const sorted = [...odds].sort((a, b) => b.value - a.value);
              const best = sorted[0];
              const secondBest = sorted[1];
              
              // Ajusta um desajuste artificial para exibição legal no mock
              const artificialBestVal = secondBest.value * 1.35; // +35% desajustado
              
              const adjustedOdds = odds.map(o => ({
                house: o.house,
                line: o.line,
                value: o.house === best.house ? parseFloat(artificialBestVal.toFixed(2)) : o.value,
                url: o.house === 'superbet'
                  ? 'https://superbet.bet.br'
                  : o.house === 'betmgm'
                  ? 'https://www.betmgm.bet.br'
                  : 'https://www.betfair.bet.br',
              }));

              const finalSorted = [...adjustedOdds].sort((a, b) => b.value - a.value);
              const finalBest = finalSorted[0];
              const finalSecond = finalSorted[1];
              const diffPct = ((finalBest.value - finalSecond.value) / finalSecond.value) * 100;

              if (diffPct > 0) {
                mockValueOdds.push({
                  id: `${m.id}_${p.name}_${line}`,
                  player: {
                    id: p.id,
                    name: p.name,
                    displayName: p.displayName,
                    team: p.team,
                    isProbableStarter: true,
                  },
                  match: {
                    id: m.id,
                    homeTeam: m.homeTeam,
                    awayTeam: m.awayTeam,
                    homeFlag: m.homeFlag,
                    awayFlag: m.awayFlag,
                    dateTime: m.dateTime,
                    stage: m.stage,
                  },
                  market: 'desarmes',
                  line,
                  odds: adjustedOdds,
                  bestOddHouse: finalBest.house,
                  bestOddValue: finalBest.value,
                  secondBestOddValue: finalSecond.value,
                  diffPct: parseFloat(diffPct.toFixed(1)),
                });
              }
            }
          }
        }
      }

      mockValueOdds.sort((a, b) => b.diffPct - a.diffPct);
      return NextResponse.json({ opportunities: mockValueOdds, mock: true });
    }

    // BUSCA NO BANCO REAL
    // 1. Localiza o último scrape com status de sucesso/parcial
    const lastScrape = await prisma.scrapeLog.findFirst({
      where: { status: { in: ['success', 'partial'] } },
      orderBy: { finishedAt: 'desc' },
    });

    // Filtra odds coletadas apenas na última execução ativa (ou últimas 4h caso nulo)
    // Reduz drasticamente a quantidade de snapshots carregados em memória.
    const timeThreshold = lastScrape?.startedAt
      ? lastScrape.startedAt
      : new Date(Date.now() - 4 * 60 * 60 * 1000);

    // 2. Busca todos os jogadores e seus snapshots nesse intervalo de tempo
    const players = await prisma.player.findMany({
      include: {
        match: true,
        snapshots: {
          where: {
            collectedAt: { gte: timeThreshold },
          },
          orderBy: { collectedAt: 'desc' },
        },
      },
    });

    // Marca os prováveis titulares: top-11 por seleção, pela cobertura das casas
    // (quem as casas abrem mercado = quem elas esperam que jogue).
    const starterIds = computeProbableStarterIds(
      players
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

    // Fonte primária dos titulares: escalação provável/confirmada do 365scores
    // (mesmo canal das fotos). Uma busca por jogo distinto, em paralelo, cacheada.
    const matchById = new Map<string, (typeof players)[number]['match']>();
    for (const p of players) {
      if (p.snapshots.length > 0 && !matchById.has(p.matchId)) matchById.set(p.matchId, p.match);
    }
    const startersByMatch = new Map<string, MatchStarters | null>();
    await Promise.race([
      Promise.all(
        Array.from(matchById.entries()).map(async ([matchId, m]) => {
          const ms = await getStartersForMatch(m.homeTeam, m.awayTeam, m.dateTime.toISOString());
          startersByMatch.set(matchId, ms);
        })
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 3000))
    ]);

    // 365scores quando disponível para o jogo; senão cai na heurística de cobertura.
    const isProbableStarter = (player: (typeof players)[number]): boolean => {
      const ms = startersByMatch.get(player.matchId);
      if (ms) return ms.isStarter(player.displayName || player.name, player.team);
      return starterIds.has(player.id);
    };

    const opportunities = [];

    const HOUSE_FALLBACK: Readonly<Record<string, string>> = {
      betmgm:   'https://www.betmgm.bet.br',
      superbet: 'https://superbet.bet.br',
      betfair:  'https://www.betfair.bet.br',
    };

    // 3. Processa cada jogador e calcula as diferenças
    for (const player of players) {
      if (player.snapshots.length === 0) continue;

      // Agrupa snapshots por mercado + linha
      const groupKeyOdds = new Map<string, typeof player.snapshots>();
      for (const snap of player.snapshots) {
        const key = `${snap.market}:${snap.line}`;
        const list = groupKeyOdds.get(key) ?? [];
        list.push(snap);
        groupKeyOdds.set(key, list);
      }

      for (const [key, snaps] of Array.from(groupKeyOdds.entries())) {
        const [market, line] = key.split(':');

        // Pega a odd mais recente de cada casa neste mercado/linha
        const latestByHouse = new Map<string, typeof snaps[0]>();
        for (const s of snaps) {
          if (!latestByHouse.has(s.house)) {
            latestByHouse.set(s.house, s);
          }
        }

        const odds = Array.from(latestByHouse.values()).map(s => ({
          house: s.house,
          line: s.line,
          value: s.value,
          url: s.url ?? HOUSE_FALLBACK[s.house] ?? undefined,
        }));

        // Só faz sentido comparar se houver odds de pelo menos 2 casas de apostas
        if (odds.length >= 2) {
          const sorted = [...odds].sort((a, b) => b.value - a.value);
          const best = sorted[0];
          const secondBest = sorted[1];
          const diffPct = ((best.value - secondBest.value) / secondBest.value) * 100;

          // Filtra ruído: apenas desajustes de 5% ou mais
          if (diffPct >= 5) {
            opportunities.push({
              id: `${player.match.id}_${player.name}_${market}_${line}`,
              player: {
                id: player.id,
                name: player.name,
                displayName: player.displayName,
                team: player.team,
                isProbableStarter: isProbableStarter(player),
              },
              match: {
                id: player.match.id,
                homeTeam: player.match.homeTeam,
                awayTeam: player.match.awayTeam,
                homeFlag: player.match.homeFlag,
                awayFlag: player.match.awayFlag,
                dateTime: player.match.dateTime.toISOString(),
                stage: player.match.stage,
              },
              market,
              line,
              odds,
              bestOddHouse: best.house,
              bestOddValue: best.value,
              secondBestOddValue: secondBest.value,
              diffPct: parseFloat(diffPct.toFixed(1)),
            });
          }
        }
      }
    }

    // Ordena decrescentemente por margem de desajuste logo de cara
    opportunities.sort((a, b) => b.diffPct - a.diffPct);

    // CORTA O PAYLOAD: Envia os top 3000 maiores desajustes.
    // Garante que praticamente todo mundo que tem mercado aberto seja enviado.
    const topOpportunities = opportunities.slice(0, 3000);

    // Histórico por mercado de cada jogador na Copa (jogos finalizados, via
    // 365scores). Calculado por (jogador+mercado) distinto e cacheado.
    // Busca history apenas para os TOP 500 para não estourar a API do 365scores.
    await Promise.race([
      Promise.all(
        Array.from(
          new Map(
            topOpportunities.map((o) => [
              `${o.player.team}::${o.player.displayName}::${o.market}`,
              o,
            ]),
          ).values(),
        ).map(async (o) => {
          const key = hKey(o.player.team, o.player.displayName, o.market);
          if (SHARED_HISTORY_CACHE.has(key)) return;
          const h = await getPlayerHistory(o.player.displayName, o.player.team, o.market);
          if (h !== null) {
            SHARED_HISTORY_CACHE.set(key, h);
          }
        })
      ),
      new Promise<void>((resolve) => setTimeout(resolve, 120000))
    ]);
    for (const o of topOpportunities as any[]) {
      const key = hKey(o.player.team, o.player.displayName, o.market);
      const h = SHARED_HISTORY_CACHE.get(key);
      o.history = h ? { entries: h.entries, total: h.total, average: h.average } : null;
    }

    const body = { opportunities: topOpportunities, mock: false };
    voCache = { body, t: Date.now() };
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json(
      { error: 'Erro ao buscar odds desajustadas', detail: String(error) },
      { status: 500 }
    );
  }
}
