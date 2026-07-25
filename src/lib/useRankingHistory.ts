/**
 * Carga de ranking com histórico progressivo (poll curto).
 *
 * - Odds na hora
 * - Job de histórico no servidor (não cancela ao mudar de aba)
 * - Poll a cada 2.5s até cobrir bem os jogadores
 * - maxGames fatia o full cacheado (5↔10 sem re-scrape pesado)
 */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getCachedMarket, setCachedMarket } from '@/lib/marketCache';
import { applyRegularStarters } from '@/lib/starters';
// Nota: escalação prevista é aplicada no servidor (prepareBodyWithHistory).
// No client só reforçamos regulares se o snapshot vier sem isStarter útil.

export interface HistoryMeta {
  filled: number;
  missing: number;
  resolved?: number;
  total: number;
  coverageOk: boolean;
  job?: {
    running: boolean;
    done: boolean;
    total: number;
    filled: number;
    missing: number;
  } | null;
}

interface RankingLoadOpts {
  market: string;
  cacheKey: string;
  allComps: boolean;
  /** Aguarda a hidratação dos filtros persistidos para não buscar duas vezes. */
  enabled?: boolean;
  maxGames?: number;
  year?: number;
  competition?: string;
  /** league = só BR/MLS | all = todos (Liberta etc.) */
  historyScope?: 'league' | 'all';
  requireMarketMatch?: boolean;
  sanitize?: (players: any[]) => any[];
}

export function useRankingLoad(opts: RankingLoadOpts) {
  const {
    market,
    cacheKey,
    allComps,
    enabled = true,
    maxGames,
    year,
    competition,
    historyScope = 'league',
    requireMarketMatch,
    sanitize,
  } = opts;

  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyMeta, setHistoryMeta] = useState<HistoryMeta | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** ISO do servidor (builtAt) quando houver. */
  const [builtAt, setBuiltAt] = useState<string | null>(null);
  /** Timestamp local da última resposta aplicada (para “há Xs”). */
  const [dataUpdatedAt, setDataUpdatedAt] = useState<number | null>(null);

  const genRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sanitizeRef = useRef(sanitize);
  sanitizeRef.current = sanitize;

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setHistoryLoading(false);
  }, []);

  const applyData = useCallback(
    (data: any) => {
      if (requireMarketMatch && data.market && data.market !== market) {
        throw new Error(`Mercado inconsistente: esperado ${market}, veio ${data.market}`);
      }
      let list = data.players ?? [];
      if (sanitizeRef.current) list = sanitizeRef.current(list);
      // Servidor já marca isStarter via escalação prevista.
      // Se ninguém veio como titular (snapshot antigo), fallback a regulares.
      if (Array.isArray(list) && list.length && !list.some((p: any) => p.isStarter)) {
        applyRegularStarters(list);
      }
      setPlayers(list);
      if (data.historyMeta) setHistoryMeta(data.historyMeta as HistoryMeta);
      if (typeof data.builtAt === 'string' && data.builtAt) {
        setBuiltAt(data.builtAt);
      }
      setDataUpdatedAt(Date.now());
      return { ...data, players: list };
    },
    [market, requireMarketMatch],
  );

  const fetchOnce = useCallback(
    async (forceRefresh = false) => {
      const params = new URLSearchParams({ market });
      if (allComps) params.set('allComps', 'true');
      if (competition && competition !== 'all') params.set('competition', competition);
      if (maxGames != null) params.set('maxGames', String(Math.min(maxGames || 10, 10)));
      if (year != null) params.set('year', String(year));
      params.set('historyScope', historyScope);
      if (forceRefresh) params.set('refresh', '1');
      // Sinaliza job de histórico; a API responde na hora (não bloqueia 180s)
      params.set('enrich', '1');
      const res = await fetch(`/api/desarmes?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      return applyData(await res.json());
    },
    [market, allComps, competition, maxGames, year, historyScope, applyData],
  );

  /** Continua até processar TODOS (job.done / coverageOk), não para em 80%. */
  const needsMoreHistory = (data: any): boolean => {
    const meta = data?.historyMeta as HistoryMeta | undefined;
    if (!meta) {
      const list = data?.players ?? [];
      if (list.length === 0) return false;
      return list.some((p: any) => !p?.history?.entries?.length);
    }
    if (meta.coverageOk || meta.job?.done) return false;
    if (meta.job?.running) return true;
    return (meta.missing ?? 0) > 0;
  };

  const startPolling = useCallback(
    (gen: number) => {
      stopPoll();
      setHistoryLoading(true);
      let ticks = 0;
      const MAX_TICKS = 120; // ~5 min — cobre ranking grande (todos os jogadores)

      const tick = async () => {
        if (gen !== genRef.current) return;
        ticks++;
        try {
          const data = await fetchOnce(false);
          if (gen !== genRef.current) return;
          setCachedMarket(cacheKey, data, allComps, { maxGames, year, historyScope });
          if (!needsMoreHistory(data) || ticks >= MAX_TICKS) {
            stopPoll();
          }
        } catch {
          if (ticks >= MAX_TICKS) stopPoll();
        }
      };

      void tick();
      pollRef.current = setInterval(() => void tick(), 2500);
    },
    [stopPoll, fetchOnce, cacheKey, allComps, maxGames, year, historyScope],
  );

  const load = useCallback(
    async (forceRefresh = false) => {
      const gen = ++genRef.current;
      stopPoll();

      if (!forceRefresh) {
        const cached = getCachedMarket(cacheKey, allComps, { maxGames, year, historyScope }) as any;
        if (cached && (!requireMarketMatch || cached.market === market)) {
          applyData(cached);
          setLoading(false);
          if (needsMoreHistory(cached)) startPolling(gen);
          return;
        }
      }

      setLoading(true);
      setError(null);
      try {
        const data = await fetchOnce(forceRefresh);
        if (gen !== genRef.current) return;
        setCachedMarket(cacheKey, data, allComps, { maxGames, year, historyScope });
        setLoading(false);
        if (needsMoreHistory(data) || forceRefresh) startPolling(gen);
      } catch (err) {
        if (gen !== genRef.current) return;
        setError(String(err));
        setLoading(false);
      }
    },
    [
      stopPoll,
      cacheKey,
      allComps,
      maxGames,
      year,
      historyScope,
      market,
      requireMarketMatch,
      applyData,
      fetchOnce,
      startPolling,
    ],
  );

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => {
      genRef.current++;
      stopPoll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, market, allComps, maxGames, year, competition, historyScope, cacheKey]);

  // Ao voltar para a aba, puxa progresso do job sem reiniciar tudo
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (!historyLoading) return;
      void fetchOnce(false)
        .then((data) => {
          setCachedMarket(cacheKey, data, allComps, { maxGames, year, historyScope });
          if (!needsMoreHistory(data)) stopPoll();
        })
        .catch(() => null);
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [historyLoading, fetchOnce, cacheKey, allComps, maxGames, year, stopPoll]);

  return {
    players,
    setPlayers,
    loading,
    error,
    historyMeta,
    historyLoading,
    builtAt,
    dataUpdatedAt,
    load,
  };
}
