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

  // Converte código ISO 2 letras → emoji de bandeira
  return code
    .toUpperCase()
    .split('')
    .map(c => String.fromCodePoint(0x1F1E0 + c.charCodeAt(0) - 65))
    .join('');
}

/** Nomes de casas em pt-BR */
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
