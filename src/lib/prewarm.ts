/**
 * Pré-aquecimento do cache SofaScore.
 *
 * Ao iniciar o servidor, busca eventos finalizados de TODOS os times que têm
 * odds no banco de dados. Isso popula o cache SQLite (6h TTL) para que a
 * primeira requisição a /api/desarmes (ou faltas/finalizacao) seja instantânea.
 *
 * Também faz refresh periódico a cada 30 minutos para manter o cache fresco.
 */

import { prisma } from './prisma';
import { getTeamFinishedEvents } from './sofascoreStats';

const CONCURRENCY = 8; // 8 times em paralelo (não sobrecarrega o Python server)
let prewarmDone = false;
export interface PrewarmResult {
  teams: number;
  events: number;
}
let lastPrewarmResult: PrewarmResult = { teams: 0, events: 0 };

/**
 * Pré-aquecimento principal: busca eventos de todos os times do banco.
 * Popula o cache SQLite (getTeamFinishedEvents → setCacheTeamEvents).
 *
 * NOTA: `prewarmDone` é setado como `true` ANTES do loop de processamento
 * para evitar execuções concorrentes. Se o processo falhar no meio, o cache
 * fica parcialmente populado, mas as requisições reais completam o que faltar.
 */
export async function prewarmSofaScoreCache(force = false): Promise<PrewarmResult> {
  if (force) prewarmDone = false;
  if (prewarmDone) return lastPrewarmResult;
  prewarmDone = true; // trava reentrância imediatamente

  try {
    const startTime = Date.now();
    console.log(`[PREWARM] Iniciando pre-aquecimento do cache SofaScore...`);

    // Busca todos os times distintos das partidas que tem jogadores com odds
    const matches = await prisma.match.findMany({
      where: { players: { some: { snapshots: { some: {} } } } },
      select: { homeTeam: true, awayTeam: true },
    });

    const teams = new Set<string>();
    for (const m of matches) {
      if (m.homeTeam) teams.add(m.homeTeam);
      if (m.awayTeam) teams.add(m.awayTeam);
    }

    const teamList = Array.from(teams);
    if (teamList.length === 0) {
      console.log(`[PREWARM] Nenhum time encontrado (banco vazio?).`);
      lastPrewarmResult = { teams: 0, events: 0 };
      return lastPrewarmResult;
    }

    console.log(`[PREWARM] ${teamList.length} times para pre-aquecer (concorrencia=${CONCURRENCY})...`);

    // Processa em lotes com concorrencia controlada
    let cached = 0;
    for (let i = 0; i < teamList.length; i += CONCURRENCY) {
      const batch = teamList.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (team) => {
          // Sem filtro de torneio = busca TODOS os eventos do time,
          // populando o cache para TODAS as competicoes de uma vez
          const events = await getTeamFinishedEvents(team);
          return { team, count: events.length };
        }),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') {
          cached += r.value.count;
        }
      }

      // Progresso a cada 20 times
      if ((i + CONCURRENCY) % 20 === 0 || i + CONCURRENCY >= teamList.length) {
        const pct = Math.min(100, Math.round(((i + CONCURRENCY) / teamList.length) * 100));
        console.log(`[PREWARM] ${pct}% (${Math.min(i + CONCURRENCY, teamList.length)}/${teamList.length} times)`);
      }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[PREWARM] Completo! ${teamList.length} times, ${cached} eventos em ${elapsed}s.`);
    lastPrewarmResult = { teams: teamList.length, events: cached };
    return lastPrewarmResult;
  } catch (err) {
    console.error('[PREWARM] Erro no pre-aquecimento:', String(err));
    // Se falhou, permite re-tentar no proximo refresh
    prewarmDone = false;
    return { teams: 0, events: 0 };
  }
}

/**
 * Inicia refresh periodico do cache.
 * @param intervalMs Intervalo entre refreshes (default: 30 min)
 */
export function startPeriodicPrewarm(intervalMs = 30 * 60 * 1000): void {
  setInterval(() => {
    console.log('[PREWARM] Refresh periodico...');
    prewarmDone = false; // Permite reexecutar
    prewarmSofaScoreCache();
  }, intervalMs);
  console.log(`[PREWARM] Refresh periodico a cada ${intervalMs / 1000 / 60} min`);
}
