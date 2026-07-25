import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { mockOddsData, mockMatches } from '@/lib/mockData';
import { isSamePlayer } from '@/lib/normalize';
import { computeProbableStarterIds } from '@/lib/starters';
import { getStartersForMatch, type MatchStarters } from '@/lib/lineups365';
import { getPlayerHistory } from '@/lib/sofascoreStats';

import { voCache, voRevalidating, setVoCache, setVoRevalidating, VO_TTL, VO_STALE_TTL } from '@/lib/cacheInvalidation';
import { broadcastScrapeError } from '@/lib/ws-server';

export const dynamic = 'force-dynamic';

type HistoryScope = 'league' | 'all';

function normKeyPart(s: string): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Chave estável jogador+mercado (time normalizado separado na busca). */
function playerMarketKey(name: string, market: string): string {
  return `${normKeyPart(name)}::${market || 'desarmes'}`;
}

function teamNamesLooseMatch(a?: string | null, b?: string | null): boolean {
  const na = normKeyPart(a || '');
  const nb = normKeyPart(b || '');
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * Ordem de times a tentar no SofaScore:
 * 1) casa e visitante (sempre — corrige scrapers que marcam visitante como home)
 * 2) team do scrap se for diferente (alias)
 * Preferência: lado que devolver histórico; se ambos, o que bate com player.team.
 */
function candidateTeams(o: any): string[] {
  const home = String(o.match?.homeTeam || '').trim();
  const away = String(o.match?.awayTeam || '').trim();
  const claimed = String(o.player?.team || '').trim();
  const out: string[] = [];
  const push = (t: string) => {
    if (!t) return;
    if (!out.some((x) => teamNamesLooseMatch(x, t))) out.push(t);
  };
  // Lado declarado primeiro se for casa ou visitante
  if (claimed && (teamNamesLooseMatch(claimed, home) || teamNamesLooseMatch(claimed, away))) {
    push(claimed);
  }
  push(home);
  push(away);
  if (claimed) push(claimed);
  return out;
}

/**
 * Anexa histórico SofaScore (SQLite permanente) em TODAS as oportunidades.
 * Resolve o time real (casa/visitante) e corrige o.player.team quando o scrape errou.
 */
async function attachValueOddsHistory(
  opportunities: any[],
  opts: { maxGames: number; year?: number; historyScope: HistoryScope },
): Promise<{ unique: number; filled: number }> {
  if (!opportunities?.length) return { unique: 0, filled: 0 };
  const maxGames = Math.min(Math.max(opts.maxGames || 5, 1), 10);
  const preferAll = opts.historyScope === 'all';

  type U = {
    name: string;
    teams: string[];
    market: string;
    competition?: string;
    claimedTeam?: string;
  };

  // Únicos por NOME+MERCADO (várias linhas / times alias)
  const unique = new Map<string, U>();
  for (const o of opportunities) {
    const name = o.player?.displayName || o.player?.name;
    if (!name) continue;
    const market = o.market || 'desarmes';
    const key = playerMarketKey(name, market);
    const teams = candidateTeams(o);
    const existing = unique.get(key);
    if (!existing) {
      unique.set(key, {
        name,
        teams,
        market,
        competition: o.match?.competition,
        claimedTeam: o.player?.team || '',
      });
    } else {
      for (const t of teams) {
        if (!existing.teams.some((x) => teamNamesLooseMatch(x, t))) existing.teams.push(t);
      }
      if (!existing.competition && o.match?.competition) {
        existing.competition = o.match.competition;
      }
    }
  }

  type HistPack = {
    entries: any[];
    total: number;
    average: number;
    resolvedTeam: string;
  };
  const histByKey = new Map<string, HistPack>();
  const list = Array.from(unique.entries());
  // Cache quente no SQLite → concorrência alta; cold ainda ok com 10
  const CONCURRENCY = 12;

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    const batch = list.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ([key, u]) => {
        try {
          const scopes: HistoryScope[] = preferAll ? ['all'] : ['league', 'all'];
          // Coleta hits por time; se 2 lados tiverem hist (raro), prefere claimed
          const hits: HistPack[] = [];
          for (const sc of scopes) {
            if (hits.length) break;
            for (const tryTeam of u.teams) {
              const h = await getPlayerHistory(u.name, tryTeam, u.market, sc === 'all', {
                maxGames,
                year: opts.year,
                competition:
                  sc === 'league'
                    ? u.competition && u.competition !== 'all'
                      ? u.competition
                      : 'brasileirao'
                    : undefined,
                historyScope: sc,
              });
              if (h?.entries?.length) {
                hits.push({
                  entries: h.entries,
                  total: h.total,
                  average: h.average,
                  resolvedTeam: tryTeam,
                });
                // Claimed bateu → suficiente; senão tenta o outro lado também
                if (u.claimedTeam && teamNamesLooseMatch(u.claimedTeam, tryTeam)) break;
              }
            }
          }
          if (!hits.length) return;
          let best = hits[0];
          if (hits.length > 1 && u.claimedTeam) {
            const preferred = hits.find((h) => teamNamesLooseMatch(h.resolvedTeam, u.claimedTeam));
            if (preferred) best = preferred;
            else {
              // Sem claimed válido: escolhe o com mais entradas / maior média
              best = hits.reduce((a, b) =>
                b.entries.length > a.entries.length ||
                (b.entries.length === a.entries.length && b.average > a.average)
                  ? b
                  : a,
              );
            }
          } else if (hits.length > 1) {
            best = hits.reduce((a, b) =>
              b.entries.length > a.entries.length ||
              (b.entries.length === a.entries.length && b.average > a.average)
                ? b
                : a,
            );
          }
          histByKey.set(key, best);
        } catch {
          /* best-effort */
        }
      }),
    );
  }

  let filled = 0;
  for (const o of opportunities) {
    const name = o.player?.displayName || o.player?.name;
    if (!name) {
      o.history = o.history ?? null;
      continue;
    }
    // Garante market string (UI de desajustes)
    if (!o.market) o.market = 'desarmes';
    const key = playerMarketKey(name, o.market);
    const h = histByKey.get(key);
    if (h) {
      o.history = {
        entries: h.entries,
        total: h.total,
        average: h.average,
      };
      // Corrige time errado do scrape (ex.: Badwal → Vancouver, não Cincinnati)
      if (h.resolvedTeam) {
        const home = o.match?.homeTeam;
        const away = o.match?.awayTeam;
        const claimed = o.player?.team;
        const claimedOk =
          claimed &&
          (teamNamesLooseMatch(claimed, home) || teamNamesLooseMatch(claimed, away)) &&
          teamNamesLooseMatch(claimed, h.resolvedTeam);
        if (!claimedOk) {
          o.player = { ...o.player, team: h.resolvedTeam };
        } else if (!claimed) {
          o.player = { ...o.player, team: h.resolvedTeam };
        }
      }
      filled++;
    } else {
      o.history = o.history ?? null;
      // Sem histórico: se team não é casa nem visitante, limpa (evita lixo na UI)
      const claimed = o.player?.team;
      const home = o.match?.homeTeam;
      const away = o.match?.awayTeam;
      if (
        claimed &&
        home &&
        away &&
        !teamNamesLooseMatch(claimed, home) &&
        !teamNamesLooseMatch(claimed, away)
      ) {
        o.player = { ...o.player, team: '' };
      }
    }
  }

  return { unique: unique.size, filled };
}

// Executa o recálculo completo e atualiza voCache em background
async function revalidateCache(opts?: {
  maxGames?: number;
  year?: number;
  historyScope?: HistoryScope;
}) {
  if (voRevalidating) return;
  setVoRevalidating(true);
  try {
    await buildResponse(opts);
  } finally {
    setVoRevalidating(false);
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.has('refresh') || url.searchParams.has('bust');
  const maxGamesRaw = url.searchParams.has('maxGames')
    ? parseInt(url.searchParams.get('maxGames')!)
    : 5;
  const maxGames = Number.isFinite(maxGamesRaw)
    ? Math.min(Math.max(maxGamesRaw || 5, 1), 10)
    : 5;
  const year = url.searchParams.has('year')
    ? parseInt(url.searchParams.get('year')!)
    : undefined;
  const historyScope: HistoryScope =
    url.searchParams.get('historyScope') === 'all' ? 'all' : 'league';
  const age = voCache ? Date.now() - voCache.t : Infinity;

  // 1) Snapshot / light + histórico SofaScore (SQLite) — não devolver sem history
  if (!forceRefresh) {
    try {
      const {
        getApiSnapshotWithAge,
        setApiSnapshot,
        buildLightValueOdds,
        SNAPSHOT_MAX_AGE_MS,
      } = await import('@/lib/apiSnapshot');

      let base: any = null;
      let cacheTag = 'SNAPSHOT';
      const snapMeta = await getApiSnapshotWithAge('value-odds');
      if (snapMeta && snapMeta.ageMs < SNAPSHOT_MAX_AGE_MS) {
        base = snapMeta.data;
      } else if (voCache && age < 45_000) {
        base = voCache.body;
        cacheTag = 'MEMORY';
      } else {
        base = await buildLightValueOdds();
        await setApiSnapshot('value-odds', 'value-odds', base);
        cacheTag = 'BUILT-LIGHT';
      }

      if (base?.opportunities) {
        // Copia rasa para não mutar snapshot em disco sem querer
        const body = {
          ...base,
          opportunities: (base.opportunities as any[]).map((o) => ({ ...o })),
        };
        await attachValueOddsHistory(body.opportunities, {
          maxGames,
          year,
          historyScope,
        });
        setVoCache(body, Date.now());
        return NextResponse.json(body, {
          headers: {
            'X-Cache': `${cacheTag}+HIST`,
            'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=60',
          },
        });
      }
    } catch {
      // cai no path completo
    }
  }

  // Memória: re-anexa hist com os params pedidos (maxGames/scope) — não reusa cego
  const memBody = voCache?.body as { opportunities?: any[] } | undefined;
  if (!forceRefresh && voCache && age < VO_TTL && Array.isArray(memBody?.opportunities)) {
    const body = {
      ...memBody,
      opportunities: memBody.opportunities.map((o) => ({ ...o })),
    };
    await attachValueOddsHistory(body.opportunities, { maxGames, year, historyScope });
    return NextResponse.json(body, { headers: { 'X-Cache': 'MEMORY+HIST' } });
  }
  if (!forceRefresh && voCache && age < VO_STALE_TTL) {
    revalidateCache({ maxGames, year, historyScope });
    if (Array.isArray(memBody?.opportunities)) {
      const body = {
        ...memBody,
        opportunities: memBody.opportunities.map((o) => ({ ...o })),
      };
      await attachValueOddsHistory(body.opportunities, { maxGames, year, historyScope });
      return NextResponse.json(body, { headers: { 'X-Cache': 'STALE+HIST' } });
    }
    return NextResponse.json(voCache.body);
  }
  return buildResponse({ maxGames, year, historyScope });
}

async function buildResponse(opts?: {
  maxGames?: number;
  year?: number;
  historyScope?: HistoryScope;
}): Promise<NextResponse> {
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
    // Janela fixa de 48h: mostra odds de todos os scrapes recentes,
    // independente de qual scrape as coletou.
    // ANTES usava o startedAt do último scrape, o que fazia odds de
    // scrapes anteriores sumirem quando um novo scrape rodava.
    const timeThreshold = new Date(Date.now() - 48 * 60 * 60 * 1000);

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
      bet365:   'https://www.bet365.bet.br',
      betsson:  'https://www.betsson.bet.br',
      pitaco:   'https://pitaco.bet.br',
    };

    // 3. Processa cada jogador e calcula as diferenças
    for (const player of players) {
      if (player.snapshots.length === 0) continue;

      // Agrupa snapshots por mercado + linha
      const groupKeyOdds = new Map<string, typeof player.snapshots[number][]>();
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
                competition: player.match.competition,
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

    // DEDUP: mescla só o MESMO jogador (fuzzy) no mesmo match+mercado+linha.
    // A chave inclui identidade do jogador — antes era só match|line|market e
    // sobrescrevia jogadores diferentes (ficava 1 por jogo/linha/mercado).
    const dedupList: typeof opportunities = [];
    for (const o of opportunities) {
      let found = false;
      for (const existing of dedupList) {
        const sameMatch = existing.match.id === o.match.id;
        const sameLine = existing.line === o.line;
        const sameMarket = existing.market === o.market;
        const sameTeam =
          !existing.player.team || !o.player.team || existing.player.team === o.player.team;
        if (
          sameMatch &&
          sameLine &&
          sameMarket &&
          sameTeam &&
          isSamePlayer(existing.player.displayName, o.player.displayName)
        ) {
          for (const odd of o.odds) {
            const existingOdd = existing.odds.find(
              (eo) => eo.house === odd.house && eo.line === odd.line,
            );
            if (!existingOdd) {
              existing.odds.push(odd);
            } else if (odd.value > existingOdd.value) {
              existingOdd.value = odd.value;
              if (odd.url) existingOdd.url = odd.url;
            }
          }
          const sorted = [...existing.odds].sort((a, b) => b.value - a.value);
          existing.bestOddValue = sorted[0].value;
          existing.bestOddHouse = sorted[0].house;
          existing.secondBestOddValue = sorted[1]?.value ?? sorted[0].value;
          existing.diffPct = parseFloat(
            (
              ((sorted[0].value - (sorted[1]?.value ?? sorted[0].value)) /
                (sorted[1]?.value ?? sorted[0].value)) *
              100
            ).toFixed(1),
          );
          if (o.player.displayName.length > existing.player.displayName.length) {
            existing.player.displayName = o.player.displayName;
          }
          found = true;
          break;
        }
      }
      if (!found) dedupList.push(o);
    }
    const dedupedOpportunities = dedupList;

    // Ordena decrescentemente por margem de desajuste logo de cara
    dedupedOpportunities.sort((a, b) => b.diffPct - a.diffPct);

    // Usa array deduplicado
    opportunities.length = 0;
    opportunities.push(...dedupedOpportunities);

    // CORTA O PAYLOAD: Envia os top 3000 maiores desajustes.
    // Garante que praticamente todo mundo que tem mercado aberto seja enviado.
    const topOpportunities = opportunities.slice(0, 3000);

    // Histórico SofaScore (SQLite permanente) — fatia maxGames na resposta
    await attachValueOddsHistory(topOpportunities as any[], {
      maxGames: opts?.maxGames ?? 5,
      year: opts?.year,
      historyScope: opts?.historyScope ?? 'league',
    });

    const body = { opportunities: topOpportunities, mock: false };
    setVoCache(body, Date.now());

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (error) {
    broadcastScrapeError(String(error))
    return NextResponse.json(
      { error: 'Erro ao buscar odds desajustadas', detail: String(error) },
      { status: 500 }
    );
  }
}
