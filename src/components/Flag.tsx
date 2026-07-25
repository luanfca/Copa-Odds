'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { getTeamBadgeUrl } from '@/lib/teamBadges';
import { TeamBadge } from '@/components/TeamBadge';

// ─── Configuração de CDN de Bandeiras ────────────────────────────────────────

const FLAGCDN_WIDTHS = [20, 40, 80, 160, 320, 640];

function nearestCdnWidth(px: number): number {
  for (const w of FLAGCDN_WIDTHS) {
    if (w >= px) return w;
  }
  return FLAGCDN_WIDTHS[FLAGCDN_WIDTHS.length - 1];
}

// ─── Fallback: Iniciais e Cores dos Clubes ───────────────────────────────────

const CLUB_INITIALS: Record<string, string> = {
  'BOT': 'BOT', 'FLA': 'FLA', 'FLU': 'FLU', 'VAS': 'VAS',
  'COR': 'COR', 'PAL': 'PAL', 'SAO': 'SAO', 'SAN': 'SAN',
  'INT': 'INT', 'GRE': 'GRE', 'CAM': 'CAM', 'CRU': 'CRU',
  'AMM': 'AMÉ', 'CAP': 'CAP', 'CTB': 'CTB',
  'BAH': 'BAH', 'VIT': 'VIT', 'FOR': 'FOR', 'CEA': 'CEA',
  'SPT': 'SPT', 'NAU': 'NAU', 'GOI': 'GOI', 'CUI': 'CUI',
  'CHA': 'CHA', 'AVA': 'AVA', 'CRI': 'CRI', 'BRU': 'BRU',
  'JUV': 'JUV', 'MIR': 'MIR', 'RBB': 'BRA',
};

const CLUB_COLORS: Record<string, string> = {
  'BOT': '#1a1a1a', 'FLA': '#cc0000', 'FLU': '#7a0032', 'VAS': '#000000',
  'COR': '#000000', 'PAL': '#006437', 'SAO': '#cc0000', 'SAN': '#000000',
  'INT': '#cc0000', 'GRE': '#0066b3', 'CAM': '#000000', 'CRU': '#0033a0',
  'CAP': '#cc0000', 'BAH': '#0033a0', 'VIT': '#cc0000', 'FOR': '#0033a0',
  'CEA': '#0033a0', 'SPT': '#cc0000', 'GOI': '#007733', 'CUI': '#006633',
  'CHA': '#007733', 'AVA': '#0033a0', 'CRI': '#ffcc00', 'JUV': '#007733',
  'MIR': '#cc0000', 'RBB': '#cc0000',
  // MLS
  'MIA': '#f5a3c7', 'LAG': '#002d62', 'LAF': '#000000',
  'NYC': '#6cabdd', 'NYR': '#cc0000', 'ATL': '#231f20',
  'SEA': '#5d9732', 'POR': '#004812', 'CLB': '#fdda25',
  'CIN': '#ff5000', 'ORL': '#612b9e', 'NAS': '#fde101',
  'AUS': '#00b140', 'DAL': '#c8102e', 'HOU': '#ef6b20',
  'CHI': '#cc0000', 'TOR': '#dd2233', 'VAN': '#00538b',
  'MTL': '#0077b6', 'COL': '#8c2131', 'RSL': '#b30838',
  'SKC': '#93b1d7', 'MIN': '#cce100', 'STL': '#003f72',
  'SJ': '#003876', 'PHI': '#b1874b', 'DCU': '#000000',
  'CLT': '#1e6b3e', 'NER': '#ce1126',
};

const ISO_COUNTRY_REGEX = /^[a-z]{2}(-[a-z]{2,4})?$/;

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FlagProps {
  code?: string | null;
  size?: number;
  className?: string;
  title?: string;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function Flag({ code, size = 32, className, title }: FlagProps) {
  const normalized = (code || '').trim().toLowerCase();
  const height = Math.round(size * 0.75);
  const boxStyle: CSSProperties = { width: size, height };

  // ── Placeholder (sem código) ──
  if (!normalized) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-[3px] bg-muted text-[10px] font-bold text-muted-foreground ring-1 ring-black/10',
          className,
        )}
        style={boxStyle}
        role="img"
        aria-label={title || 'Bandeira indisponível'}
      >
        ?
      </span>
    );
  }

  // ── Bandeira de País (ISO) → flagcdn ──
  if (ISO_COUNTRY_REGEX.test(normalized)) {
    const cdnWidth = nearestCdnWidth(size * 2);
    const src = `https://flagcdn.com/w${cdnWidth}/${normalized}.png`;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={title || code || ''}
        title={title}
        loading="lazy"
        className={cn(
          'inline-block rounded-[3px] object-cover shadow-md ring-1 ring-black/10',
          className,
        )}
        style={boxStyle}
      />
    );
  }

  // ── Escudo de Clube (código 3-letras) → novo componente dedicado ──
  const codeUpper = normalized.toUpperCase();
  if (getTeamBadgeUrl(codeUpper)) {
    return (
      <TeamBadge
        code={codeUpper}
        name={title || code || ''}
        size={size}
        className={className}
        title={title}
      />
    );
  }

  // ── Fallback: iniciais coloridas ──
  const initials = CLUB_INITIALS[codeUpper] || codeUpper.slice(0, 3);
  const bgColor = CLUB_COLORS[codeUpper] || '#333';

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-[3px] font-extrabold text-white ring-1 ring-black/20 shadow-md',
        'text-[9px] leading-none tracking-tight',
        className,
      )}
      style={{ ...boxStyle, backgroundColor: bgColor }}
      role="img"
      aria-label={title || code || ''}
      title={title}
    >
      {initials}
    </span>
  );
}

// ─── Sub-componente: Imagem do escudo com fallback ───────────────────────────

function ClubBadgeImage() {
  return null;
}
