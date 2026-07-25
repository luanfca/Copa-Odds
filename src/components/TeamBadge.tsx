'use client';

import { useState } from 'react';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { getTeamBadgeUrl, getTeamColors } from '@/lib/teamBadges';

interface TeamBadgeProps {
  code?: string | null;
  name?: string;
  size?: number;
  className?: string;
  title?: string;
}

/**
 * Escudo de clube com container quadrado, glow na cor do time e fallback
 * de iniciais. Substitui o uso de <Flag> para clubes (que era esmagado
 * num formato 4:3 de bandeira).
 */
export function TeamBadge({ code, name, size = 48, className, title }: TeamBadgeProps) {
  const normalized = (code || '').trim().toUpperCase();
  const label = title || name || normalized || '';

  // Placeholder / sem código
  if (!normalized) {
    return <BadgeShell size={size} className={className} label={label}><Placeholder size={size} /></BadgeShell>;
  }

  const badgeUrl = getTeamBadgeUrl(normalized);
  const [failed, setFailed] = useState(false);

  if (badgeUrl && !failed) {
    return (
      <BadgeShell size={size} className={className} label={label} code={normalized}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={badgeUrl}
          alt={label}
          title={label}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.55)] transition-transform duration-300 group-hover:scale-[1.06]"
        />
      </BadgeShell>
    );
  }

  return <InitialsFallback code={normalized} name={label} size={size} className={className} />;
}

function BadgeShell({
  size,
  code,
  label,
  className,
  children,
}: {
  size: number;
  code?: string;
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  const colors = code ? getTeamColors(code) : null;
  const glow = colors ? `0 0 18px -2px ${colors.dark}` : undefined;

  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'group relative inline-flex items-center justify-center rounded-2xl overflow-hidden',
        'border border-white/10 bg-white/[0.03] shadow-inner',
        className,
      )}
      style={{
        width: size,
        height: size,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06)${glow ? `, ${glow}` : ''}`,
        background: colors
          ? `radial-gradient(circle at 50% 0%, ${colors.glow} 0%, rgba(255,255,255,0.02) 70%)`
          : undefined,
      }}
    >
      {children}
    </span>
  );
}

function InitialsFallback({ code, name, size, className }: { code: string; name: string; size: number; className?: string }) {
  const { bg, fg } = fallbackColors(code, name);
  const initials = code.slice(0, 3);
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex items-center justify-center rounded-2xl font-black uppercase tracking-tighter',
        'border border-white/10 shadow-inner',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(9, Math.round(size * 0.26)),
        backgroundColor: bg,
        color: fg,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.08), 0 0 16px -4px ${bg}`,
      }}
    >
      {initials}
    </span>
  );
}

function Placeholder({ size }: { size: number }) {
  return (
    <span
      className="flex items-center justify-center rounded-md bg-white/[0.04] font-bold text-muted-foreground/40"
      style={{ width: size * 0.7, height: size * 0.7, fontSize: Math.round(size * 0.3) }}
    >
      ?
    </span>
  );
}

function fallbackColors(code: string, name: string): { bg: string; fg: string } {
  const palette: Record<string, string> = {
    BRA: '#009c3b', ARG: '#75aadb', FRA: '#0055a4', DEU: '#111',
    ESP: '#aa151b', POR: '#006600', GBR: '#012169', ITA: '#009246',
  };
  const key = code.length > 3 ? code.slice(0, 3) : code;
  const bg = palette[key] || '#1f2937';
  const fg = bg === '#111' || bg === '#1f2937' ? '#e5e7eb' : '#fff';
  return { bg, fg };
}
