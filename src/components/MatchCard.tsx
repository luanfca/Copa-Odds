'use client';

import Link from 'next/link';
import { Calendar, Users, ChevronRight, Zap } from 'lucide-react';
import { formatDateTime, cn } from '@/lib/utils';
import { Flag } from '@/components/Flag';

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MatchCardProps {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeFlag?: string | null;
  awayFlag?: string | null;
  dateTime: string;
  stage: string;
  playerCount: number;
  /** Card de destaque: ocupa 2 colunas e recebe tratamento visual elevado. */
  featured?: boolean;
  /** Jogo ao vivo (já começou e ainda não encerrou). */
  isLive?: boolean;
  /** Jogo acontece hoje. */
  isToday?: boolean;
  /** Jogo já encerrado (início + 2h30 no passado). */
  isPast?: boolean;
  index?: number;
}

// ─── Constantes de fase ───────────────────────────────────────────────────────

const KNOCKOUT_STAGES = new Set([
  'Final',
  'Disputa de 3º Lugar',
  'Semifinal',
  'Quartas de Final',
  'Oitavas de Final',
]);

// ─── Badge dinâmico por contexto ─────────────────────────────────────────────

function MatchBadge({
  isLive,
  isToday,
  isPast,
  stage,
}: {
  isLive: boolean;
  isToday: boolean;
  isPast: boolean;
  stage: string;
}) {
  if (isLive) {
    return (
      <span className="match-badge badge-live">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-80 animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        Ao vivo
      </span>
    );
  }

  if (isToday) {
    return (
      <span className="match-badge badge-today">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75"
                style={{ animation: 'ping-dot 1.5s cubic-bezier(0,0,0.2,1) infinite' }} />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        Hoje
      </span>
    );
  }

  if (isPast) {
    return <span className="match-badge badge-past">Encerrado</span>;
  }

  if (stage === 'Final') {
    return <span className="match-badge badge-final">🏆 Final</span>;
  }

  if (KNOCKOUT_STAGES.has(stage)) {
    return <span className="match-badge badge-knockout">{stage}</span>;
  }

  return null;
}

// ─── MatchCard ────────────────────────────────────────────────────────────────

export function MatchCard({
  id,
  homeTeam,
  awayTeam,
  homeFlag,
  awayFlag,
  dateTime,
  stage,
  playerCount,
  featured = false,
  isLive    = false,
  isToday   = false,
  isPast    = false,
  index     = 0,
}: MatchCardProps) {
  const flagSize  = featured ? 56 : 42;
  const stageText = KNOCKOUT_STAGES.has(stage) && !isPast
    ? null // badge já mostra o stage
    : stage === 'Fase de Grupos' || stage === 'Copa do Mundo 2026'
    ? stage
    : stage;

  return (
    <Link
      href={`/matches/${id}`}
      className={cn(
        'match-card fade-in opacity-0 block',
        featured && 'featured',
        isToday && !isPast && 'today',
        isPast && 'past',
        `stagger-${Math.min(index + 1, 8)}`,
        featured ? 'p-6' : 'p-5',
      )}
      style={{ animationFillMode: 'forwards' }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex flex-col gap-1.5">
          {/* Stage label (para fase de grupos e default) */}
          {stageText && (
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-muted-foreground/60">
              {stageText}
            </span>
          )}
          {/* Badge dinâmico */}
          <MatchBadge
            isLive={isLive}
            isToday={isToday}
            isPast={isPast}
            stage={stage}
          />
        </div>

        <ChevronRight className={cn(
          'flex-shrink-0 transition-transform duration-300 text-muted-foreground/30',
          featured ? 'w-5 h-5' : 'w-4 h-4',
        )} />
      </div>

      {/* ── Times ────────────────────────────────────────────────────────── */}
      <div className={cn(
        'flex items-center justify-between',
        featured ? 'gap-6' : 'gap-4',
      )}>
        {/* Casa */}
        <TeamColumn
          name={homeTeam}
          flag={homeFlag}
          flagSize={flagSize}
          featured={featured}
        />

        {/* VS divider */}
        <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <span className={cn(
            'font-black text-muted-foreground/20 tracking-wider select-none font-mono text-center',
            featured ? 'text-xs' : 'text-[10px]'
          )}>
            VS
          </span>
          <div className={cn(
            'w-[1px] bg-gradient-to-b from-transparent via-white/10 to-transparent',
            featured ? 'h-10' : 'h-6'
          )} />
        </div>

        {/* Fora */}
        <TeamColumn
          name={awayTeam}
          flag={awayFlag}
          flagSize={flagSize}
          featured={featured}
        />
      </div>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <div className={cn(
        'flex items-center justify-between border-t border-white/5',
        featured ? 'mt-6 pt-4' : 'mt-5 pt-3.5',
      )}>
        {/* Data/hora */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground/75 font-medium">
          <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground/50" />
          <span>{formatDateTime(dateTime)}</span>
        </div>

        {/* Jogadores / odds */}
        <div className={cn(
          'flex items-center gap-1.5 text-[11px] font-bold',
          playerCount > 0 ? 'text-primary' : 'text-muted-foreground/35',
        )}>
          <Users className="w-3.5 h-3.5 flex-shrink-0 opacity-80" />
          <span>
            {playerCount > 0
              ? `${playerCount} jogador${playerCount !== 1 ? 'es' : ''}`
              : 'Sem odds'}
          </span>
        </div>
      </div>

      {/* ── Linha de destaque no bottom (featured only) ───────────────────── */}
      {featured && (
        <div className="absolute bottom-0 left-0 right-0 h-[3px] overflow-hidden rounded-b-3xl">
          <div className="h-full bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-pulse" />
        </div>
      )}

      {/* Indicador "ao vivo" no canto superior direito (live only) */}
      {isLive && (
        <div className="absolute top-4 right-4">
          <Zap className="w-3.5 h-3.5 text-rose-500 opacity-80 animate-bounce" />
        </div>
      )}
    </Link>
  );
}

// ─── TeamColumn ───────────────────────────────────────────────────────────────

function TeamColumn({
  name,
  flag,
  flagSize,
  featured,
}: {
  name: string;
  flag?: string | null;
  flagSize: number;
  featured: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 flex-1 min-w-0">
      <div className="flag-frame" style={{ width: flagSize + 8, height: flagSize + 8 }}>
        <Flag code={flag} size={flagSize} title={name} />
      </div>
      <span className={cn(
        'font-black text-foreground/90 tracking-tight leading-tight w-full text-center truncate',
        featured ? 'text-base' : 'text-xs md:text-sm'
      )}>
        {name}
      </span>
    </div>
  );
}

// ─── MatchCardSkeleton ────────────────────────────────────────────────────────

export function MatchCardSkeleton({ featured = false }: { featured?: boolean }) {
  return (
    <div className={cn(
      'match-card p-5 space-y-4 cursor-default pointer-events-none',
      featured && 'featured p-6',
    )}>
      {/* Header */}
      <div className="flex justify-between">
        <div className="skeleton h-3.5 w-20 rounded-lg" />
        <div className="skeleton h-3.5 w-6 rounded-lg" />
      </div>

      {/* Times */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col items-center gap-2 flex-1">
          <div className={cn('skeleton', featured ? 'w-16 h-16 rounded-2xl' : 'w-12 h-12 rounded-xl')} />
          <div className="skeleton h-3.5 w-20 rounded-lg" />
        </div>
        <div className="skeleton h-3.5 w-5 rounded" />
        <div className="flex flex-col items-center gap-2 flex-1">
          <div className={cn('skeleton', featured ? 'w-16 h-16 rounded-2xl' : 'w-12 h-12 rounded-xl')} />
          <div className="skeleton h-3.5 w-20 rounded-lg" />
        </div>
      </div>

      {/* Footer */}
      <div className="flex justify-between pt-4.5 border-t border-white/5">
        <div className="skeleton h-3 w-28 rounded-lg" />
        <div className="skeleton h-3 w-16 rounded-lg" />
      </div>
    </div>
  );
}
