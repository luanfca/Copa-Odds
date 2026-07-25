/**
 * SofaScoreStats — exibe apenas as linhas de estatísticas do SofaScore.
 * Desarmes, faltas cometidas/sofridas, chutes, posse de bola, etc.
 */

'use client';

import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, Activity } from 'lucide-react';

interface MatchStats {
  eventId: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  status: string;
  homeTackles: number; awayTackles: number;
  homeFouls: number; awayFouls: number;
  homeWasFouled: number; awayWasFouled: number;
  homeShots: number; awayShots: number;
  homeShotsOnTarget: number; awayShotsOnTarget: number;
  homePossession: number; awayPossession: number;
  homeInterceptions: number; awayInterceptions: number;
  homePasses: number; awayPasses: number;
  homeRecoveries: number; awayRecoveries: number;
  homeClearances: number; awayClearances: number;
  homeYellowCards: number; awayYellowCards: number;
}

interface Props {
  eventId?: number;
  homeTeam?: string;
  awayTeam?: string;
  date?: string;
  highlight?: string;
}

export function SofaScoreStats({ eventId, homeTeam, awayTeam, date, highlight = 'desarmes' }: Props) {
  const [data, setData] = useState<MatchStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      let url: string;
      if (eventId) {
        url = `/api/sofascore-stats?eventId=${eventId}`;
      } else if (homeTeam && awayTeam && date) {
        url = `/api/sofascore-stats?homeTeam=${encodeURIComponent(homeTeam)}&awayTeam=${encodeURIComponent(awayTeam)}&date=${date}`;
      } else return;

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) { setLoading(false); return; }
      const json = await res.json();
      setData(json.match ?? json);
    } catch { /* silencioso */ } finally {
      setLoading(false);
    }
  }, [eventId, homeTeam, awayTeam, date]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 300000); // 5 minutos em vez de 30s
    return () => clearInterval(timer);
  }, [fetchData]);

  if (loading && !data) return null;
  if (!data) return null;

  const rows: Array<{ label: string; hv: number; av: number; suffix?: string; key: string }> = [
    { label: 'Desarmes', hv: data.homeTackles, av: data.awayTackles, key: 'totalTackle' },
    { label: 'Faltas Cometidas', hv: data.homeFouls, av: data.awayFouls, key: 'fouls' },
    { label: 'Faltas Sofridas', hv: data.homeWasFouled, av: data.awayWasFouled, key: 'wasFouled' },
    { label: 'Chutes', hv: data.homeShots, av: data.awayShots, key: 'shots' },
    { label: 'Chutes no Gol', hv: data.homeShotsOnTarget, av: data.awayShotsOnTarget, key: 'shotsOn' },
    { label: 'Posse de Bola', hv: data.homePossession, av: data.awayPossession, suffix: '%', key: 'poss' },
    { label: 'Interceptações', hv: data.homeInterceptions, av: data.awayInterceptions, key: 'interc' },
    { label: 'Passes', hv: data.homePasses, av: data.awayPasses, key: 'passes' },
    { label: 'Recuperações', hv: data.homeRecoveries, av: data.awayRecoveries, key: 'recov' },
    { label: 'Distrações', hv: data.homeClearances, av: data.awayClearances, key: 'clear' },
    { label: 'Cartões Amarelos', hv: data.homeYellowCards, av: data.awayYellowCards, key: 'yc' },
  ];

  return (
    <div className="rounded-xl border border-white/5 bg-card/30 backdrop-blur-xl overflow-hidden">
      {/* Header + Placar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-white/[0.02]">
        <div className="flex items-center gap-3">
          <Activity className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground/80">{data.homeTeam}</span>
          <span className="text-sm font-black">{data.homeScore} x {data.awayScore}</span>
          <span className="text-xs font-bold text-foreground/80">{data.awayTeam}</span>
        </div>
        <button onClick={fetchData} className="text-muted-foreground/40 hover:text-foreground/60 transition-colors" title="Atualizar">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Linhas */}
      <div className="px-4 py-2 space-y-0.5">
        {rows.map((r) => {
          const total = r.hv + r.av;
          const hp = total > 0 ? (r.hv / total) * 100 : 50;
          const ap = total > 0 ? (r.av / total) * 100 : 50;
          const isHL = r.key === highlight || (highlight === 'desarmes' && r.key === 'totalTackle') || (highlight === 'faltas_cometidas' && r.key === 'fouls') || (highlight === 'faltas_sofridas' && r.key === 'wasFouled');

          return (
            <div key={r.key} className={`flex items-center text-[11px] py-1 ${isHL ? 'bg-primary/5 rounded px-1 -mx-1' : ''}`}>
              <span className="w-10 text-right font-bold text-emerald-400 tabular-nums">{r.hv}{r.suffix ?? ''}</span>
              <div className="flex-1 mx-2">
                <div className="text-center text-muted-foreground/60 font-semibold uppercase tracking-wider text-[9px]">{r.label}</div>
                <div className="flex h-0.5 mt-0.5 rounded-full overflow-hidden bg-white/5">
                  <div className="bg-emerald-500/50 transition-all duration-500" style={{ width: `${hp}%` }} />
                  <div className="bg-sky-500/50 transition-all duration-500" style={{ width: `${ap}%` }} />
                </div>
              </div>
              <span className="w-10 text-left font-bold text-sky-400 tabular-nums">{r.av}{r.suffix ?? ''}</span>
            </div>
          );
        })}
      </div>

      <div className="px-4 pb-2 pt-1 border-t border-white/5 text-[9px] text-muted-foreground/30 text-center">
        SofaScore · {data.status}
      </div>
    </div>
  );
}
