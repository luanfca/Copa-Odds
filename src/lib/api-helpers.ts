/**
 * Exemplo de uso do retry e circuit breaker nas API routes.
 * 
 * Este arquivo demonstra como integrar as melhorias #4 (Retry e Circuit Breaker)
 * nas rotas existentes.
 */

import { retryWithBackoff } from '@/lib/retry';
import { CircuitBreaker } from '@/lib/circuit-breaker';
import { logger } from './logger';

// Instanciar circuit breakers para cada serviço externo
export const sofaScoreBreaker = new CircuitBreaker({
  failureThreshold: 5,
  recoveryTimeoutMs: 30000,
});

export const fotMobBreaker = new CircuitBreaker({
  failureThreshold: 3,
  recoveryTimeoutMs: 60000,
});

export const thirtSixScoresBreaker = new CircuitBreaker({
  failureThreshold: 4,
  recoveryTimeoutMs: 45000,
});

/**
 * Exemplo: Fetch com retry e circuit breaker
 */
export async function fetchWithRetryAndBreaker<T>(
  fn: () => Promise<T>,
  breaker: CircuitBreaker,
  options?: { maxAttempts?: number; baseDelay?: number },
): Promise<T> {
  return breaker.execute(async () => {
    return retryWithBackoff(fn, {
      maxRetries: options?.maxAttempts ?? 3,
      baseDelayMs: options?.baseDelay ?? 1000,
      onRetry: (error, attempt) => {
        logger.warn(`[Retry] Tentativa ${attempt} falhou: ${error.message}`);
      },
    });
  });
}

/**
 * Exemplo de uso:
 * 
 * ```ts
 * const data = await fetchWithRetryAndBreaker(
 *   () => fetch('https://api.sofascore.com/...').then(r => r.json()),
 *   sofaScoreBreaker,
 *   { maxAttempts: 3, baseDelay: 2000 }
 * );
 * ```
 */
