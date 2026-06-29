'use client';

import { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  Zap, Trophy, Frown, RefreshCw, Sliders,
  Search, ShieldAlert, ArrowRight, Star, Activity, Sparkles, Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Flag } from '@/components/Flag';
import { PlayerAvatar } from '@/components/PlayerAvatar';
import { getCachedMarket, setCachedMarket, invalidateMarket } from '@/lib/marketCache';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface OddEntry {
  house: 'betfair' | 'betmgm' | 'superbet' | 'pitaco';
  line: string;
  value: number;
  url?: string;
}

interface Opportunity {
  id: string;
  player: {
    id: string;
    name: string;
    displayName: string;
    team: string;
    isProbableStarter?: boolean;
  };
  match: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    homeFlag: string | null;
    awayFlag: string | null;
    dateTime: string;
    stage: string;
  };
  market: 'desarmes' | 'faltas_cometidas' | 'faltas_sofridas';
  line: string;
  odds: OddEntry[];
  bestOddHouse: 'betfair' | 'betmgm' | 'superbet' | 'pitaco';
  bestOddValue: number;
  secondBestOddValue: number;
  diffPct: number;
  history?: {
    entries: { date: string; opponent: string; value: number; minutes: number | null }[];
    total: number;
    average: number;
  } | null;
}

interface ApiResponse {
  opportunities: Opportunity[];
  mock: boolean;
}

const MARKET_LABELS: Record<string, string> = {
  desarmes: 'Desarmes',
  faltas_cometidas: 'Faltas Cometidas',
  faltas_sofridas: 'Faltas Sofridas',
};

const MARKET_ICONS: Record<string, string> = {
  desarmes: '🛡️',
  faltas_cometidas: '⚠️',
  faltas_sofridas: '🤕',
};

// ─── Componente Principal ─────────────────────────────────────────────────────

export default function ValueOddsPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);

  // Filtros
  const [threshold, setThreshold] = useState<number>(50); // padrão 50%
  const [search, setSearch] = useState<string>('');
  const [marketFilter, setMarketFilter] = useState<string>('Todos');
  const [lineFilter, setLineFilter] = useState<string>('Todos');
  const [sortBy, setSortBy] = useState<'diffPct' | 'playerName' | 'dateTime'>('diffPct');
  const [onlyStarters, setOnlyStarters] = useState<boolean>(false);

  // Render incremental (scroll infinito): evita montar centenas de cards de uma
  // vez — que era o que travava a aba. Mostramos em lotes.
  const PAGE = 48;
  const [visibleCount, setVisibleCount] = useState<number>(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Obter todas as linhas únicas disponíveis nas oportunidades atuais para o seletor dinâmico
  const uniqueLines = useMemo(() => {
    const lines = new Set<string>();
    opportunities.forEach(opp => {
      if (opp.line) lines.add(opp.line);
    });
    return Array.from(lines).sort((a, b) => {
      const numA = parseFloat(a) || parseInt(a) || 0;
      const numB = parseFloat(b) || parseInt(b) || 0;
      return numA - numB;
    });
  }, [opportunities]);

  const load = useCallback(async () => {
    const cached = getCachedMarket('value-odds', false) as ApiResponse | null;
    if (cached) {
      setOpportunities(cached.opportunities ?? []);
      setIsMock(cached.mock ?? false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/value-odds', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data: ApiResponse = await res.json();
      setCachedMarket('value-odds', data, false);
      setOpportunities(data.opportunities ?? []);
      setIsMock(data.mock ?? false);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Filtros dinâmicos aplicados em memória
  const filteredOpportunities = useMemo(() => {
    return opportunities
      .filter(opp => {
        // Limiar de desajuste
        if (opp.diffPct < threshold) return false;

        // Apenas prováveis titulares
        if (onlyStarters && !opp.player.isProbableStarter) return false;

        // Mercado
        if (marketFilter !== 'Todos' && opp.market !== marketFilter) return false;

        // Linha
        if (lineFilter !== 'Todos' && opp.line !== lineFilter) return false;

        // Busca de jogador
        if (search.trim() !== '') {
          const s = search.toLowerCase();
          const pName = opp.player.displayName.toLowerCase();
          const pTeam = opp.player.team.toLowerCase();
          if (!pName.includes(s) && !pTeam.includes(s)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'diffPct') {
          return b.diffPct - a.diffPct;
        }
        if (sortBy === 'playerName') {
          return a.player.displayName.localeCompare(b.player.displayName);
        }
        if (sortBy === 'dateTime') {
          return new Date(a.match.dateTime).getTime() - new Date(b.match.dateTime).getTime();
        }
        return 0;
      });
  }, [opportunities, threshold, search, marketFilter, lineFilter, sortBy, onlyStarters]);

  // Volta ao 1º lote sempre que os filtros mudam.
  useEffect(() => {
    setVisibleCount(PAGE);
  }, [threshold, search, marketFilter, lineFilter, sortBy, onlyStarters]);

  // Carrega o próximo lote quando o usuário chega perto do fim da lista.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setVisibleCount((c) => c + PAGE);
      },
      { rootMargin: '800px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filteredOpportunities.length, visibleCount]);

  // Resumo estatístico rápido
  const stats = useMemo(() => {
    if (filteredOpportunities.length === 0) return { count: 0, avgDiff: 0, maxDiff: 0 };
    const diffs = filteredOpportunities.map(o => o.diffPct);
    const count = diffs.length;
    const maxDiff = Math.max(...diffs);
    const avgDiff = diffs.reduce((a, b) => a + b, 0) / count;
    return { count, avgDiff, maxDiff };
  }, [filteredOpportunities]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-1 sm:px-4 py-2">
      
      {/* ═══ Header ═══ */}
      <div className="relative overflow-hidden rounded-[28px] border border-white/[0.06] p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-[#0c1222] via-[#0a0f1e] to-[#060a14]" />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(245,158,11,0.5), transparent 60%)' }} />

        <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/[0.08] border border-amber-500/[0.12] text-[9px] font-black uppercase tracking-[0.2em] text-amber-400/80">
              <Zap className="w-3 h-3" />
              Scanner de Valor
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight">
              <span className="text-foreground/80">ODDS </span>
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-500">DESAJUSTADAS</span>
            </h1>
            <p className="text-xs text-muted-foreground/50 max-w-md leading-relaxed">
              Escaneamento cruzado de odds entre Betfair, BetMGM e Superbet para identificar valor.
            </p>
          </div>

          {/* KPIs inline */}
          {!loading && !error && opportunities.length > 0 && (
            <div className="flex gap-3">
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-amber-500/[0.08] border border-amber-500/[0.12]">
                  <Zap className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <div className="text-lg font-black text-amber-400 tracking-tight">{stats.count}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Desajustes</div>
                </div>
              </div>
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-rose-500/[0.08] border border-rose-500/[0.12]">
                  <Activity className="w-4 h-4 text-rose-400" />
                </div>
                <div>
                  <div className="text-lg font-black text-rose-400 tracking-tight">{stats.maxDiff > 0 ? `+${stats.maxDiff.toFixed(0)}%` : '—'}</div>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">Máximo</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Filters ═══ */}
      {!loading && !error && (
        <div className="p-4 rounded-2xl border border-white/[0.04] bg-white/[0.015]">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Threshold */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Sliders className="w-3 h-3" /> Desajuste: <span className="text-amber-400/80 font-mono">+{threshold}%</span>
              </label>
              <input
                type="range" min="5" max="80" step="5" value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full h-1 bg-white/[0.06] rounded-lg appearance-none cursor-pointer accent-amber-400"
              />
            </div>

            {/* Search */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40 flex items-center gap-1.5">
                <Search className="w-3 h-3" /> Buscar
              </label>
              <div className="relative">
                <input
                  type="text" placeholder="Jogador ou seleção..." value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 pl-8 text-xs text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                />
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
              </div>
            </div>

            {/* Line */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40">Linha</label>
              <select
                value={lineFilter} onChange={(e) => setLineFilter(e.target.value)}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              >
                <option value="Todos">Todas</option>
                {uniqueLines.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>

            {/* Sort */}
            <div className="space-y-2">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-muted-foreground/40">Ordenar</label>
              <select
                value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs text-foreground appearance-none cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
              >
                <option value="diffPct">Maior Desajuste</option>
                <option value="playerName">Nome (A-Z)</option>
                <option value="dateTime">Horário</option>
              </select>
            </div>
          </div>

          {/* Market tabs + starter toggle */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mt-4 pt-3 border-t border-white/[0.04]">
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'Todos', label: 'Todos', icon: <Trophy className="w-3 h-3" /> },
                { id: 'desarmes', label: 'Desarmes', icon: <span className="text-xs">🛡️</span> },
                { id: 'faltas_cometidas', label: 'Faltas Cometidas', icon: <span className="text-xs">⚠️</span> },
                { id: 'faltas_sofridas', label: 'Faltas Sofridas', icon: <span className="text-xs">🤕</span> },
              ].map(item => (
                <button
                  key={item.id} onClick={() => setMarketFilter(item.id)}
                  className={cn(
                    'flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all',
                    marketFilter === item.id
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'text-muted-foreground/40 hover:text-foreground/60 border border-transparent'
                  )}
                >
                  {item.icon} {item.label}
                  <span className="text-[9px] font-mono opacity-60">
                    {item.id === 'Todos'
                      ? opportunities.filter(o => o.diffPct >= threshold).length
                      : opportunities.filter(o => o.market === item.id && o.diffPct >= threshold).length}
                  </span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button" onClick={() => setOnlyStarters(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all',
                  onlyStarters
                    ? 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400'
                    : 'border-white/[0.06] text-muted-foreground/40 hover:text-foreground/60'
                )}
              >
                <Star className={cn('w-3 h-3', onlyStarters && 'fill-emerald-400')} />
                Titulares
              </button>
              <button onClick={() => { invalidateMarket('value-odds'); load(); }} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold text-muted-foreground/40 hover:text-foreground/60 border border-white/[0.06] hover:border-white/[0.1] transition-all">
                <RefreshCw className="w-3 h-3" /> Reload
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Grid ═══ */}
      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : filteredOpportunities.length === 0 ? (
        <EmptyState
          hasData={opportunities.length > 0}
          onReset={() => {
            setThreshold(15);
            setSearch('');
            setMarketFilter('Todos');
            setLineFilter('Todos');
            setOnlyStarters(false);
          }}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 slide-up" style={{ animationFillMode: 'forwards', animationDelay: '0.12s' }}>
          {filteredOpportunities.slice(0, visibleCount).map((opp, idx) => (
            <OpportunityCard key={opp.id} opportunity={opp} index={idx} />
          ))}
        </div>
      )}
      {!loading && !error && visibleCount < filteredOpportunities.length && (
        <div ref={sentinelRef} className="flex justify-center py-8">
          <button
            onClick={() => setVisibleCount((c) => c + PAGE)}
            className="px-5 py-2.5 rounded-xl border border-white/10 bg-white/[0.03] text-sm font-bold text-muted-foreground/80 hover:bg-white/[0.06] transition-colors"
          >
            Mostrar mais ({filteredOpportunities.length - visibleCount} restantes)
          </button>
        </div>
      )}
    </div>
  );
}

// ─── OpportunityCard ──────────────────────────────────────────────────────────

function OpportunityCard({ opportunity, index }: { opportunity: Opportunity; index: number }) {
  const { player, match, market, line, odds, bestOddHouse, diffPct, history } = opportunity;

  // Linha exigida (ex.: "2+" -> 2) p/ pintar verde os jogos em que bateu a linha.
  const lineTarget = parseFloat(String(line).replace(/[^0-9.]/g, '')) || 0;

  return (
    <div
      className={cn(
        'match-card fade-in opacity-0 p-5 group flex flex-col justify-between relative',
        `stagger-${Math.min(index + 1, 8)}`
      )}
      style={{ animationFillMode: 'forwards' }}
    >
      {/* Indicador de Desajuste Top */}
      <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60 flex items-center gap-1">
          {MARKET_ICONS[market]} {MARKET_LABELS[market]} — Linha {line}
        </span>
        
        {/* Badge de Destaque do Desajuste */}
        <span className="match-badge border-amber-500/35 bg-amber-500/8 text-amber-400 font-extrabold shadow-sm shadow-amber-500/5 select-none animate-pulse">
          ⚡ +{diffPct.toFixed(0)}%
        </span>
      </div>

      {/* Jogador Info */}
      <div className="flex items-center gap-3 mb-4">
        <PlayerAvatar name={player.displayName} team={player.team} size={42} />
        <div className="min-w-0">
          <h3 className="font-extrabold text-foreground/90 leading-snug truncate flex items-center gap-1.5">
            <span className="truncate">{player.displayName}</span>
            {player.isProbableStarter && (
              <span title="Provável titular" className="shrink-0 text-emerald-400">
                <Star className="w-3 h-3 fill-emerald-400" />
              </span>
            )}
          </h3>
          <p className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-wide">
            {player.team}
          </p>
        </div>
      </div>

      {/* Histórico do jogador na Copa (jogos finalizados, via 365scores) */}
      {history && history.entries.length > 0 ? (
        <div className="bg-white/[0.02] border border-white/5 rounded-2xl px-3 py-2.5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold tracking-wider text-muted-foreground/50 uppercase flex items-center gap-1.5">
              <Activity className="w-3 h-3" />
              Histórico na Copa
            </span>
            <span className="text-[9px] font-bold text-muted-foreground/70">
              méd <span className="text-amber-400 font-mono">{history.average.toFixed(1)}</span>
            </span>
          </div>
          <div className="flex items-end gap-1.5 flex-wrap">
            {history.entries.slice(-6).map((e, i) => {
              const hit = lineTarget > 0 && e.value >= lineTarget;
              const mins = e.minutes != null ? `${e.minutes}m` : '';

              return (
                <div
                  key={i}
                  title={`vs ${e.opponent} (${e.date})${mins ? ` • Jogou ${mins}` : ''}`}
                  className={cn(
                    'flex flex-col items-center justify-end w-8 h-10 rounded bg-white/[0.03] border relative group cursor-help transition-colors',
                    hit ? 'border-emerald-500/30' : 'border-white/5 hover:border-white/10',
                  )}
                >
                  <span className="text-[8px] text-muted-foreground/40 absolute top-1 uppercase font-bold tracking-tighter">
                    {e.opponent.slice(0, 3)}
                  </span>
                  <span
                    className={cn(
                      'text-[11px] font-black pb-0.5 z-10',
                      hit ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.4)]' : 'text-white/70',
                    )}
                  >
                    {e.value}
                  </span>
                  {mins && (
                    <span className="text-[7px] font-mono leading-none text-muted-foreground/50 z-10 pb-1">
                      {mins}
                    </span>
                  )}
                  {hit && (
                    <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-emerald-500/20 to-transparent rounded-b" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="bg-white/[0.01] border border-white/5 rounded-2xl px-3 py-3 mb-4 flex items-center justify-center gap-2">
          <Activity className="w-3.5 h-3.5 text-muted-foreground/30" />
          <span className="text-[10px] font-medium tracking-wide text-muted-foreground/40 uppercase">
            Sem estatísticas na Copa
          </span>
        </div>
      )}

      {/* Partida Info */}
      <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-3 mb-5 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flag-frame shrink-0" style={{ width: 22, height: 22 }}>
            <Flag code={match.homeFlag} size={14} title={match.homeTeam} />
          </div>
          <span className="font-extrabold text-foreground/80 truncate text-[11px]">{match.homeTeam}</span>
        </div>
        <span className="text-[9px] font-black text-muted-foreground/20">VS</span>
        <div className="flex items-center gap-2 min-w-0 flex-row-reverse text-right">
          <div className="flag-frame shrink-0" style={{ width: 22, height: 22 }}>
            <Flag code={match.awayFlag} size={14} title={match.awayTeam} />
          </div>
          <span className="font-extrabold text-foreground/80 truncate text-[11px]">{match.awayTeam}</span>
        </div>
      </div>

      {/* Odds das Casas */}
      <div className="space-y-2 mb-5">
        <div className="grid grid-cols-4 gap-2 text-center text-[10px] font-extrabold uppercase text-muted-foreground/50 tracking-wider">
          <span>Betfair</span>
          <span>BetMGM</span>
          <span>Superbet</span>
          <span>Pitaco</span>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {['betfair', 'betmgm', 'superbet', 'pitaco'].map((house) => {
            const odd = odds.find(o => o.house === house);
            const isBest = bestOddHouse === house;

            if (!odd) {
              return (
                <div key={house} className="odd-cell missing px-2 py-2 text-xs">
                  —
                </div>
              );
            }

            return (
              <a
                key={house}
                href={odd.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'odd-cell px-2 py-2 text-xs transition-all duration-300 block',
                  isBest && 'best'
                )}
              >
                {odd.value.toFixed(2)}
                {isBest && (
                  <span className="absolute -top-1.5 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                )}
              </a>
            );
          })}
        </div>
      </div>

      {/* Ação */}
      <Link
        href={`/matches/${match.id}`}
        className="w-full btn-secondary text-xs py-2.5 justify-center gap-1.5 border-white/5 hover:border-amber-500/25 hover:bg-amber-500/5 hover:text-amber-400"
      >
        <span>Analisar Jogo</span>
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </Link>
    </div>
  );
}

// ─── Sub-componentes do Grid ──────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="match-card p-5 space-y-4 cursor-default pointer-events-none">
          <div className="flex justify-between items-center pb-3 border-b border-white/5">
            <div className="skeleton h-3.5 w-32 rounded-lg" />
            <div className="skeleton h-5 w-14 rounded-xl" />
          </div>
          <div className="flex items-center gap-3">
            <div className="skeleton w-10 h-10 rounded-full" />
            <div className="space-y-1.5">
              <div className="skeleton h-3.5 w-24 rounded-lg" />
              <div className="skeleton h-3 w-14 rounded-lg" />
            </div>
          </div>
          <div className="skeleton h-9 w-full rounded-2xl" />
          <div className="space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <div className="skeleton h-3 w-10 rounded-md mx-auto" />
              <div className="skeleton h-3 w-10 rounded-md mx-auto" />
              <div className="skeleton h-3 w-10 rounded-md mx-auto" />
              <div className="skeleton h-3 w-10 rounded-md mx-auto" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="skeleton h-8 rounded-xl" />
              <div className="skeleton h-8 rounded-xl" />
              <div className="skeleton h-8 rounded-xl" />
              <div className="skeleton h-8 rounded-xl" />
            </div>
          </div>
          <div className="skeleton h-9 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-6 rounded-3xl border border-white/5 bg-card/10 backdrop-blur-xl">
      <div className="w-16 h-16 rounded-2xl bg-rose-500/8 border border-rose-500/20 flex items-center justify-center">
        <ShieldAlert className="w-8 h-8 text-rose-400" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-foreground/90 font-bold text-lg">Erro ao rodar escaneamento</p>
        <p className="text-muted-foreground text-sm max-w-sm">{error}</p>
      </div>
      <button onClick={onRetry} className="btn-primary gap-2">
        <RefreshCw className="w-4 h-4 animate-spin-hover" />
        Tentar Novamente
      </button>
    </div>
  );
}

function EmptyState({ hasData, onReset }: { hasData: boolean; onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-6 rounded-3xl border border-white/5 bg-card/10 backdrop-blur-xl">
      <div className="w-20 h-20 rounded-2xl bg-muted/40 border border-white/5 flex items-center justify-center shadow-inner">
        <Zap className="w-10 h-10 text-muted-foreground/30" />
      </div>

      {hasData ? (
        <>
          <div className="text-center space-y-2 max-w-xs">
            <h2 className="text-xl font-extrabold text-foreground/80">Nenhum desajuste acima do limiar</h2>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Tente diminuir a porcentagem mínima de desajuste ou limpe a sua busca de jogador para encontrar oportunidades.
            </p>
          </div>
          <button onClick={onReset} className="btn-secondary gap-2">
            Limpar Filtros e Busca
          </button>
        </>
      ) : (
        <>
          <div className="text-center space-y-2 max-w-sm">
            <h2 className="text-xl font-extrabold text-foreground/80">Nenhum mercado ativo no momento</h2>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Não existem mercados de jogador ativos suficientes no banco de dados para realizar o escaneamento cruzado de odds.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
