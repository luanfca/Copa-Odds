import { prisma } from './prisma';
import { getPlayerHistory } from './sofascoreStats';
import { getStartersForMatch } from './lineups365';
import { prewarmSofaScoreCache } from './prewarm';
import { rebuildApiSnapshots } from './apiSnapshot';

const HISTORY_MARKETS = [
  'desarmes',
  'faltas_cometidas',
  'faltas_sofridas',
  'finalizacao',
  'chutes_ao_gol',
] as const;

interface DailyDatasetResult {
  players: number;
  historiesFilled: number;
  historiesMissing: number;
  lineupsFound: number;
  matchesWithOdds: number;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    const key = clean.toLocaleLowerCase('pt-BR');
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

/**
 * Completa o lote diário antes de torná-lo visível:
 * odds já persistidas -> eventos SofaScore -> históricos -> escalações -> snapshots.
 */
export async function buildDailyDataset(
  scrapeStartedAt: Date,
): Promise<DailyDatasetResult> {
  const matchFrom = new Date(Date.now() - 5 * 60 * 60 * 1000);
  const matchTo = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const players = await prisma.player.findMany({
    where: {
      match: { dateTime: { gte: matchFrom, lte: matchTo } },
      snapshots: { some: { collectedAt: { gte: scrapeStartedAt } } },
    },
    include: { match: true },
    orderBy: { displayName: 'asc' },
  });

  const matches = new Map<
    string,
    { homeTeam: string; awayTeam: string; dateTime: Date }
  >();
  for (const player of players) {
    if (!matches.has(player.matchId)) {
      matches.set(player.matchId, {
        homeTeam: player.match.homeTeam,
        awayTeam: player.match.awayTeam,
        dateTime: player.match.dateTime,
      });
    }
  }

  console.log(
    `[DailyDataset] Iniciando: ${players.length} jogadores, ${matches.size} jogos`,
  );

  // Valida a fonte oficial antes de substituir qualquer snapshot. O prewarm
  // resolve os times no SofaScore e mantém os eventos compartilhados no banco.
  const prewarm = await prewarmSofaScoreCache(true);
  if (players.length > 0 && prewarm.events === 0) {
    throw new Error(
      'SofaScore não retornou jogos finalizados; lote anterior mantido para evitar publicar históricos vazios.',
    );
  }

  let lineupsFound = 0;
  const matchList = Array.from(matches.values());
  const LINEUP_CONCURRENCY = 4;
  for (let i = 0; i < matchList.length; i += LINEUP_CONCURRENCY) {
    const batch = matchList.slice(i, i + LINEUP_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((match) =>
        getStartersForMatch(
          match.homeTeam,
          match.awayTeam,
          match.dateTime,
        ),
      ),
    );
    for (const result of results) {
      if (
        result.status === 'fulfilled' &&
        result.value &&
        result.value.count > 0
      ) {
        lineupsFound++;
      }
    }
  }

  let historiesFilled = 0;
  let historiesMissing = 0;
  const HISTORY_CONCURRENCY = Math.max(
    1,
    Math.min(
      8,
      Number.parseInt(process.env.DAILY_HISTORY_CONCURRENCY || '5', 10) || 5,
    ),
  );

  for (let i = 0; i < players.length; i += HISTORY_CONCURRENCY) {
    const batch = players.slice(i, i + HISTORY_CONCURRENCY);
    await Promise.all(
      batch.map(async (player) => {
        const teams = uniqueStrings([
          player.team,
          player.match.homeTeam,
          player.match.awayTeam,
        ]);
        const competition =
          player.match.competition && player.match.competition !== 'all'
            ? player.match.competition
            : 'brasileirao';

        for (const market of HISTORY_MARKETS) {
          // Preenche os dois filtros usados pela interface. Os payloads dos
          // jogos são compartilhados no cache; não há nova chamada por mercado.
          for (const historyScope of ['league', 'all'] as const) {
            let found = false;
            for (const team of teams) {
              const history = await getPlayerHistory(
                player.displayName || player.name,
                team,
                market,
                historyScope === 'all',
                {
                  maxGames: 10,
                  competition,
                  historyScope,
                },
              ).catch(() => null);
              if (history?.entries?.length) {
                historiesFilled++;
                found = true;
                break;
              }
            }
            if (!found) historiesMissing++;
          }
        }
      }),
    );

    if (
      i === 0 ||
      i + HISTORY_CONCURRENCY >= players.length ||
      (i + HISTORY_CONCURRENCY) % 100 === 0
    ) {
      console.log(
        `[DailyDataset] Histórico: ${Math.min(
          i + HISTORY_CONCURRENCY,
          players.length,
        )}/${players.length} jogadores`,
      );
    }
  }

  // Só agora monta todas as respostas finais. A gravação em apiSnapshot é
  // transacional: leitores veem o lote anterior ou o novo, nunca meio lote.
  await rebuildApiSnapshots({ includeHistory: true, atomic: true });

  // Remove apenas entidades sem odds depois que o novo lote já está publicado.
  await prisma.player.deleteMany({
    where: { snapshots: { none: {} } },
  });
  await prisma.match.deleteMany({
    where: { players: { none: {} } },
  });

  const result = {
    players: players.length,
    historiesFilled,
    historiesMissing,
    lineupsFound,
    matchesWithOdds: matches.size,
  };
  console.log(`[DailyDataset] Concluído: ${JSON.stringify(result)}`);
  return result;
}
