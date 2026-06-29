'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Shield, RefreshCw, Search, Trophy, ChevronDown, ChevronUp,
  Minus, Activity, ArrowRight, Star, Users, BarChart3, Zap, Filter,
} from 'lucide-react';
import { cn, formatOdd, HOUSE_LABELS, HOUSE_COLORS } from '@/lib/utils';
import { Flag } from '@/components/Flag';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { getCachedMarket, setCachedMarket, invalidateMarket } from '@/lib/marketCache';
import type { OddEntry } from '@/lib/arbitrage';

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
  match: { id: string; homeTeam: string; awayTeam: string; homeFlag: string | null; awayFlag: string | null; dateTime: string; stage: string };
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

const HOUSES: Array<'betfair' | 'betmgm' | 'superbet' | 'pitaco'> = ['betfair', 'betmgm', 'superbet', 'pitaco'];

export default function DesarmesPage() {
  const [players, setPlayers] = useState<PlayerResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('2+');
  const [onlyStarters, setOnlyStarters] = useState(false);
  const [sortField, setSortField] = useState<'avg' | 'bestOdd' | 'name'>('avg');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedMatch, setSelectedMatch] = useState<string>('Todos');
  const [minAvg, setMinAvg] = useState<number>(0);
  const [allComps, setAllComps] = useState(false);

  const PAGE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const cached = getCachedMarket('desarmes', allComps) as ApiResponse | null;
    if (cached) {
      setPlayers(cached.players ?? []);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ market: 'desarmes' });
      if (allComps) params.set('allComps', 'true');
      const res = await fetch(`/api/desarmes?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data: ApiResponse = await res.json();
      setCachedMarket('desarmes', data, allComps);
      setPlayers(data.players ?? []);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [allComps]);

  useEffect(() => { load(); }, [load]);

  const uniqueMatches = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const p of players) {
      if (!map.has(p.matchId)) {
        map.set(p.matchId, {
          id: p.matchId,
          label: `${p.match.homeTeam} vs ${p.match.awayTeam}`,
        });
      }
    }
    return Array.from(map.values());
  }, [players]);

  const filtered = useMemo(() => {
    let list = players;

    if (selectedMatch !== 'Todos') {
      list = list.filter((p) => p.matchId === selectedMatch);
    }

    if (onlyStarters) {
      list = list.filter((p) => p.isStarter);
    }

    if (minAvg > 0) {
      list = list.filter((p) => (p.history?.average ?? 0) >= minAvg);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.displayName.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q) ||
          p.match.homeTeam.toLowerCase().includes(q) ||
          p.match.awayTeam.toLowerCase().includes(q)
      );
    }

    // Filtra apenas jogadores que têm odd na linha selecionada
    list = list.filter((p) => {
      const hasLine = p.odds.some((o) => o.line === selectedLine);
      return hasLine;
    });

    return [...list].sort((a, b) => {
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
      return 0;
    });
  }, [players, search, selectedLine, onlyStarters, sortField, sortDir, selectedMatch, minAvg]);

  useEffect(() => { setVisibleCount(PAGE); }, [search, selectedLine, onlyStarters, sortField, sortDir, selectedMatch, minAvg]);

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
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-primary" /> : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-1 sm:px-4 py-2">
      {/* Header */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.06] p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c1222] via-[#0a0f1e] to-[#060a14]" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(16,185,129,0.5), transparent 60%)' }} />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/[0.08] border border-primary/[0.12] text-[9px] font-black uppercase tracking-[0.2em] text-primary/80">
              <Shield className="w-3 h-3" />
              Ranking de Desarmes
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              <span className="text-foreground/80">MELHORES </span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-500">DESARMES</span>
            </h1>
            <p className="text-xs text-muted-foreground/50 max-w-md leading-relaxed">
              Jogadores ranqueados por média de desarmes nos últimos jogos da Copa, com as melhores odds disponíveis.
            </p>
          </div>

          {!loading && !error && players.length > 0 && (
            <div className="flex gap-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-primary/[0.08] border border-primary/[0.12]">
                  <Users className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <div className="text-lg font-black text-primary tracking-tight">{stats.count}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Jogadores</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-emerald-500/[0.08] border border-emerald-500/[0.12]">
                  <Activity className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <div className="text-lg font-black text-emerald-400 tracking-tight">{stats.maxAvg.toFixed(1)}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Maior Média</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Filters */}
      {!loading && !error && (
        <div className="p-4 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Search className="w-3 h-3" /> Buscar
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Jogador ou seleção..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 pl-8 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
              </div>
            </div>

            {/* Line */}
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

            {/* Match */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Trophy className="w-3 h-3" /> Jogo
              </label>
              <select
                value={selectedMatch}
                onChange={(e) => setSelectedMatch(e.target.value)}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              >
                <option value="Todos">Todos os jogos</option>
                {uniqueMatches.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
            </div>

            {/* Sort */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <BarChart3 className="w-3 h-3" /> Ordenar
              </label>
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as typeof sortField)}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              >
                <option value="avg">Maior Média</option>
                <option value="bestOdd">Melhor Odd</option>
                <option value="name">Nome (A-Z)</option>
              </select>
            </div>
          </div>

          {/* Starter toggle + Min Avg */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 pt-3 border-t border-white/[0.04]">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => setOnlyStarters((v) => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                  onlyStarters
                    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400'
                    : 'border-white/[0.06] text-muted-foreground/40 hover:text-foreground/60'
                )}
              >
                <Star className={cn('w-3 h-3', onlyStarters && 'fill-emerald-400')} />
                Titulares apenas
              </button>

              <div className="flex items-center gap-2">
                <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 whitespace-nowrap">
                  Média min: <span className="text-primary/80 font-mono">{minAvg.toFixed(1)}</span>
                </label>
                <input
                  type="range"
                  min="0"
                  max="6"
                  step="0.5"
                  value={minAvg}
                  onChange={(e) => setMinAvg(Number(e.target.value))}
                  className="w-24 h-1 bg-white/[0.06] rounded-lg appearance-none cursor-pointer accent-primary"
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
                Todas as fases da Copa
              </button>
            </div>

            <button
              onClick={() => { invalidateMarket('desarmes'); load(); }}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-muted-foreground/40 hover:text-foreground/60 border border-white/[0.06] hover:border-white/[0.1] transition-all"
            >
              <RefreshCw className="w-3 h-3" /> Reload
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-20 w-full rounded-2xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-3xl border border-white/[0.04] bg-white/[0.01]">
          <p className="text-red-400 font-semibold text-sm">{error}</p>
          <button onClick={load} className="btn-secondary text-xs gap-2">
            <RefreshCw className="w-3 h-3" /> Tentar Novamente
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-3xl border border-white/[0.04] bg-white/[0.01]">
          <Shield className="w-10 h-10 text-muted-foreground/20" />
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

      {/* Header row (desktop) */}
      {!loading && !error && filtered.length > 0 && (
        <div className="hidden lg:grid lg:grid-cols-[40px_260px_70px_1fr_100px] gap-3 px-4 items-center">
          <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">#</span>
          <button
            onClick={() => toggleSort('name')}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70 hover:text-foreground transition-colors"
          >
            Jogador <SortIcon field="name" />
          </button>
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

      {/* Player cards */}
      {!loading && !error && (
        <div className="space-y-2">
          {filtered.slice(0, visibleCount).map((player, idx) => (
            <PlayerRow key={`${player.id}_${selectedLine}`} player={player} index={idx} line={selectedLine} />
          ))}
        </div>
      )}

      {/* Load more sentinel */}
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

// ─── Player Row ────────────────────────────────────────────────────────

function PlayerRow({ player, index, line }: { player: PlayerResult; index: number; line: string }) {
  const { displayName, team, match, isStarter, odds, bestByLine, history, analysis } = player;
  const bestOdd = bestByLine[line];
  const [expanded, setExpanded] = useState(false);

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
      {/* Main row */}
      <div
        className="p-3 sm:p-4 flex flex-col lg:grid lg:grid-cols-[40px_260px_70px_1fr_100px] gap-3 lg:gap-3 items-start lg:items-center cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
      >
        {/* Rank */}
        <div className="hidden lg:flex items-center justify-center">
          <span className={cn(
            'text-sm font-black',
            index === 0 ? 'text-amber-400' : index === 1 ? 'text-gray-300' : index === 2 ? 'text-amber-600' : 'text-muted-foreground/30'
          )}>
            {index + 1}
          </span>
        </div>

        {/* Player + Match info */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="lg:hidden text-xs font-black text-muted-foreground/30 w-6 text-right">{index + 1}</span>
          <PlayerAvatar name={displayName} team={team} matchId={player.matchId} size={36} />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-foreground/90 text-sm truncate">{displayName}</span>
              {isStarter && (
                <span title="Provável titular" className="text-emerald-400 shrink-0">
                  <Star className="w-3 h-3 fill-emerald-400" />
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
                className="hover:text-primary transition-colors truncate"
              >
                {match.homeTeam} vs {match.awayTeam}
              </Link>
            </div>
            {/* Mini history sparkline */}
            {history && history.entries.length > 0 && (
              <div className="flex items-center gap-1 mt-1">
                {history.entries.slice(-6).map((e, i) => {
                  const hit = lineTarget > 0 && e.value >= lineTarget;
                  return (
                    <span
                      key={i}
                      title={`vs ${e.opponent}: ${e.value}${e.minutes != null ? ` · ${e.minutes}m` : ''}`}
                      className={cn(
                        'inline-flex items-center justify-center min-w-[18px] h-[18px] px-0.5 rounded text-[9px] font-mono font-bold border',
                        hit
                          ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400'
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

        {/* Average */}
        <div className="hidden lg:block">
          {history ? (
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'text-lg font-black font-mono',
                history.average >= lineTarget ? 'text-emerald-400' : 'text-foreground/70'
              )}>
                {history.average.toFixed(1)}
              </span>
              <span className="text-[9px] text-muted-foreground/40">/jogo</span>
            </div>
          ) : (
            <span className="text-muted-foreground/30 text-xs">—</span>
          )}
        </div>

        {/* Odds grid */}
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
                        ? 'bg-primary/12 border-primary/45 text-primary shadow-sm shadow-primary/10'
                        : 'bg-white/[0.02] border-white/5 text-foreground/80 hover:bg-primary/5 hover:border-primary/25 hover:-translate-y-0.5'
                    )}
                  >
                    <span className="leading-none">{formatOdd(value)}</span>
                    {isBest && (
                      <span className="text-[7px] font-black uppercase tracking-widest text-primary/80 mt-0.5 leading-none">
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

        {/* Best odd */}
        <div className="flex items-center justify-end gap-2 lg:pl-2">
          {bestOdd && bestOdd.line === line ? (
            <div className="flex flex-col items-end">
              <span className="font-mono font-black text-primary text-base tracking-tight">
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

      {/* ═══ Expanded panel ═══ */}
      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-white/[0.04] space-y-4">
          {/* Análise Poisson */}
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
                color="text-primary"
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

          {/* Tabela completa de análise por linha */}
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
                    a.line === line && 'bg-primary/[0.03]'
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

          {/* Últimos Jogos */}
          {history && history.entries.length > 0 && (
            <div className="rounded-xl border border-white/[0.04] bg-white/[0.01] overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]">
                <Activity className="w-3 h-3 text-muted-foreground/40" />
                <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/40">
                  Últimos {history.entries.length} jogos
                </span>
                <span className="text-[9px] font-bold text-muted-foreground/50 ml-auto">
                  Média: <span className="text-primary font-mono">{history.average.toFixed(1)}</span>
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
                        hit ? 'text-emerald-400' : 'text-foreground/50'
                      )}>
                        {e.value}
                      </span>
                      {hit && (
                        <span className="text-[8px] font-bold text-emerald-400/60 uppercase">✓</span>
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

// ─── Analysis Card ──────────────────────────────────────────────────

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
