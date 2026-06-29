import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

// Larguras de imagem disponíveis no flagcdn.com
const FLAGCDN_WIDTHS = [20, 40, 80, 160, 320, 640];

function nearestCdnWidth(px: number): number {
  for (const w of FLAGCDN_WIDTHS) {
    if (w >= px) return w;
  }
  return FLAGCDN_WIDTHS[FLAGCDN_WIDTHS.length - 1];
}

interface FlagProps {
  /** Código ISO do país (ex.: "BR", "FR", "GB-ENG"). */
  code?: string | null;
  /** Largura renderizada em px. A imagem é buscada em ~2x para ficar nítida. */
  size?: number;
  className?: string;
  /** Texto acessível (nome da seleção). */
  title?: string;
}

/**
 * Bandeira de seleção renderizada como imagem (flagcdn.com).
 *
 * Usamos imagem em vez de emoji porque o Windows não renderiza emojis de
 * bandeira de país — eles aparecem como quadradinhos/código. As imagens
 * funcionam em qualquer sistema operacional e navegador.
 */
export function Flag({ code, size = 32, className, title }: FlagProps) {
  const normalized = (code || '').trim().toLowerCase();
  const height = Math.round((size * 3) / 4);
  const boxStyle: CSSProperties = { width: size, height };

  // Sem código conhecido → placeholder neutro (sem depender de emoji).
  if (!normalized) {
    return (
      <span
        className={cn(
          'inline-flex items-center justify-center rounded-[3px] bg-muted text-[10px] font-bold text-muted-foreground ring-1 ring-black/10',
          className
        )}
        style={boxStyle}
        role="img"
        aria-label={title || 'Bandeira indisponível'}
      >
        ?
      </span>
    );
  }

  const cdnWidth = nearestCdnWidth(size * 2);
  const src = 'https://flagcdn.com/w' + cdnWidth + '/' + normalized + '.png';

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={title || code || ''}
      title={title}
      loading="lazy"
      className={cn(
        'inline-block rounded-[3px] object-cover shadow-md ring-1 ring-black/10',
        className
      )}
      style={boxStyle}
    />
  );
}
