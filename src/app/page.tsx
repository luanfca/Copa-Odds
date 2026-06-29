'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { MatchCard, MatchCardSkeleton } from '@/components/MatchCard';
import {
  Trophy, Frown, RefreshCw, Eye, EyeOff,
  Swords, Zap, Clock, ChevronDown, Activity, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Match {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeFlag: string | null;
  awayFlag: string | null;
  dateTime: string;
  stage: string;
  playerCount: number;
}

interface ApiResponse {
  matches: Match[];
  mock: boolean;
  lastUpdated: string | null;
  scrapeStatus: string | null;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Janela de "jogo encerrado": início + 3h30 (cobre prorrogação + pênaltis). */
const FINISHED_AFTER_MS = 3.5 * 60 * 60 * 1000;

/** Fases eliminatórias — recebem tratamento visual dourado. */
const KNOCKOUT_STAGES = new Set([
  'Final',
  'Disputa de 3º Lugar',
  'Semifinal',
  'Quartas de Final',
  'Oitavas de Final',
]);

/** Ordem de exibição das fases (mais importante primeiro). */
const STAGE_ORDER = [
  'Final',
  'Disputa de 3º Lugar',
  'Semifinal',
  'Quartas de Final',
  'Oitavas de Final',
  'Fase de Grupos',
  'Copa do Mundo 2026',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMatchFinished(m: Match): boolean {
  const t = new Date(m.dateTime).getTime();
  return !Number.isNaN(t) && t + FINISHED_AFTER_MS < Date.now();
}

function isMatchToday(m: Match): boolean {
  return new Date(m.dateTime).toDateString() === new Date().toDateString();
}

function isMatchLive(m: Match): boolean {
  const t = new Date(m.dateTime).getTime();
  const now = Date.now();
  return !Number.isNaN(t) && t <= now && now < t + FINISHED_AFTER_MS;
}

/** Formata "há Xmin" / "há Xh" / "há Xd" */
function relativeTime(isoDate: string | null): string {
  if (!isoDate) return '—';
  const diff = Date.now() - new Date(isoDate).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min}min`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `há ${hrs}h`;
  return `há ${Math.floor(hrs / 24)}d`;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function HomePage() {
  const [data, setData]         = useState<ApiResponse | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [stageFilter, setStageFilter] = useState<string>('Todos');

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/matches', { cache: 'no-store' });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Derivações ─────────────────────────────────────────────────────────────

  const allMatches  = data?.matches ?? [];
  const pastMatches = useMemo(() => allMatches.filter(isMatchFinished), [allMatches]);
  const liveCount   = useMemo(() => allMatches.filter(isMatchLive).length, [allMatches]);
  const todayCount  = useMemo(() => allMatches.filter(isMatchToday).length, [allMatches]);

  /** Jogos visíveis depois do toggle "mostrar encerrados". */
  const baseMatches = useMemo(
    () => showPast ? allMatches : allMatches.filter(m => !isMatchFinished(m)),
    [allMatches, showPast],
  );

  /** Fases únicas presentes nos dados (ordenadas). */
  const availableStages = useMemo(() => {
    const stages = Array.from(new Set(baseMatches.map(m => m.stage)));
    return stages.sort((a, b) => STAGE_ORDER.indexOf(a) - STAGE_ORDER.indexOf(b));
  }, [baseMatches]);

  /** Jogos após filtro de fase. */
  const visibleMatches = useMemo(() => {
    if (stageFilter === 'Todos') return baseMatches;
    return baseMatches.filter(m => m.stage === stageFilter);
  }, [baseMatches, stageFilter]);

  /**
   * Identifica os 2 primeiros jogos de hoje (mais próximos do horário atual)
   * para tratamento "featured" (card 2-col).
   */
  const featuredIds = useMemo(() => {
    const todayMatches = visibleMatches
      .filter(isMatchToday)
      .sort((a, b) => {
        const now = Date.now();
        const da = Math.abs(new Date(a.dateTime).getTime() - now);
        const db = Math.abs(new Date(b.dateTime).getTime() - now);
        return da - db;
      })
      .slice(0, 2)
      .map(m => m.id);
    return new Set(todayMatches);
  }, [visibleMatches]);

  // Reseta o filtro de fase quando os dados mudam e a fase selecionada deixa de existir
  useEffect(() => {
    if (stageFilter !== 'Todos' && !availableStages.includes(stageFilter)) {
      setStageFilter('Todos');
    }
  }, [availableStages, stageFilter]);

  // ── KPI: status ative houses ───────────────────────────────────────────────
  const statusLabel = useMemo(() => {
    if (!data) return null;
    if (data.scrapeStatus === 'success') return { text: '4 casas ativas', color: 'text-emerald-400' };
    if (data.scrapeStatus === 'partial') return { text: 'Coleta parcial', color: 'text-amber-400' };
    if (data.scrapeStatus === 'failed')  return { text: '0 casas ativas', color: 'text-rose-400' };
    return null;
  }, [data]);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-1 sm:px-4 py-2">
      
      {/* ── Cabeçalho Premium & KPIs ───────────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-white/5 slide-up" style={{ animationFillMode: 'forwards' }}>
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/8 border border-primary/15 text-[10px] font-black uppercase tracking-widest text-primary shadow-sm">
            <Sparkles className="w-3 h-3 animate-spin" style={{ animationDuration: '4s' }} />
            Monitoramento Copa 2026
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight flex items-center gap-2">
            <span>COPA</span>
            <span className="hero-gradient-text">ODDS</span>
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground font-medium max-w-lg">
            Compare odds de desarmes, faltas cometidas e faltas sofridas em tempo real de Betfair, BetMGM e Superbet.
          </p>
        </div>

        {/* KPIs Grid */}
        {!loading && !error && (
          <div className="flex flex-wrap sm:flex-nowrap gap-3 items-center">
            {/* Jogos hoje / ao vivo */}
            <div className="kpi-pill kpi-games flex-1 sm:flex-none min-w-[130px]">
              <div className="kpi-icon">
                {liveCount > 0 ? (
                  <Zap className="w-4 h-4 text-sky-400 animate-pulse" />
                ) : (
                  <Swords className="w-4 h-4 text-sky-400" />
                )}
              </div>
              <div className="flex flex-col">
                <span className="kpi-value text-sky-400">
                  {liveCount > 0 ? liveCount : todayCount}
                </span>
                <span className="kpi-label">
                  {liveCount > 0 ? 'Ao vivo agora' : 'Jogos hoje'}
                </span>
              </div>
              {liveCount > 0 && (
                <span className="absolute top-2 right-2 flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-sky-400" />
                </span>
              )}
            </div>

            {/* Casas ativas */}
            {statusLabel && (
              <div className="kpi-pill kpi-status flex-1 sm:flex-none min-w-[130px]">
                <div className="kpi-icon">
                  <Activity className="w-4 h-4 text-primary" />
                </div>
                <div className="flex flex-col">
                  <span className={cn('kpi-value', statusLabel.color)}>
                    {statusLabel.text.split(' ')[0]}
                  </span>
                  <span className="kpi-label">casas ativas</span>
                </div>
              </div>
            )}

            {/* Última coleta */}
            <div className="kpi-pill kpi-time flex-1 sm:flex-none min-w-[130px]">
              <div className="kpi-icon">
                <Clock className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex flex-col">
                <span className="kpi-value text-amber-400">
                  {relativeTime(data?.lastUpdated ?? null)}
                </span>
                <span className="kpi-label">última coleta</span>
              </div>
            </div>

            {/* Modo Demo */}
            {data?.mock && (
              <div className="kpi-pill flex-1 sm:flex-none border-amber-500/25 bg-amber-500/5 min-w-[100px] justify-center">
                <span className="text-[10px] font-black text-amber-400 tracking-widest uppercase">
                  MODO DEMO
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Filtros por Tabs e Toggle de Encerrados ────────────────────────── */}
      {!loading && !error && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 slide-up" style={{ animationFillMode: 'forwards', animationDelay: '0.05s' }}>
          
          {/* Abas */}
          {availableStages.length > 1 && (
            <div className="stage-tabs">
              <button
                onClick={() => setStageFilter('Todos')}
                className={cn('stage-tab', stageFilter === 'Todos' && 'active')}
              >
                <Trophy className="w-3.5 h-3.5" />
                Todos
                <span className="tab-count">{baseMatches.length}</span>
              </button>

              {availableStages.map(stage => {
                const count = baseMatches.filter(m => m.stage === stage).length;
                const isKnockout = KNOCKOUT_STAGES.has(stage);
                return (
                  <button
                    key={stage}
                    onClick={() => setStageFilter(stage)}
                    className={cn(
                      'stage-tab',
                      stageFilter === stage && 'active',
                      isKnockout && 'stage-knockout',
                    )}
                  >
                    {stage}
                    <span className="tab-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Toggle de Encerrados */}
          {pastMatches.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={() => setShowPast(v => !v)}
                className={cn(
                  'btn-ghost text-xs gap-2',
                  showPast && 'text-primary bg-primary/5 border-primary/20'
                )}
                title={showPast ? 'Ocultar jogos encerrados' : 'Mostrar jogos encerrados'}
              >
                {showPast ? (
                  <EyeOff className="w-4 h-4 text-primary" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
                <span>
                  {showPast ? 'Ocultar encerrados' : `Exibir encerrados (${pastMatches.length})`}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Grid Principal de Jogos ────────────────────────────────────────── */}
      {loading ? (
        <SkeletonGrid />
      ) : error ? (
        <ErrorState error={error} onRetry={load} />
      ) : visibleMatches.length === 0 ? (
        <EmptyState
          hasMatches={allMatches.length > 0}
          pastCount={pastMatches.length}
          onShowPast={() => setShowPast(true)}
          onReload={load}
          hasStageFilter={stageFilter !== 'Todos'}
          onClearFilter={() => setStageFilter('Todos')}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 slide-up" style={{ animationFillMode: 'forwards', animationDelay: '0.12s' }}>
          {visibleMatches.map((match, idx) => (
            <MatchCard
              key={match.id}
              {...match}
              index={idx}
              featured={featuredIds.has(match.id)}
              isLive={isMatchLive(match)}
              isToday={isMatchToday(match)}
              isPast={isMatchFinished(match)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
      {Array.from({ length: 8 }, (_, i) => (
        <MatchCardSkeleton key={i} featured={i < 2} />
      ))}
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-6 rounded-3xl border border-white/5 bg-card/10 backdrop-blur-xl">
      <div className="w-16 h-16 rounded-2xl bg-rose-500/8 border border-rose-500/20 flex items-center justify-center">
        <Frown className="w-8 h-8 text-rose-400" />
      </div>
      <div className="text-center space-y-1.5">
        <p className="text-foreground/90 font-bold text-lg">Falha de conexão com os dados</p>
        <p className="text-muted-foreground text-sm max-w-sm">{error}</p>
      </div>
      <button onClick={onRetry} className="btn-primary gap-2">
        <RefreshCw className="w-4 h-4 animate-spin-hover" />
        Tentar Novamente
      </button>
    </div>
  );
}

function EmptyState({
  hasMatches,
  pastCount,
  onShowPast,
  onReload,
  hasStageFilter,
  onClearFilter,
}: {
  hasMatches: boolean;
  pastCount: number;
  onShowPast: () => void;
  onReload: () => void;
  hasStageFilter: boolean;
  onClearFilter: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-28 gap-6 rounded-3xl border border-white/5 bg-card/10 backdrop-blur-xl">
      <div className="w-20 h-20 rounded-2xl bg-muted/40 border border-white/5 flex items-center justify-center shadow-inner">
        <Trophy className="w-10 h-10 text-muted-foreground/30 animate-pulse" />
      </div>

      {hasStageFilter ? (
        <>
          <div className="text-center space-y-2 max-w-xs">
            <h2 className="text-xl font-extrabold text-foreground/80">Sem jogos nesta fase</h2>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Não existem partidas em aberto cadastradas para a fase selecionada neste momento.
            </p>
          </div>
          <button onClick={onClearFilter} className="btn-secondary gap-2">
            <ChevronDown className="w-4 h-4" />
            Exibir Todas as Fases
          </button>
        </>
      ) : hasMatches ? (
        <>
          <div className="text-center space-y-2 max-w-xs">
            <h2 className="text-xl font-extrabold text-foreground/80">Partidas Concluídas</h2>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Todos os jogos disponíveis já foram finalizados. Você pode visualizá-los ativando a exibição de históricos.
            </p>
          </div>
          <button onClick={onShowPast} className="btn-primary gap-2">
            <Eye className="w-4 h-4" />
            Exibir Encerrados ({pastCount})
          </button>
        </>
      ) : (
        <>
          <div className="text-center space-y-2 max-w-sm">
            <h2 className="text-xl font-extrabold text-foreground/80">Nenhum dado encontrado</h2>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Nenhum mercado de desarmes ou faltas foi coletado ainda. Inicie a varredura manual de odds para popular o sistema.
            </p>
          </div>
          <button onClick={onReload} className="btn-secondary gap-2">
            <RefreshCw className="w-4 h-4" />
            Recarregar Painel
          </button>
        </>
      )}
    </div>
  );
}
