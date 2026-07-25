/**
 * Helpers de UX compartilhados pelos rankings:
 * - badge de liga (BR / MLS)
 * - favoritos (localStorage, mesmo schema da página /favorites)
 * - preferências de filtro persistidas
 * - “atualizado há Xs”
 */

'use client';

import { useCallback, useEffect, useState } from 'react';

// ─── Liga ────────────────────────────────────────────────────────────────────

export function competitionShort(key?: string | null): string {
  switch (key) {
    case 'brasileirao':
      return 'BR';
    case 'mls':
      return 'MLS';
    case 'copa':
      return 'Copa';
    case 'premier_league':
      return 'PL';
    case 'la_liga':
      return 'LL';
    default:
      return key ? key.slice(0, 3).toUpperCase() : '—';
  }
}

export function competitionBadgeClass(key?: string | null): string {
  switch (key) {
    case 'brasileirao':
      return 'bg-green-500/10 text-green-400 border-green-500/25';
    case 'mls':
      return 'bg-blue-500/10 text-blue-400 border-blue-500/25';
    case 'copa':
      return 'bg-amber-500/10 text-amber-400 border-amber-500/25';
    case 'premier_league':
      return 'bg-violet-500/10 text-violet-400 border-violet-500/25';
    case 'la_liga':
      return 'bg-orange-500/10 text-orange-400 border-orange-500/25';
    default:
      return 'bg-white/[0.04] text-muted-foreground/50 border-white/10';
  }
}

// ─── Atualizado há… ──────────────────────────────────────────────────────────

export function formatUpdatedAgo(
  isoOrMs: string | number | null | undefined,
  now = Date.now(),
): string {
  if (isoOrMs == null) return '—';
  const t = typeof isoOrMs === 'number' ? isoOrMs : Date.parse(String(isoOrMs));
  if (!Number.isFinite(t)) return '—';
  const sec = Math.max(0, Math.floor((now - t) / 1000));
  if (sec < 10) return 'agora';
  if (sec < 60) return `há ${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `há ${min}min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)}d`;
}

/** Relógio leve para re-render do “há Xs” sem spam. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

// ─── Favoritos (compatível com /favorites e /matches/[id]) ───────────────────

export function useMarketFavorites(market: string) {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(`favoritos_${market}`);
      setFavorites(raw ? (JSON.parse(raw) as string[]) : []);
    } catch {
      setFavorites([]);
    }
  }, [market]);

  const toggleFavorite = useCallback(
    (name: string) => {
      setFavorites((prev) => {
        const next = prev.includes(name)
          ? prev.filter((n) => n !== name)
          : [...prev, name];
        try {
          localStorage.setItem(`favoritos_${market}`, JSON.stringify(next));
        } catch {
          /* quota / private mode */
        }
        return next;
      });
    },
    [market],
  );

  const isFavorite = useCallback(
    (name: string) => favorites.includes(name),
    [favorites],
  );

  return { favorites, toggleFavorite, isFavorite };
}

// ─── Preferências de filtro (localStorage) ───────────────────────────────────

export type RankingFilterPrefs = {
  selectedLine: string;
  onlyStarters: boolean;
  minAvg: number;
  selectedCompetition: string;
  sortField: 'avg' | 'bestOdd' | 'name';
  sortDir: 'desc' | 'asc';
  maxGames: number;
  historyScope: 'league' | 'all';
};

const PREF_DEFAULTS: RankingFilterPrefs = {
  selectedLine: '1+',
  onlyStarters: false,
  minAvg: 0,
  selectedCompetition: 'all',
  sortField: 'avg',
  sortDir: 'desc',
  maxGames: 10,
  historyScope: 'league',
};

/**
 * Estado de filtros do ranking com persistência em localStorage.
 * `pageKey` deve ser estável por aba (ex: "desarmes", "finalizacao_chutes_ao_gol").
 */
export function useRankingFilters(
  pageKey: string,
  overrides: Partial<RankingFilterPrefs> = {},
) {
  const defaults: RankingFilterPrefs = { ...PREF_DEFAULTS, ...overrides };

  const [selectedLine, setSelectedLine] = useState(defaults.selectedLine);
  const [onlyStarters, setOnlyStarters] = useState(defaults.onlyStarters);
  const [minAvg, setMinAvg] = useState(defaults.minAvg);
  const [selectedCompetition, setSelectedCompetition] = useState(
    defaults.selectedCompetition,
  );
  const [sortField, setSortField] = useState<RankingFilterPrefs['sortField']>(
    defaults.sortField,
  );
  const [sortDir, setSortDir] = useState<RankingFilterPrefs['sortDir']>(
    defaults.sortDir,
  );
  const [maxGames, setMaxGames] = useState(defaults.maxGames);
  const [historyScope, setHistoryScope] = useState<
    RankingFilterPrefs['historyScope']
  >(defaults.historyScope);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(`rankingPrefs_${pageKey}`);
      if (raw) {
        const p = JSON.parse(raw) as Partial<RankingFilterPrefs>;
        if (typeof p.selectedLine === 'string') setSelectedLine(p.selectedLine);
        if (typeof p.onlyStarters === 'boolean') setOnlyStarters(p.onlyStarters);
        if (typeof p.minAvg === 'number' && Number.isFinite(p.minAvg))
          setMinAvg(p.minAvg);
        if (typeof p.selectedCompetition === 'string')
          setSelectedCompetition(p.selectedCompetition);
        if (p.sortField === 'avg' || p.sortField === 'bestOdd' || p.sortField === 'name')
          setSortField(p.sortField);
        if (p.sortDir === 'asc' || p.sortDir === 'desc') setSortDir(p.sortDir);
        if (typeof p.maxGames === 'number' && p.maxGames >= 1 && p.maxGames <= 10)
          setMaxGames(p.maxGames);
        if (p.historyScope === 'league' || p.historyScope === 'all')
          setHistoryScope(p.historyScope);
      }
    } catch {
      /* ignore */
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só re-hidrata ao mudar a chave
  }, [pageKey]);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    try {
      const payload: RankingFilterPrefs = {
        selectedLine,
        onlyStarters,
        minAvg,
        selectedCompetition,
        sortField,
        sortDir,
        maxGames,
        historyScope,
      };
      localStorage.setItem(`rankingPrefs_${pageKey}`, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [
    hydrated,
    pageKey,
    selectedLine,
    onlyStarters,
    minAvg,
    selectedCompetition,
    sortField,
    sortDir,
    maxGames,
    historyScope,
  ]);

  return {
    selectedLine,
    setSelectedLine,
    onlyStarters,
    setOnlyStarters,
    minAvg,
    setMinAvg,
    selectedCompetition,
    setSelectedCompetition,
    sortField,
    setSortField,
    sortDir,
    setSortDir,
    maxGames,
    setMaxGames,
    historyScope,
    setHistoryScope,
    hydrated,
  };
}
