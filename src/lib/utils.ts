/**
 * Utilitários para componentes shadcn/ui
 */
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Formata data/hora em pt-BR */
export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  }).format(date);
}

/** Formata odd decimal */
export function formatOdd(value: number): string {
  return value.toFixed(2);
}

/** Emoji de bandeira por código ISO */
export function flagEmoji(code: string): string {
  if (!code) return '🏳️';

  // Trata casos especiais
  const overrides: Record<string, string> = {
    'GB-ENG': '󠁧󠁢󠁥󠁮󠁧󠁿🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    'GB-SCT': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    'GB-WLS': '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  };
  if (overrides[code]) return overrides[code];

  // Normaliza código: tenta extrair as 2 primeiras letras maiúsculas
  const normalized = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
  if (normalized.length !== 2) return '🏳️';

  // Converte código ISO 2 letras → emoji de bandeira
  return normalized
    .split('')
    .map(c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65))
    .join('');
}

/** Nomes de casas em pt-BR (só as 4 ativas) */
export const HOUSE_LABELS: Record<string, string> = {
  betfair: 'Betfair',
  betmgm: 'BetMGM',
  superbet: 'Superbet',
  pitaco: 'Pitaco',
};

export const HOUSE_COLORS: Record<string, string> = {
  betfair: '#F6C543',
  betmgm: '#4A90E2',
  superbet: '#E84A5F',
  pitaco: '#00C853',
};

/**
 * Casas exibidas nas tabelas comparativas.
 * Só as 4 que de fato coletam: Betfair, BetMGM, Superbet, Pitaco.
 */
export const ALL_HOUSES = [
  'betfair',
  'betmgm',
  'superbet',
  'pitaco',
] as const;

export type HouseKey = (typeof ALL_HOUSES)[number];

/** Whitelist de casas ativas (API + UI) */
export const ACTIVE_HOUSES = new Set<string>(ALL_HOUSES);
