'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Heart, RefreshCw, Search, Trophy, ChevronDown, ChevronUp,
  Minus, Activity, ArrowRight, Star, Users, BarChart3, Zap, Filter,
} from 'lucide-react';
import { cn, formatOdd, HOUSE_LABELS, HOUSE_COLORS, ALL_HOUSES } from '@/lib/utils';
import { Flag } from '@/components/Flag';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { SofaScoreStats } from '@/components/SofaScoreStats';
import { MatchGameFilter } from '@/components/MatchGameFilter';
import {
  buildUniqueMatches,
  filterMatchesByTeam,
  matchIncludesTeam,
  normSearch,
} from '@/lib/matchFilter';
import { invalidateMarket } from '@/lib/marketCache';
import { useRankingLoad } from '@/lib/useRankingHistory';
import type { OddEntry } from '@/lib/arbitrage';
import {
  competitionBadgeClass,
  competitionShort,
  formatUpdatedAgo,
  useMarketFavorites,
  useNow,
  useRankingFilters,
} from '@/lib/rankingUi';

interface HistoryStat {
  entries: { date: string; opponent: string; value: number; minutes: number | null }[];
  total: number;
  average: number;
}

interface LineAnalysis {
  line: string;
  probability: number;
  fairOdds: number;
  bestOdd: number;
  ev: number;
  hasValue: boolean;
}

interface PlayerResult {
  id: string;
  displayName: string;
  team: string;
  matchId: string;
  match: { id: string; homeTeam: string; awayTeam: string; homeFlag: string | null; awayFlag: string | null; dateTime: string; stage: string; competition?: string };
  isStarter: boolean;
  odds: OddEntry[];
  bestByLine: Record<string, OddEntry>;
  history: HistoryStat | null;
  analysis: LineAnalysis[];
}

interface ApiResponse {
  players: PlayerResult[];
  market: string;
  mock: boolean;
}

const LINES = ['1+', '2+', '3+', '4+'];
const LINE_COLORS: Record<string, string> = {
  '1+': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  '2+': 'text-sky-400 bg-sky-500/10 border-sky-500/25',
  '3+': 'text-indigo-400 bg-indigo-500/10 border-indigo-500/25',
  '4+': 'text-amber-400 bg-amber-500/10 border-amber-500/25',
};

const HOUSES = ALL_HOUSES;

export default function FaltasSofridasPage() {
  const [search, setSearch] = useState('');
  const [selectedMatch, setSelectedMatch] = useState<string>('Todos');
  const [teamQuery, setTeamQuery] = useState('');
  const [allComps, setAllComps] = useState(false);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const {
    selectedLine, setSelectedLine,
    onlyStarters, setOnlyStarters,
    minAvg, setMinAvg,
    sortField, setSortField,
    sortDir, setSortDir,
    maxGames, setMaxGames,
    historyScope, setHistoryScope,
  } = useRankingFilters('faltas_sofridas', { selectedLine: '2+' });
  const { toggleFavorite, isFavorite } = useMarketFavorites('faltas_sofridas');
  const now = useNow();

  const PAGE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { players, loading, error, historyMeta, historyLoading, builtAt, dataUpdatedAt, load } = useRankingLoad({
    market: 'faltas_sofridas',
    cacheKey: `faltas_sofridas_${historyScope}`,
    allComps,
    maxGames,
    year,
    historyScope,
  });
  const updatedLabel = formatUpdatedAgo(builtAt ?? dataUpdatedAt, now);

  const uniqueMatches = useMemo(
    () => buildUniqueMatches(players as PlayerResult[]),
    [players],
  );

  const filtered = useMemo(() => {
    let list = players as PlayerResult[];

    if (selectedMatch !== 'Todos') {
      list = list.filter((p) => p.matchId === selectedMatch);
    } else if (teamQuery.trim()) {
      const allowed = new Set(
        filterMatchesByTeam(uniqueMatches, teamQuery).map((m) => m.id),
      );
      list = list.filter((p) => allowed.has(p.matchId));
    }

    if (onlyStarters) {
      list = list.filter((p) => p.isStarter);
    }

    if (minAvg > 0) {
      list = list.filter((p) => (p.history?.average ?? 0) >= minAvg);
    }

    if (search.trim()) {
      const q = normSearch(search);
      list = list.filter((p) => {
        if (normSearch(p.displayName).includes(q)) return true;
        if (normSearch(p.team).includes(q)) return true;
        return matchIncludesTeam(p.match.homeTeam, p.match.awayTeam, search);
      });
    }

    list = list.filter((p) => {
      const hasLine = p.odds.some((o) => o.line === selectedLine);
      return hasLine;
    });

    return [...list].sort((a, b) => {
      // 1º: critério escolhido (média / odd / nome) — junta BR + MLS
      // 2º: horário do jogo só como desempate
      let valA: number | string;
      let valB: number | string;

      if (sortField === 'avg') {
        valA = a.history?.average ?? 0;
        valB = b.history?.average ?? 0;
      } else if (sortField === 'bestOdd') {
        const bestA = a.bestByLine[selectedLine]?.value ?? 0;
        const bestB = b.bestByLine[selectedLine]?.value ?? 0;
        valA = bestA;
        valB = bestB;
      } else {
        valA = a.displayName.toLowerCase();
        valB = b.displayName.toLowerCase();
      }

      if (valA < valB) return sortDir === 'asc' ? -1 : 1;
      if (valA > valB) return sortDir === 'asc' ? 1 : -1;

      const tA = Date.parse(a.match?.dateTime || '') || 0;
      const tB = Date.parse(b.match?.dateTime || '') || 0;
      return tA - tB;
    });
  }, [players, search, selectedLine, onlyStarters, sortField, sortDir, selectedMatch, minAvg, teamQuery, uniqueMatches]);

  useEffect(() => { setVisibleCount(PAGE); }, [search, selectedLine, onlyStarters, sortField, sortDir, selectedMatch, minAvg, teamQuery]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisibleCount((c) => c + PAGE); },
      { rootMargin: '800px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length, visibleCount]);

  const stats = useMemo(() => {
    if (filtered.length === 0) return { count: 0, avgAvg: 0, maxAvg: 0 };
    const avgs = filtered.map((p) => p.history?.average ?? 0);
    const count = avgs.length;
    const maxAvg = Math.max(...avgs);
    const avgAvg = avgs.reduce((a, b) => a + b, 0) / count;
    return { count, avgAvg, maxAvg };
  }, [filtered]);

  function toggleSort(field: typeof sortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: typeof sortField }) {
    if (sortField !== field) return <Minus className="w-3 h-3 opacity-30" />;
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-rose-400" /> : <ChevronDown className="w-3 h-3 text-rose-400" />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-1 sm:px-4 py-2">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.06] p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c1222] via-[#0a0f1e] to-[#060a14]" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(244,63,94,0.5), transparent 60%)' }} />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/[0.08] border border-rose-500/[0.12] text-[9px] font-black uppercase tracking-[0.2em] text-rose-500/80">
              <Heart className="w-3 h-3" />
              Ranking de Faltas Sofridas
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              <span className="text-foreground/80">MELHORES </span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-rose-400 via-pink-400 to-red-500">FALTAS SOFRIDAS</span>
            </h1>
            <p className="text-xs text-muted-foreground/50 max-w-md leading-relaxed">
              Jogadores ranqueados por média de faltas sofridas nos últimos jogos, com as melhores odds disponíveis.
            </p>
            {!loading && !error && (builtAt || dataUpdatedAt) && (
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 flex items-center gap-1.5">
                <Activity className="w-3 h-3" />
                Atualizado {updatedLabel}
                {historyLoading && (
                  <span className="text-rose-400/70 normal-case tracking-normal font-medium">
                    · carregando histórico…
                  </span>
                )}
              </p>
            )}
          </div>

          {!loading && !error && players.length > 0 && (
            <div className="flex gap-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-500/[0.08] border border-rose-500/[0.12]">
                  <Users className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <div className="text-lg font-black text-rose-400 tracking-tight">{stats.count}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Jogadores</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-pink-500/[0.08] border border-pink-500/[0.12]">
                  <Activity className="w-4 h-4 text-pink-400" />
                </div>
                <div>
                  <div className="text-lg font-black text-pink-400 tracking-tight">{stats.maxAvg.toFixed(1)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Maior Média</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* SofaScore Stats Ao Vivo */}
      {!loading && !error && uniqueMatches.length > 0 && (
        <div className="max-w-md">
          {(() => {
            const m = players[0]?.match;
            if (!m) return null;
            return <SofaScoreStats homeTeam={m.homeTeam} awayTeam={m.awayTeam} date={m.dateTime?.slice(0, 10)} highlight="faltas_sofridas" />;
          })()}
        </div>
      )}

      {/* Filters */}
      {!loading && !error && (
        <div className="p-4 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Search className="w-3 h-3" /> Buscar
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Jogador ou time (casa/fora)..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 pl-8 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-rose-500/30 transition-all"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Zap className="w-3 h-3" /> Linha
              </label>
              <div className="flex gap-1.5">
                {LINES.map((l) => (
                  <button
                    key={l}
                    onClick={() => setSelectedLine(l)}
                    className={cn(
                      'flex-1 py-2 rounded-lg text-[11px] font-bold transition-all border',
                      selectedLine === l
                        ? LINE_COLORS[l]
                        : 'text-muted-foreground/40 border-transparent hover:bg-white/[0.02]'
                    )}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <MatchGameFilter
              matches={uniqueMatches}
              selectedMatch={selectedMatch}
              onSelectMatch={setSelectedMatch}
              teamQuery={teamQuery}
              onTeamQueryChange={setTeamQuery}
            />

            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" /> Ordenar
              </label>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as typeof sortField)}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-rose-500/30 transition-all"
              >
                <option value="avg">Maior Média</option>
                <option value="bestOdd">Melhor Odd</option>
                <option value="name">Nome (A-Z)</option>
              </select>
            </div>

            {/* Max Games */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" /> Últimos jogos
              </label>
              <select
                value={historyScope}
                onChange={(e) => setHistoryScope(e.target.value as 'league' | 'all')}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all mb-2"
              >
                <option value="league">Só a liga (BR / MLS)</option>
                <option value="all">Todos os jogos (Liberta…)</option>
              </select>
              <select
                value={maxGames}
                onChange={(e) => setMaxGames(Number(e.target.value))}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              >
                {[3, 5, 8, 10].map((n) => (
                  <option key={n} value={n}>{n} jogos</option>
                ))}
              </select>
            </div>

            {/* Year */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Trophy className="w-3 h-3" /> Temporada
              </label>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              >
                {[2026, 2025, 2024].map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 pt-3 border-t border-white/[0.04]">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setOnlyStarters((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                  onlyStarters
                    ? 'border-rose-500/30 bg-rose-500/[0.08] text-rose-400'
                    : 'border-white/[0.06] text-muted-foreground/40 hover:text-foreground/60'
                )}
              >
                <Star className={cn('w-3 h-3', onlyStarters && 'fill-rose-400')} />
                Escalação prevista
              </button>

              <div className="flex items-center gap-2">
                <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 whitespace-nowrap">
                  Média min: <span className="text-rose-400/80 font-mono">{minAvg.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="0.5"
                  value={minAvg}
                  onChange={(e) => setMinAvg(Number(e.target.value))}
                  className="w-24 h-1 bg-white/[0.06] rounded-lg appearance-none cursor-pointer accent-rose-500"
                />
              </div>

              <button
                type="button"
                onClick={() => setAllComps((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                  allComps
                    ? 'border-violet-500/30 bg-violet-500/[0.08] text-violet-400'
                    : 'border-white/[0.06] text-muted-foreground/40 hover:text-foreground/60'
                )}
              >
                <span className="text-xs">🏆</span>
                Todos os campeonatos
              </button>
            </div>

            <button
              onClick={() => { invalidateMarket('faltas_sofridas'); load(true); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-muted-foreground/40 hover:text-foreground/60 border border-white/[0.06] hover:border-white/[0.1] transition-all"
            >
              <RefreshCw className="w-3 h-3" /> Reload
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-3xl border border-white/[0.04] bg-white/[0.01]">
          <p className="text-red-400 font-semibold text-sm">{error}</p>
          <button onClick={() => load()} className="btn-secondary text-xs gap-2">
            <RefreshCw className="w-3 h-3" /> Tentar Novamente
          </button>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-3xl border border-white/[0.04] bg-white/[0.01]">
          <Heart className="w-10 h-10 text-muted-foreground/20" />
          <div className="text-center">
            <p className="text-foreground/60 font-semibold text-sm">Nenhum jogador encontrado</p>
            <p className="text-muted-foreground/40 text-xs mt-1">
              {players.length === 0
                ? 'Execute a coleta primeiro para ter dados disponíveis.'
                : 'Tente ajustar os filtros.'}
            </p>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="hidden lg:grid lg:grid-cols-[40px_minmax(200px,260px)_44px_70px_1fr_100px] gap-3 px-4 items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">#</span>
          <button
            onClick={() => toggleSort('name')}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            Jogador <SortIcon field="name" />
          </button>
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40 text-center">Liga</span>
          <button
            onClick={() => toggleSort('avg')}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            Média <SortIcon field="avg" />
          </button>
          <div className="grid grid-cols-4 gap-2">
            {HOUSES.map((h) => (
              <div key={h} className="text-center">
                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: HOUSE_COLORS[h] }}>
                  {HOUSE_LABELS[h]}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => toggleSort('bestOdd')}
            className="flex items-center justify-end gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            Melhor <SortIcon field="bestOdd" />
          </button>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-2">
          {filtered.slice(0, visibleCount).map((player, idx) => (
            <PlayerRow
              key={`${player.id}_${selectedLine}`}
              player={player}
              index={idx}
              line={selectedLine}
              favorite={isFavorite(player.displayName)}
              onToggleFavorite={toggleFavorite}
              showLeague
            />
          ))}
        </div>
      )}

      {!loading && !error && visibleCount < filtered.length && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE)}
            className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-muted-foreground/80 hover:bg-white/[0.06] transition-colors"
          >
            Mostrar mais ({filtered.length - visibleCount} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

function PlayerRow({
  player,
  index,
  line,
  favorite,
  onToggleFavorite,
  showLeague,
}: {
  player: PlayerResult;
  index: number;
  line: string;
  favorite: boolean;
  onToggleFavorite: (name: string) => void;
  showLeague: boolean;
}) {
  const { displayName, team, match, isStarter, odds, bestByLine, history, analysis } = player;
  const bestOdd = bestByLine[line];
  const [expanded, setExpanded] = useState(false);
  const competition = match?.competition;

  const oddMap = useMemo(() => {
    const map = new Map<string, OddEntry>();
    for (const o of odds.filter((o) => o.line === line)) {
      map.set(o.house, o);
    }
    return map;
  }, [odds, line]);

  const lineTarget = parseFloat(line.replace(/[^0-9.]/g, '')) || 0;
  const lineAnalysis = analysis?.find((a) => a.line === line);

  return (
    <div
      className={cn(
        'rounded-2xl border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03] transition-all fade-in opacity-0',
        index < 8 && `stagger-${Math.min(index + 1, 5)}`
      )}
      style={{ animationFillMode: 'forwards' }}
    >
      <div
        className="p-3 sm:p-4 flex flex-col lg:grid lg:grid-cols-[40px_minmax(200px,260px)_44px_70px_1fr_100px] gap-3 lg:gap-3 items-start lg:items-center cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="hidden lg:flex items-center justify-center">
          <span className={cn(
            'text-sm font-black',
            index === 0 ? 'text-amber-400' : index === 1 ? 'text-gray-300' : index === 2 ? 'text-amber-600' : 'text-muted-foreground/30'
          )}>
            {index + 1}
          </span>
        </div>

        <div className="flex items-center gap-3 min-w-0">
          <span className="lg:hidden text-xs font-black text-muted-foreground/30 w-6 text-right">{index + 1}</span>
          <PlayerAvatar name={displayName} team={team} matchId={player.matchId} size={36} />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-foreground/90 text-sm truncate">{displayName}</span>
              <button
                type="button"
                title={favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleFavorite(displayName);
                }}
                className={cn(
                  'shrink-0 p-0.5 rounded transition-colors',
                  favorite
                    ? 'text-amber-400 hover:text-amber-300'
                    : 'text-muted-foreground/25 hover:text-amber-400/80',
                )}
              >
                <Star className={cn('w-3.5 h-3.5', favorite && 'fill-amber-400')} />
              </button>
              {isStarter && (
                <span title="Provável titular" className="text-emerald-400 shrink-0 text-[9px] font-black uppercase tracking-wider">
                  XI
                </span>
              )}
              {showLeague && competition && (
                <span
                  className={cn(
                    'lg:hidden shrink-0 px-1.5 py-0.5 rounded border text-[9px] font-black tracking-wide',
                    competitionBadgeClass(competition),
                  )}
                >
                  {competitionShort(competition)}
                </span>
              )}
              <ChevronDown className={cn('w-3 h-3 text-muted-foreground/30 transition-transform', expanded && 'rotate-180')} />
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/50">
              <span className="font-medium">{team}</span>
              <span className="opacity-30">·</span>
              <Link
                href={`/matches/${match.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:text-rose-400 transition-colors truncate"
              >
                {match.homeTeam} vs {match.awayTeam}
              </Link>
            </div>
            {history && history.entries.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                {history.entries.slice(-10).map((e, i) => {
                  const hit = lineTarget > 0 && e.value >= lineTarget;
                  return (
                    <span
                      key={i}
                      title={`vs ${e.opponent}: ${e.value}${e.minutes != null ? ` · ${e.minutes}m` : ''}`}
                      className={cn(
                        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-0.5 rounded text-[9px] font-mono font-bold border',
                        hit
                          ? 'bg-rose-500/15 border-rose-500/40 text-rose-400'
                          : 'bg-white/[0.02] border-white/8 text-muted-foreground/50'
                      )}
                    >
                      {e.value}
                    </span>
                  );
                })}
                <span className="text-[9px] font-bold text-muted-foreground/40 ml-1">
                  justa {lineAnalysis ? lineAnalysis.fairOdds.toFixed(2) : '—'}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="hidden lg:flex items-center justify-center">
          {showLeague && competition ? (
            <span
              className={cn(
                'px-1.5 py-0.5 rounded border text-[9px] font-black tracking-wide',
                competitionBadgeClass(competition),
              )}
              title={competition}
            >
              {competitionShort(competition)}
            </span>
          ) : (
            <span className="text-muted-foreground/20 text-[10px]">—</span>
          )}
        </div>

        <div className="hidden lg:block">
          {history ? (
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'text-lg font-black font-mono',
                history.average >= lineTarget ? 'text-rose-400' : 'text-foreground/70'
              )}>
                {history.average.toFixed(1)}
              </span>
              <span className="text-[9px] text-muted-foreground/40">/jogo</span>
            </div>
          ) : (
            <span className="text-muted-foreground/30 text-xs">—</span>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 w-full lg:w-auto">
          {HOUSES.map((house) => {
            const oddEntry = oddMap.get(house);
            const value = oddEntry?.value;
            const isBest = value !== undefined && bestOdd?.house === house && bestOdd?.line === line;

            return (
              <div key={house} className="flex flex-col items-center gap-1">
                <span
                  className="lg:hidden text-[8px] font-black uppercase tracking-widest"
                  style={{ color: HOUSE_COLORS[house] }}
                >
                  {HOUSE_LABELS[house]}
                </span>
                {value !== undefined ? (
                  <a
                    href={oddEntry?.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                      'w-full h-[42px] rounded-lg flex flex-col items-center justify-center',
                      'font-mono font-bold text-xs transition-all duration-200 border',
                      isBest
                        ? 'bg-rose-500/12 border-rose-500/45 text-rose-400 shadow-sm shadow-rose-500/10'
                        : 'bg-white/[0.02] border-white/5 text-foreground/80 hover:bg-rose-500/5 hover:border-rose-500/25 hover:-translate-y-0.5'
                    )}
                  >
                    <span className="leading-none">{formatOdd(value)}</span>
                    {isBest && (
                      <span className="text-[7px] font-black uppercase tracking-widest text-rose-400/80 mt-0.5 leading-none">
                        ★ best
                      </span>
                    )}
                  </a>
                ) : (
                  <div className="w-full h-[42px] rounded-lg border border-dashed border-white/5 flex items-center justify-center">
                    <span className="text-muted-foreground/15 text-[10px]">—</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-end gap-2 lg:pl-2">
          {bestOdd && bestOdd.line === line ? (
            <div className="flex flex-col items-end">
              <span className="font-mono font-black text-rose-400 text-base tracking-tight">
                {formatOdd(bestOdd.value)}
              </span>
              <span
                className="text-[9px] font-black uppercase tracking-widest"
                style={{ color: HOUSE_COLORS[bestOdd.house] }}
              >
                {HOUSE_LABELS[bestOdd.house]}
              </span>
            </div>
          ) : (
            <span className="text-muted-foreground/15 text-xs">—</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/[0.04] space-y-4">
          {lineAnalysis && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <AnalysisCard
                label="Probabilidade"
                value={`${lineAnalysis.probability}%`}
                subtitle={`P(X ≥ ${lineTarget})`}
                color="text-sky-400"
              />
              <AnalysisCard
                label="Odd Justa"
                value={lineAnalysis.fairOdds.toFixed(2)}
                subtitle="Poisson"
                color="text-violet-400"
              />
              <AnalysisCard
                label="Melhor Odd"
                value={lineAnalysis.bestOdd > 0 ? lineAnalysis.bestOdd.toFixed(2) : '—'}
                subtitle={lineAnalysis.bestOdd > 0 ? `${((lineAnalysis.bestOdd / lineAnalysis.fairOdds - 1) * 100).toFixed(0)}% acima da justa` : ''}
                color="text-rose-400"
              />
              <AnalysisCard
                label="EV (Expected Value)"
                value={lineAnalysis.ev > 0 ? `+${lineAnalysis.ev.toFixed(1)}%` : `${lineAnalysis.ev.toFixed(1)}%`}
                subtitle={lineAnalysis.hasValue ? 'Valor positivo ✓' : 'Sem valor'}
                color={lineAnalysis.hasValue ? 'text-emerald-400' : 'text-rose-400'}
                highlight={lineAnalysis.hasValue}
              />
            </div>
          )}

          {analysis && analysis.length > 0 && (
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
              <div className="grid grid-cols-5 gap-0 text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 px-3 py-2 border-b border-white/[0.04]">
                <span>Linha</span>
                <span className="text-center">Prob.</span>
                <span className="text-center">Odd Justa</span>
                <span className="text-center">Melhor</span>
                <span className="text-right">EV</span>
              </div>
              {analysis.map((a) => (
                <div
                  key={a.line}
                  className={cn(
                    'grid grid-cols-5 gap-0 px-3 py-2 text-xs border-b border-white/[0.02] last:border-0 transition-colors',
                    a.line === line && 'bg-rose-500/[0.03]'
                  )}
                >
                  <span className={cn('font-bold', LINE_COLORS[a.line])}>{a.line}</span>
                  <span className="text-center font-mono text-foreground/70">{a.probability}%</span>
                  <span className="text-center font-mono text-violet-400/80">{a.fairOdds.toFixed(2)}</span>
                  <span className="text-center font-mono text-foreground/80">{a.bestOdd > 0 ? a.bestOdd.toFixed(2) : '—'}</span>
                  <span className={cn('text-right font-mono font-bold', a.hasValue ? 'text-emerald-400' : 'text-rose-400/60')}>
                    {a.ev > 0 ? '+' : ''}{a.ev.toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

          {history && history.entries.length > 0 && (
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]">
                <Activity className="w-3 h-3 text-muted-foreground/40" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                  Últimos {history.entries.length} jogos
                </span>
                <span className="text-[9px] font-bold text-muted-foreground/50 ml-auto">
                  Média: <span className="text-rose-400 font-mono">{history.average.toFixed(1)}</span>
                </span>
              </div>
              <div className="divide-y divide-white/[0.02]">
                {[...history.entries].reverse().map((e, i) => {
                  const hit = lineTarget > 0 && e.value >= lineTarget;
                  return (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 text-xs">
                      <span className="text-muted-foreground/40 font-mono text-[10px] w-16 shrink-0">
                        {new Date(e.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                      </span>
                      <span className="text-foreground/60 flex-1 truncate">vs {e.opponent}</span>
                      {e.minutes != null && (
                        <span className="text-muted-foreground/30 font-mono text-[10px]">{e.minutes}'</span>
                      )}
                      <span className={cn(
                        'font-mono font-black text-sm min-w-[28px] text-right',
                        hit ? 'text-rose-400' : 'text-foreground/50'
                      )}>
                        {e.value}
                      </span>
                      {hit && (
                        <span className="text-[8px] font-bold text-rose-400/60 uppercase">✓</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnalysisCard({
  label,
  value,
  subtitle,
  color,
  highlight,
}: {
  label: string;
  value: string;
  subtitle: string;
  color: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      'rounded-xl border px-3 py-2.5 transition-all',
      highlight
        ? 'border-emerald-500/25 bg-emerald-500/[0.04]'
        : 'border-white/[0.04] bg-white/[0.01]'
    )}>
      <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground/40 mb-1">{label}</div>
      <div className={cn('text-lg font-black font-mono tracking-tight', color)}>{value}</div>
      {subtitle && <div className="text-[9px] text-muted-foreground/40 mt-0.5">{subtitle}</div>}
    </div>
  );
}
