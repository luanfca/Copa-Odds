/**
 * Detecção de "titular / regular" para o filtro "Titulares apenas".
 *
 * Prioridade:
 *  1. Quem MAIS JOGA (histórico SofaScore: nº de jogos + minutos)
 *  2. Cobertura de odds nas casas (só desempate / fallback sem histórico)
 *
 * Exclui reservas com 1 jogo e quem só aparece em mercado de odd.
 */

/** Quantos por time (XI). */
export const PROVAVEL_TITULAR_MAX = 11;

/** Mínimo de jogos no histórico para entrar como regular. */
export const MIN_HISTORY_GAMES = 3;

export interface StarterInput {
  playerId: string;
  matchId: string;
  team: string;
  houses: Iterable<string>;
  lines: Iterable<string>;
  snapshotCount: number;
}

export interface RegularStarterInput extends StarterInput {
  /** Aparições no histórico (últimos N jogos). 0 se ainda sem histórico. */
  historyGames: number;
  /** Média de minutos nessas aparições (null se desconhecido). */
  avgMinutes: number | null;
}

function coverageScore(input: StarterInput): number {
  const distinctHouses = new Set(input.houses).size;
  const distinctLines = new Set(input.lines).size;
  return distinctHouses * 1000 + distinctLines * 10 + input.snapshotCount;
}

/**
 * Score de "regularidade": jogos no histórico pesam muito mais que odds.
 * Ex.: 5 jogos × 90 min >> 1 jogo com odd em 4 casas.
 */
function regularScore(input: RegularStarterInput): number {
  const games = input.historyGames;
  const mins = input.avgMinutes != null && Number.isFinite(input.avgMinutes) ? input.avgMinutes : 0;
  // jogos * 100k + minutos médios * 100 + cobertura de odd
  return games * 100_000 + mins * 100 + coverageScore(input);
}

/**
 * Fallback antigo: TOP N por cobertura de odd (quando não há histórico).
 */
export function computeProbableStarterIds(
  players: ReadonlyArray<StarterInput>,
  maxPerTeam: number = PROVAVEL_TITULAR_MAX,
): Set<string> {
  const groups = new Map<string, Array<{ id: string; score: number }>>();

  for (const p of players) {
    const key = `${p.matchId}::${(p.team || '').trim().toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push({ id: p.playerId, score: coverageScore(p) });
    groups.set(key, arr);
  }

  const starters = new Set<string>();
  for (const arr of Array.from(groups.values())) {
    arr.sort((a, b) => b.score - a.score);
    for (const { id } of arr.slice(0, maxPerTeam)) {
      starters.add(id);
    }
  }
  return starters;
}

/**
 * Titulares / regulares de verdade:
 * - Exige pelo menos {@link MIN_HISTORY_GAMES} jogos no histórico (quando o time já tem dados)
 * - TOP {@link PROVAVEL_TITULAR_MAX} por (jogos + minutos + odds)
 * - Se o time ainda não tem histórico, cai no fallback por odds
 */
export function computeRegularStarterIds(
  players: ReadonlyArray<RegularStarterInput>,
  opts?: { maxPerTeam?: number; minGames?: number },
): Set<string> {
  const maxPerTeam = opts?.maxPerTeam ?? PROVAVEL_TITULAR_MAX;
  const minGames = opts?.minGames ?? MIN_HISTORY_GAMES;

  const groups = new Map<string, RegularStarterInput[]>();
  for (const p of players) {
    const key = `${p.matchId}::${(p.team || '').trim().toLowerCase()}`;
    const arr = groups.get(key) ?? [];
    arr.push(p);
    groups.set(key, arr);
  }

  const starters = new Set<string>();

  for (const arr of Array.from(groups.values())) {
    const maxHist = Math.max(0, ...arr.map((p) => p.historyGames));
    const hasHistoryData = maxHist > 0;

    let pool: RegularStarterInput[];
    if (hasHistoryData) {
      // Só quem tem volume mínimo de jogos (evita “1 jogo e sumiu”)
      // Se o time mal tem 3 jogos no hist de alguém, afrouxa para 2
      const effectiveMin = maxHist >= minGames ? minGames : Math.max(2, Math.min(minGames, maxHist));
      pool = arr.filter((p) => p.historyGames >= effectiveMin);
      // Se filtro ficou vazio (ex.: só tem 1 jogo cada), pega quem tem o máximo do time
      if (pool.length === 0) {
        pool = arr.filter((p) => p.historyGames === maxHist && p.historyGames >= 1);
      }
    } else {
      // Histórico ainda não carregou: fallback odds
      pool = arr;
    }

    pool.sort((a, b) => regularScore(b) - regularScore(a));
    for (const p of pool.slice(0, maxPerTeam)) {
      starters.add(p.playerId);
    }
  }

  return starters;
}

/** Recalcula isStarter nos players do ranking (após anexar histórico). */
export function applyRegularStarters(
  players: Array<{
    id: string;
    team: string;
    matchId: string;
    isStarter?: boolean;
    odds?: Array<{ house: string; line: string }>;
    history?: {
      entries?: Array<{ minutes?: number | null }>;
    } | null;
  }>,
): void {
  const inputs: RegularStarterInput[] = players.map((p) => {
    const entries = p.history?.entries ?? [];
    const mins = entries
      .map((e) => e.minutes)
      .filter((m): m is number => m != null && Number.isFinite(m) && m > 0);
    const avgMinutes = mins.length ? mins.reduce((s, m) => s + m, 0) / mins.length : null;
    return {
      playerId: p.id,
      matchId: p.matchId,
      team: p.team || '',
      houses: (p.odds ?? []).map((o) => o.house),
      lines: (p.odds ?? []).map((o) => o.line),
      snapshotCount: (p.odds ?? []).length,
      historyGames: entries.length,
      avgMinutes,
    };
  });

  const ids = computeRegularStarterIds(inputs);
  for (const p of players) {
    p.isStarter = ids.has(p.id);
  }
}
