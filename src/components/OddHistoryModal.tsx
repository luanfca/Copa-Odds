'use client';

import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { cn, HOUSE_COLORS, HOUSE_LABELS } from '@/lib/utils';

interface HistoryPoint {
  date: string;
  line: string;
  betfair?: number;
  betmgm?: number;
  superbet?: number;
  pitaco?: number;
}

interface OddHistoryModalProps {
  playerId: string;
  playerName: string;
  house: string;
  line: string;
  onClose: () => void;
}

export function OddHistoryModal({
  playerId,
  playerName,
  house,
  line,
  onClose,
}: OddHistoryModalProps) {
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/history/${playerId}`)
      .then(r => r.json())
      .then(d => setHistory(d.history || []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [playerId]);

  // Filtra para a linha selecionada
  const lineHistory = history.filter(h => h.line === line || !h.line);
  const latestTwo = lineHistory.slice(-2);
  const latest = latestTwo[1] || latestTwo[0];
  const prev = latestTwo[0];

  const houseKey = house as 'betfair' | 'betmgm' | 'superbet' | 'pitaco';
  const currentVal = latest?.[houseKey];
  const prevVal = prev?.[houseKey];

  const trend =
    currentVal === undefined || prevVal === undefined ? null
    : currentVal > prevVal ? 'up'
    : currentVal < prevVal ? 'down'
    : 'stable';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'hsl(0 0% 0% / 0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="scale-in bg-card border border-border/50 rounded-2xl w-full max-w-2xl
                       shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between p-6 border-b border-border/30">
          <div>
            <h3 className="font-bold text-lg text-foreground">{playerName}</h3>
            <div className="flex items-center gap-2 mt-1">
              <span
                className="text-sm font-semibold"
                style={{ color: HOUSE_COLORS[house] }}
              >
                {HOUSE_LABELS[house]}
              </span>
              <span className="text-muted-foreground text-sm">·</span>
              <span className="text-sm text-muted-foreground">{line} desarme{line !== '1+' ? 's' : ''}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Indicador de tendência */}
            {trend && (
              <div className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold',
                trend === 'up' && 'bg-primary/10 text-primary',
                trend === 'down' && 'bg-red-500/10 text-red-400',
                trend === 'stable' && 'bg-muted/50 text-muted-foreground',
              )}>
                {trend === 'up' && <><TrendingUp className="w-4 h-4" /> +{((currentVal! - prevVal!) / prevVal! * 100).toFixed(1)}%</>}
                {trend === 'down' && <><TrendingDown className="w-4 h-4" /> {((currentVal! - prevVal!) / prevVal! * 100).toFixed(1)}%</>}
                {trend === 'stable' && <><Minus className="w-4 h-4" /> Estável</>}
              </div>
            )}

            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                         hover:bg-muted/50 transition-colors text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Gráfico */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <div className="flex gap-2">
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: `${i * 0.1}s` }}
                  />
                ))}
              </div>
            </div>
          ) : lineHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3">
              <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
                <TrendingUp className="w-6 h-6 text-muted-foreground/50" />
              </div>
              <p className="text-muted-foreground text-sm text-center">
                Histórico disponível após a segunda coleta diária.
                <br />
                Dados acumulam com o tempo.
              </p>
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={lineHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220 20% 16%)" />
                <XAxis
                  dataKey="date"
                  tick={{ fill: 'hsl(215 20% 50%)', fontSize: 11 }}
                  tickFormatter={(v) => new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                />
                <YAxis
                  tick={{ fill: 'hsl(215 20% 50%)', fontSize: 11 }}
                  domain={['dataMin - 0.1', 'dataMax + 0.1']}
                  tickFormatter={(v) => v.toFixed(2)}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(220 20% 9%)',
                    border: '1px solid hsl(220 20% 16%)',
                    borderRadius: '8px',
                    color: 'hsl(210 40% 96%)',
                  }}
                  formatter={(v: number, name: string) => [v.toFixed(2), HOUSE_LABELS[name] || name]}
                  labelFormatter={(l) => new Date(l).toLocaleDateString('pt-BR')}
                />
                <Legend
                  formatter={(name) => (
                    <span style={{ color: HOUSE_COLORS[name] || '#fff', fontSize: 12 }}>
                      {HOUSE_LABELS[name] || name}
                    </span>
                  )}
                />
                <Line
                  type="monotone" dataKey="betfair"
                  stroke={HOUSE_COLORS.betfair} strokeWidth={2}
                  dot={{ fill: HOUSE_COLORS.betfair, strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6 }} connectNulls
                />
                <Line
                  type="monotone" dataKey="betmgm"
                  stroke={HOUSE_COLORS.betmgm} strokeWidth={2}
                  dot={{ fill: HOUSE_COLORS.betmgm, strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6 }} connectNulls
                />
                <Line
                  type="monotone" dataKey="superbet"
                  stroke={HOUSE_COLORS.superbet} strokeWidth={2}
                  dot={{ fill: HOUSE_COLORS.superbet, strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6 }} connectNulls
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Tabela de valores */}
        {lineHistory.length > 0 && (
          <div className="px-6 pb-6">
            <div className="rounded-xl border border-border/30 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/30 border-b border-border/30">
                    <th className="px-4 py-2 text-left text-xs text-muted-foreground font-semibold">Data</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold" style={{ color: HOUSE_COLORS.betfair }}>Betfair</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold" style={{ color: HOUSE_COLORS.betmgm }}>BetMGM</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold" style={{ color: HOUSE_COLORS.superbet }}>Superbet</th>
                  </tr>
                </thead>
                <tbody>
                  {lineHistory.slice(-7).map((h, i) => (
                    <tr key={i} className="border-b border-border/20 last:border-0 hover:bg-muted/10">
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {new Date(h.date).toLocaleDateString('pt-BR')}
                      </td>
                      {(['betfair', 'betmgm', 'superbet', 'pitaco'] as const).map(hk => (
                        <td key={hk} className="px-4 py-2 text-center font-mono font-medium">
                          {h[hk] ? (
                            <span className={cn(hk === houseKey && 'text-primary font-bold')}>
                              {h[hk]!.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/30">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
