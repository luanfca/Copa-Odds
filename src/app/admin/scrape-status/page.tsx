'use client';

import { useEffect, useState, useCallback } from 'react';

interface AdapterStat {
  adapter: string;
  successCount: number;
  failureCount: number;
  totalRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastStatus: string | null;
}

interface RecentScrape {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  matchCount: number;
  playerCount: number;
  oddCount: number;
  errorMsg: string | null;
  durationMs: number | null;
}

interface ScrapeStats {
  overall: {
    totalScrapes: number;
    successfulScrapes: number;
    failedScrapes: number;
    partialScrapes: number;
    overallSuccessRate: number;
    lastScrapeAt: string | null;
    lastScrapeStatus: string | null;
    avgDurationMs: number | null;
    totalMatchesScraped: number;
    totalPlayersScraped: number;
    totalOddsCollected: number;
  };
  adapters: AdapterStat[];
  recentScrapes: RecentScrape[];
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function statusBadge(status: string) {
  const cls: Record<string, string> = {
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    partial: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    error: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  return cls[status] || 'bg-gray-500/10 text-gray-400 border-gray-500/20';
}

export default function ScrapeStatusPage() {
  const [stats, setStats] = useState<ScrapeStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/scrape-stats');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchStats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Carregando estatísticas...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3 p-8 rounded-3xl border border-red-500/20 bg-red-500/5 max-w-md">
          <p className="text-red-400 font-bold">Erro ao carregar dados</p>
          <p className="text-muted-foreground text-sm">{error}</p>
          <button onClick={fetchStats} className="btn-secondary">
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const { overall, adapters, recentScrapes } = stats;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight hero-gradient-text">
            Status do Scraper
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Performance e saúde dos adaptadores de odds
          </p>
        </div>
        <button onClick={fetchStats} className="btn-secondary">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Atualizar
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="kpi-pill kpi-status">
          <div className="kpi-icon bg-emerald-500/10">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="kpi-value text-emerald-400">{overall.overallSuccessRate}%</div>
            <div className="kpi-label">Taxa de Sucesso</div>
          </div>
        </div>

        <div className="kpi-pill kpi-games">
          <div className="kpi-icon bg-blue-500/10">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7C5 4 4 5 4 7z" />
            </svg>
          </div>
          <div>
            <div className="kpi-value text-blue-400">{overall.totalScrapes}</div>
            <div className="kpi-label">Total Scrapes</div>
          </div>
        </div>

        <div className="kpi-pill kpi-time">
          <div className="kpi-icon bg-yellow-500/10">
            <svg className="w-5 h-5 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <div className="kpi-value text-yellow-400">{formatDuration(overall.avgDurationMs)}</div>
            <div className="kpi-label">Duração Média</div>
          </div>
        </div>

        <div className="kpi-pill">
          <div className="kpi-icon bg-purple-500/10">
            <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            </svg>
          </div>
          <div>
            <div className="kpi-value text-purple-400">{overall.totalOddsCollected.toLocaleString()}</div>
            <div className="kpi-label">Odds Coletadas</div>
          </div>
        </div>
      </div>

      {/* Adapter Performance */}
      <div className="rounded-3xl border border-white/5 overflow-hidden backdrop-blur-xl" style={{ background: 'linear-gradient(135deg, rgba(14,23,45,0.75) 0%, rgba(9,15,28,0.85) 100%)' }}>
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-bold tracking-tight">Performance por Adaptador</h2>
          <p className="text-muted-foreground text-xs mt-0.5">Taxa de sucesso individual de cada casa de apostas</p>
        </div>
        <div className="divide-y divide-white/5">
          {adapters.map((adapter) => (
            <div key={adapter.adapter} className="px-6 py-4 flex items-center justify-between hover:bg-white/[0.015] transition-colors">
              <div className="flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${adapter.successRate >= 80 ? 'bg-emerald-400' : adapter.successRate >= 50 ? 'bg-yellow-400' : 'bg-red-400'}`} />
                <div>
                  <div className="font-bold text-sm">{adapter.adapter}</div>
                  <div className="text-muted-foreground text-xs">
                    {adapter.successCount}/{adapter.totalRuns} sucesso
                    {adapter.totalRuns - adapter.successCount > 0 &&
                      ` · ${adapter.totalRuns - adapter.successCount} falha${adapter.totalRuns - adapter.successCount > 1 ? 's' : ''}`}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                {/* Progress bar */}
                <div className="w-32 h-2 rounded-full bg-white/5 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      adapter.successRate >= 80 ? 'bg-emerald-400' : adapter.successRate >= 50 ? 'bg-yellow-400' : 'bg-red-400'
                    }`}
                    style={{ width: `${adapter.successRate}%` }}
                  />
                </div>

                <div className="text-right min-w-[80px]">
                  <div className={`font-mono font-bold text-sm ${
                    adapter.successRate >= 80 ? 'text-emerald-400' : adapter.successRate >= 50 ? 'text-yellow-400' : 'text-red-400'
                  }`}>
                    {adapter.successRate}%
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Scrapes */}
      <div className="rounded-3xl border border-white/5 overflow-hidden backdrop-blur-xl" style={{ background: 'linear-gradient(135deg, rgba(14,23,45,0.75) 0%, rgba(9,15,28,0.85) 100%)' }}>
        <div className="px-6 py-4 border-b border-white/5">
          <h2 className="text-lg font-bold tracking-tight">Scrapes Recentes</h2>
          <p className="text-muted-foreground text-xs mt-0.5">Últimos {recentScrapes.length} executions</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">Status</th>
                <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">Início</th>
                <th className="px-4 py-3 text-left text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">Duração</th>
                <th className="px-4 py-3 text-right text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">Jogos</th>
                <th className="px-4 py-3 text-right text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">Jogadores</th>
                <th className="px-4 py-3 text-right text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">Odds</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {recentScrapes.map((scrape) => (
                <tr key={scrape.id} className="hover:bg-white/[0.015] transition-colors">
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border ${statusBadge(scrape.status)}`}>
                      {scrape.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                    {formatDate(scrape.startedAt)}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                    {formatDuration(scrape.durationMs)}
                  </td>
                  <td className="px-4 py-3 text-xs text-right font-mono">{scrape.matchCount}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono">{scrape.playerCount}</td>
                  <td className="px-4 py-3 text-xs text-right font-mono">{scrape.oddCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary footer */}
      <div className="text-center text-muted-foreground text-xs pb-4">
        Última atualização: {lastRefresh.toLocaleTimeString('pt-BR')} · Auto-refresh a cada 60s
      </div>
    </div>
  );
}
