/**
 * Histórico de jogadores: cache full (15 jogos) + job em background.
 *
 * - Não depende de request HTTP longo (trocar de aba não cancela o job).
 * - maxGames só fatia o full no momento de servir (5 ↔ 10 sem re-scrape).
 */

import {
  getPlayerHistory,
  historyDbKey,
  type PlayerHistory,
} from './sofascoreStats';
import { getSharedHistory, setSharedHistory } from './sharedCache';
import { computeLineAnalysis } from './poisson';

/** Máximo no banco / fetch (UI não pede mais que 10). */
export const HISTORY_FULL_GAMES = 10;

const LINES = ['1+', '2+', '3+', '4+'];

/** Mesma chave do banco (hist-v13) — histórico permanente. */
export function fullHistoryKey(
  team: string,
  name: string,
  market: string,
  allComps: boolean,
  year?: number,
  competition?: string,
  historyScope?: 'league' | 'all',
): string {
  return historyDbKey(name, team, market, allComps, {
    year,
    competition: competition && competition !== 'all' ? competition : undefined,
    historyScope: historyScope ?? (allComps ? 'all' : 'league'),
  });
}

export function sliceHistory(h: PlayerHistory, maxGames?: number): PlayerHistory {
  if (maxGames == null || maxGames <= 0 || h.entries.length <= maxGames) {
    return h;
  }
  const entries = h.entries.slice(-maxGames);
  const total = entries.reduce((s, e) => s + e.value, 0);
  return {
    market: h.market,
    entries,
    total,
    average: entries.length ? total / entries.length : 0,
  };
}

export function applyHistoryAnalysis(player: any, maxGames?: number): void {
  if (!player?.history?.entries?.length) return;
  player.history = sliceHistory(player.history, maxGames);
  const avg = player.history.average ?? 0;
  const bestByLine: Record<string, number> = {};
  for (const l of LINES) bestByLine[l] = player.bestByLine?.[l]?.value ?? 0;
  player.analysis = computeLineAnalysis(avg, LINES, bestByLine);
}

export interface HistoryPlayerRef {
  displayName: string;
  team: string;
  match?: { homeTeam?: string; awayTeam?: string; competition?: string };
  competition?: string;
}

export interface EnrichJobStatus {
  running: boolean;
  done: boolean;
  total: number;
  filled: number;
  missing: number;
  startedAt: number;
}

interface JobInternal extends EnrichJobStatus {
  promise: Promise<void>;
}

const jobs = new Map<string, JobInternal>();

export function enrichJobKey(
  market: string,
  allComps: boolean,
  competition?: string,
  year?: number,
  historyScope?: 'league' | 'all',
): string {
  const scope = historyScope ?? (allComps ? 'all' : 'league');
  return `${market}|${scope}|${competition || 'all'}|${year ?? 'cur'}`;
}

export function getEnrichJobStatus(jobKey: string): EnrichJobStatus | null {
  const j = jobs.get(jobKey);
  if (!j) return null;
  return {
    running: j.running,
    done: j.done,
    total: j.total,
    filled: j.filled,
    missing: j.missing,
    startedAt: j.startedAt,
  };
}

/** Sentinel: job já tentou e não há jogos do jogador (evita re-poll eterno). */
function emptyHistory(market: string): PlayerHistory {
  return { market, entries: [], total: 0, average: 0 };
}

function resolvePlayerComp(p: any, competition?: string): string | undefined {
  const c = competition || p?.match?.competition || p?.competition;
  if (!c || c === 'all') return undefined;
  return c;
}

/** Anexa histórico do SQLite e fatia para maxGames. */
export async function attachFullHistory(
  players: any[],
  market: string,
  allComps: boolean,
  maxGames?: number,
  year?: number,
  historyScope?: 'league' | 'all',
  competition?: string,
): Promise<{ filled: number; missing: number; resolved: number }> {
  let filled = 0;
  let missing = 0;
  let resolved = 0;
  if (!players?.length) return { filled, missing, resolved };

  const scope: 'league' | 'all' = historyScope ?? (allComps ? 'all' : 'league');
  const cap = maxGames && maxGames > 0 ? Math.min(maxGames, HISTORY_FULL_GAMES) : HISTORY_FULL_GAMES;

  await Promise.all(
    players.map(async (p) => {
      // Sempre tenta casa + visitante: scrapers (ex. BetMGM) às vezes marcam o visitante como home.
      const teamsToTry = [
        p.team,
        p.match?.homeTeam,
        p.match?.awayTeam,
      ].filter(Boolean) as string[];
      const seen = new Set<string>();
      const uniqueTeams = teamsToTry.filter((t) => {
        const k = t.toLowerCase().trim();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      if (p.history?.entries?.length) {
        applyHistoryAnalysis(p, cap);
        filled++;
        resolved++;
        return;
      }

      const playerComp = resolvePlayerComp(p, competition);
      let sawMiss = false;
      let best: { team: string; entries: any[]; total: number; average: number } | null = null;
      for (const tryTeam of uniqueTeams) {
        const key = fullHistoryKey(
          tryTeam,
          p.displayName,
          market,
          scope === 'all',
          year,
          playerComp,
          scope,
        );
        const cached = await getSharedHistory(key);
        if (!cached) continue;
        if (cached.entries?.length) {
          if (
            !best ||
            cached.entries.length > best.entries.length ||
            (cached.entries.length === best.entries.length && cached.average > best.average)
          ) {
            best = {
              team: tryTeam,
              entries: cached.entries,
              total: cached.total,
              average: cached.average,
            };
          }
          // Se o claimed team bateu, usa e para
          if (p.team && p.team.toLowerCase().trim() === tryTeam.toLowerCase().trim()) {
            break;
          }
        } else {
          sawMiss = true;
        }
      }
      if (best) {
        p.history = {
          entries: best.entries,
          total: best.total,
          average: best.average,
        };
        // Corrige time errado do scrape (ex.: Badwal em Cincinnati → Vancouver)
        p.team = best.team;
        applyHistoryAnalysis(p, cap);
        filled++;
        resolved++;
        return;
      }
      if (sawMiss) {
        p.history = null;
        resolved++;
        return;
      }
      missing++;
    }),
  );

  return { filled, missing, resolved };
}

async function fetchOnePlayerHistory(
  name: string,
  team: string,
  market: string,
  allComps: boolean,
  year?: number,
  competition?: string,
  historyScope?: 'league' | 'all',
): Promise<PlayerHistory | null> {
  const scope: 'league' | 'all' = historyScope ?? (allComps ? 'all' : 'league');
  const key = fullHistoryKey(team, name, market, scope === 'all', year, competition, scope);
  const h = await getPlayerHistory(name, team, market, scope === 'all', {
    maxGames: HISTORY_FULL_GAMES,
    year,
    competition: scope === 'league' ? competition || 'brasileirao' : competition,
    historyScope: scope,
  });
  if (h?.entries?.length) {
    await setSharedHistory(key, h);
    return h;
  }
  return null;
}

/**
 * Agenda (ou reaproveita) job em background. Não bloqueia o request HTTP.
 * Processa todos os jogadores únicos e grava no cache full.
 */
export function scheduleHistoryEnrich(
  jobKey: string,
  players: HistoryPlayerRef[],
  market: string,
  allComps: boolean,
  year?: number,
  competition?: string,
  historyScope?: 'league' | 'all',
): EnrichJobStatus {
  const existing = jobs.get(jobKey);
  // Reusa job em andamento; após terminar, re-roda no máx. 1x/hora
  // (team-events TTL ~3h — suficiente para pegar rodada nova do Palmeiras etc.)
  if (existing?.running) return getEnrichJobStatus(jobKey)!;
  if (existing?.done && Date.now() - existing.startedAt < 60 * 60_000) {
    return getEnrichJobStatus(jobKey)!;
  }

  const unique = new Map<string, HistoryPlayerRef>();
  for (const p of players) {
    if (!p?.displayName) continue;
    const team = p.team || '';
    const k = `${team}::${p.displayName}`;
    if (!unique.has(k)) unique.set(k, p);
  }

  const list = Array.from(unique.values());
  const state: JobInternal = {
    running: true,
    done: false,
    total: list.length,
    filled: 0,
    missing: list.length,
    startedAt: Date.now(),
    promise: Promise.resolve(),
  };

  const scope: 'league' | 'all' = historyScope ?? (allComps ? 'all' : 'league');

  state.promise = (async () => {
    const CONCURRENCY = 5;
    let filled = 0;
    let resolved = 0;
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const batch = list.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (p) => {
          // Sempre casa+visitante (+ claimed): corrige time errado do scrape
          const rawTeams = [p.team, p.match?.homeTeam, p.match?.awayTeam].filter(Boolean) as string[];
          const seenT = new Set<string>();
          const teamsToTry = rawTeams.filter((t) => {
            const k = t.toLowerCase().trim();
            if (seenT.has(k)) return false;
            seenT.add(k);
            return true;
          });

          // Liga do jogador: filtro da página OU competition do match (BR vs MLS)
          const playerComp =
            resolvePlayerComp(p, competition) ||
            (scope === 'league' ? 'brasileirao' : undefined);

          let ok = false;
          let usedTeam = teamsToTry[0] || '';
          for (const tryTeam of teamsToTry) {
            try {
              const h = await fetchOnePlayerHistory(
                p.displayName,
                tryTeam,
                market,
                scope === 'all',
                year,
                playerComp,
                scope,
              );
              if (h?.entries?.length) {
                ok = true;
                usedTeam = tryTeam;
                // Se claimed bateu, para; senão continua tentando o outro lado
                if (p.team && p.team.toLowerCase().trim() === tryTeam.toLowerCase().trim()) {
                  break;
                }
                // Achou no time "errado" do claimed — ainda assim tenta os demais
                // e, se nenhum claimed, usa o primeiro hit
                if (!p.team) break;
              }
            } catch {
              /* next team */
            }
          }
          if (!ok && usedTeam) {
            const missKey = fullHistoryKey(
              usedTeam,
              p.displayName,
              market,
              scope === 'all',
              year,
              playerComp,
              scope,
            );
            await setSharedHistory(missKey, emptyHistory(market)).catch(() => null);
          }
          resolved++;
          if (ok) filled++;
          state.filled = filled;
          state.missing = Math.max(0, state.total - resolved);
        }),
      );
    }
    state.running = false;
    state.done = true;
    state.filled = filled;
    state.missing = Math.max(0, state.total - resolved);
  })().catch((err) => {
    console.error('[historyEnrich] job failed:', String(err));
    state.running = false;
    state.done = true;
  });

  jobs.set(jobKey, state);
  return getEnrichJobStatus(jobKey)!;
}

/**
 * Cobertura completa: todos os jogadores já tentados (com dados ou miss resolvido).
 * Não para em 80% — o usuário quer ver TODOS.
 */
export function isHistoryCoverageOk(filled: number, total: number, resolved?: number): boolean {
  if (total <= 0) return true;
  const r = resolved ?? filled;
  return r >= total;
}
