'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ChevronRight, Trophy, RefreshCw, Clock, Users, Star, BarChart3, TrendingUp, Zap } from 'lucide-react';
import { OddsTable } from '@/components/OddsTable';
import { FilterBar } from '@/components/FilterBar';
import { formatDateTime, cn } from '@/lib/utils';
import { Flag } from '@/components/Flag';
import type { OddEntry } from '@/lib/arbitrage';

interface Player {
  id: string;
  displayName: string;
  team: string;
  odds: OddEntry[];
  bestByLine: Record<string, OddEntry>;
}

interface MatchData {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeFlag: string | null;
  awayFlag: string | null;
  dateTime: string;
  stage: string;
}

interface TeamStat {
  team: string;
  avgMade: number;
  avgSuffered: number;
  gamesPlayed: number;
}

function relativeTime(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `${min}min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

const AUTO_REFRESH_INTERVAL = 60_000;

export default function MatchPage() {
  const params = useParams();
  const id = params.id as string;

  const [match, setMatch] = useState<MatchData | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMock, setIsMock] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [scrapeStatus, setScrapeStatus] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(AUTO_REFRESH_INTERVAL / 1000);

  const [market, setMarket] = useState<'desarmes' | 'faltas_cometidas' | 'faltas_sofridas'>('desarmes');
  const [search, setSearch] = useState('');
  const [houseFilter, setHouseFilter] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStat[]>([]);

  useEffect(() => {
    const favs = localStorage.getItem(`favoritos_${market}`);
    if (favs) {
      try { setFavorites(JSON.parse(favs)); } catch { setFavorites([]); }
    } else {
      setFavorites([]);
    }
  }, [market]);

  const handleToggleFavorite = useCallback((name: string) => {
    setFavorites(prev => {
      const next = prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name];
      localStorage.setItem(`favoritos_${market}`, JSON.stringify(next));
      return next;
    });
  }, [market]);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [matchesRes, oddsRes, scrapeRes] = await Promise.all([
        fetch('/api/matches', { cache: 'no-store' }),
        fetch(`/api/matches/${id}?market=${market}`, { cache: 'no-store' }),
        fetch('/api/scrape', { method: 'GET', cache: 'no-store' }).catch(() => null),
      ]);
      const matchesData = await matchesRes.json();
      const oddsData = await oddsRes.json();
      const foundMatch = matchesData.matches?.find((m: MatchData) => m.id === id);
      setMatch(foundMatch || null);
      setPlayers(oddsData.players || []);
      setTeamStats(oddsData.teamStats || []);
      setIsMock(oddsData.mock || false);
      setLastUpdated(matchesData.lastUpdated);
      if (scrapeRes?.ok) {
        const scrapeData = await scrapeRes.json();
        setScrapeStatus(scrapeData.status || null);
      }
      if (oddsRes.status === 404) setError('Jogo não encontrado');
      setCountdown(AUTO_REFRESH_INTERVAL / 1000);
    } catch (err) {
      if (!silent) setError(String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, market]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(() => load(true), AUTO_REFRESH_INTERVAL); return () => clearInterval(i); }, [load]);
  useEffect(() => { const t = setInterval(() => setCountdown(c => c <= 1 ? AUTO_REFRESH_INTERVAL / 1000 : c - 1), 1000); return () => clearInterval(t); }, []);

  const totalOdds = players.reduce((s, p) => s + p.odds.length, 0);
  const maxOdd = Math.max(...players.flatMap(p => p.odds.map(o => o.value)), 0);
  const favCount = players.filter(p => favorites.includes(p.displayName)).length;

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="skeleton h-8 w-64 rounded-xl" />
        <div className="skeleton h-48 w-full rounded-3xl" />
        <div className="skeleton h-96 w-full rounded-2xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <p className="text-red-400 font-semibold">{error}</p>
        <Link href="/" className="btn-secondary"><ArrowLeft className="w-4 h-4" /> Voltar</Link>
      </div>
    );
  }

  const MARKETS = [
    { id: 'desarmes' as const, label: 'Desarmes', icon: <Zap className="w-4 h-4" /> },
    { id: 'faltas_cometidas' as const, label: 'Faltas Cometidas', icon: <span className="text-sm">⚠️</span> },
    { id: 'faltas_sofridas' as const, label: 'Faltas Sofridas', icon: <span className="text-sm">🤕</span> },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs text-muted-foreground/60 font-medium">
        <Link href="/" className="hover:text-foreground transition-colors flex items-center gap-1.5">
          <Trophy className="w-3 h-3" /> Jogos
        </Link>
        <ChevronRight className="w-3 h-3 opacity-40" />
        <span className="text-foreground/70">{match ? `${match.homeTeam} × ${match.awayTeam}` : id}</span>
      </nav>

      {/* ═══ Hero Match ═══ */}
      {match && (
        <div className="relative overflow-hidden rounded-[28px] border border-white/[0.06] p-6 sm:p-8 md:p-10">
          {/* Background layers */}
          <div className="absolute inset-0 bg-gradient-to-br from-[#0c1222] via-[#0a0f1e] to-[#060a14]" />
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(16,185,129,0.5), transparent 60%)' }} />
          <div className="absolute top-0 left-0 w-[400px] h-full opacity-[0.04] pointer-events-none" style={{ background: 'radial-gradient(circle at 20% 30%, hsl(142 71% 45%), transparent 70%)' }} />
          <div className="absolute top-0 right-0 w-[400px] h-full opacity-[0.04] pointer-events-none" style={{ background: 'radial-gradient(circle at 80% 30%, hsl(220 80% 55%), transparent 70%)' }} />

          <div className="relative flex flex-col md:flex-row items-center justify-between gap-6 md:gap-10">
            {/* Home */}
            <div className="flex flex-col items-center gap-3 flex-1 text-center group">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-primary/[0.06] blur-xl scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Flag code={match.homeFlag} size={88} className="rounded-xl relative" title={match.homeTeam} />
              </div>
              <span className="text-lg sm:text-xl font-black text-foreground/90 tracking-tight">{match.homeTeam}</span>
              {teamStats.length === 2 && teamStats[0].avgMade > 0 && (
                <div className="flex gap-3 text-[10px] font-bold">
                  <span className="text-emerald-400/80">
                    {market === 'desarmes' ? '🛡️' : '⚠️'} {teamStats[0].avgMade} <span className="text-muted-foreground/40">feitos/jogo</span>
                  </span>
                </div>
              )}
            </div>

            {/* Center */}
            <div className="flex flex-col items-center gap-3 flex-shrink-0">
              <span className="text-[9px] font-black uppercase tracking-[0.2em] text-muted-foreground/50 px-4 py-1.5 rounded-full border border-white/[0.06] bg-white/[0.02]">
                {match.stage}
              </span>
              <div className="flex items-center gap-3">
                <div className="h-px w-10 bg-gradient-to-r from-transparent to-white/10" />
                <span className="text-3xl font-black text-white/[0.08] italic tracking-wider select-none">VS</span>
                <div className="h-px w-10 bg-gradient-to-l from-transparent to-white/10" />
              </div>
              <p className="text-[11px] font-semibold text-muted-foreground/50 tracking-wide">
                {formatDateTime(match.dateTime)}
              </p>
            </div>

            {/* Away */}
            <div className="flex flex-col items-center gap-3 flex-1 text-center group">
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl bg-primary/[0.06] blur-xl scale-150 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <Flag code={match.awayFlag} size={88} className="rounded-xl relative" title={match.awayTeam} />
              </div>
              <span className="text-lg sm:text-xl font-black text-foreground/90 tracking-tight">{match.awayTeam}</span>
              {teamStats.length === 2 && teamStats[1].avgMade > 0 && (
                <div className="flex gap-3 text-[10px] font-bold">
                  <span className="text-emerald-400/80">
                    {market === 'desarmes' ? '🛡️' : '⚠️'} {teamStats[1].avgMade} <span className="text-muted-foreground/40">feitos/jogo</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Market Tabs + Status Row ═══ */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        {/* Market selector */}
        <div className="flex p-1 gap-1 rounded-2xl bg-white/[0.02] border border-white/[0.04]">
          {MARKETS.map(m => (
            <button
              key={m.id}
              onClick={() => setMarket(m.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all duration-200',
                market === m.id
                  ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                  : 'text-muted-foreground/60 hover:text-foreground/80 hover:bg-white/[0.03]'
              )}
            >
              {m.icon}
              <span className="hidden sm:inline">{m.label}</span>
            </button>
          ))}
        </div>

        {/* Status */}
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground/50 font-medium">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3" />
            <span>{relativeTime(lastUpdated)}</span>
          </div>
          <span className="text-white/10">·</span>
          <span>{countdown}s</span>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className={cn('p-1 rounded-lg hover:bg-white/[0.05] transition-colors', refreshing && 'animate-spin opacity-50')}
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* ═══ KPI Strip ═══ */}
      {players.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Jogadores', value: players.length, icon: <Users className="w-4 h-4" />, color: 'text-sky-400', ring: 'ring-sky-500/20' },
            { label: 'Favoritos', value: favCount, icon: <Star className="w-4 h-4" />, color: 'text-amber-400', ring: 'ring-amber-500/20' },
            { label: 'Odds', value: totalOdds, icon: <BarChart3 className="w-4 h-4" />, color: 'text-emerald-400', ring: 'ring-emerald-500/20' },
            { label: 'Maior Odd', value: maxOdd > 0 ? maxOdd.toFixed(1) : '—', icon: <TrendingUp className="w-4 h-4" />, color: 'text-violet-400', ring: 'ring-violet-500/20' },
          ].map(kpi => (
            <div key={kpi.label} className={cn('flex items-center gap-3 px-4 py-3 rounded-2xl border border-white/[0.04] bg-white/[0.015] hover:bg-white/[0.03] transition-all', kpi.ring)}>
              <div className={cn('flex items-center justify-center w-9 h-9 rounded-xl bg-white/[0.04] border border-white/[0.06]', kpi.color)}>
                {kpi.icon}
              </div>
              <div>
                <div className={cn('text-lg font-black tracking-tight', kpi.color)}>{kpi.value}</div>
                <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground/40">{kpi.label}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ Search + Filter ═══ */}
      <FilterBar onSearch={setSearch} onHouseFilter={setHouseFilter} />

      {/* ═══ Odds Table ═══ */}
      {players.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-3xl border border-white/[0.04] bg-white/[0.01]">
          <BarChart3 className="w-10 h-10 text-muted-foreground/20" />
          <div className="text-center">
            <p className="text-foreground/60 font-semibold text-sm">Sem odds disponíveis</p>
            <p className="text-muted-foreground/40 text-xs mt-1">Nenhuma casa oferece este mercado para este jogo ainda.</p>
          </div>
        </div>
      ) : (
        <OddsTable
          players={players}
          matchId={id}
          searchQuery={search}
          filterHouse={houseFilter}
          favorites={favorites}
          onToggleFavorite={handleToggleFavorite}
          market={market}
        />
      )}
    </div>
  );
}
