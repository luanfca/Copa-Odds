'use client';

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface PlayerAvatarProps {
  name: string;
  team?: string;
  matchId?: string;
  size?: number;
  className?: string;
}

const PALETTE = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6',
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/**
 * Avatar do jogador: foto real (servida por /api/player-photo via 365scores),
 * com fallback automático para um avatar de iniciais quando a foto não existe
 * ou não carrega. Assim nunca fica quebrado. Não precisa de matchId: resolve a
 * foto pelo nome (+ seleção, quando disponível).
 */
export function PlayerAvatar({ name, team, size = 32, className }: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);
  const boxStyle: CSSProperties = { width: size, height: size };

  if (!failed) {
    const params = new URLSearchParams({ name });
    if (team) params.set('team', team);
    const src = `/api/player-photo?${params.toString()}`;
    return (
      <img
        src={src}
        alt={name}
        title={name}
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn(
          'inline-block shrink-0 rounded-full object-cover ring-1 ring-black/10 bg-slate-100',
          className
        )}
        style={boxStyle}
      />
    );
  }

  const initStyle: CSSProperties = {
    width: size,
    height: size,
    backgroundColor: colorFor(name),
    fontSize: Math.round(size * 0.38),
  };
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white ring-1 ring-black/10 select-none',
        className
      )}
      style={initStyle}
      title={name}
      aria-label={name}
    >
      {initials(name)}
    </span>
  );
}
