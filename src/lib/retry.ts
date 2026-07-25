/**
 * Retry utility with exponential backoff and jitter.
 * Wraps async functions with configurable retry logic.
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  multiplier?: number;
  /** Whether to add random jitter to delay (default: true) */
  jitter?: boolean;
  /** Only retry on errors matching this predicate (default: all errors) */
  retryIf?: (error: Error) => boolean;
  /** Callback invoked before each retry with attempt info */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 2,
  jitter: true,
  retryIf: () => true,
  onRetry: () => {},
};

/** Generate a random jitter factor between 0.5 and 1.0 */
function jitterFactor(): number {
  return 0.5 + Math.random() * 0.5;
}

/**
 * Execute an async function with exponential backoff retry.
 *
 * @example
 * ```ts
 * const data = await retryWithBackoff(async () => {
 *   const res = await fetch('https://api.example.com/data');
 *   if (!res.ok) throw new Error(`HTTP ${res.status}`);
 *   return res.json();
 * }, { maxRetries: 5, baseDelayMs: 500 });
 * ```
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if predicate says so
      if (!opts.retryIf(lastError)) {
        throw lastError;
      }

      // Last attempt — rethrow
      if (attempt === opts.maxRetries) {
        throw lastError;
      }

      // Calculate delay with exponential backoff + jitter
      const rawDelay = opts.baseDelayMs * Math.pow(opts.multiplier, attempt);
      const delay = Math.min(rawDelay, opts.maxDelayMs);
      const finalDelay = opts.jitter ? delay * jitterFactor() : delay;

      opts.onRetry(lastError, attempt + 1, finalDelay);

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, finalDelay));
    }
  }

  // Should not reach here, but TypeScript needs it
  throw lastError ?? new Error('retryWithBackoff: unexpected state');
}

/**
 * Retry a fetch call specifically, with HTTP status code awareness.
 */
export interface FetchRetryOptions extends RetryOptions {
  /** HTTP status codes that should trigger a retry (default: [500, 502, 503, 504]) */
  retryStatusCodes?: number[];
}

export async function retryFetch(
  url: string,
  init?: RequestInit,
  options?: FetchRetryOptions,
): Promise<Response> {
  const opts: Required<FetchRetryOptions> = {
    ...DEFAULT_OPTIONS,
    ...(options ?? {}),
    retryStatusCodes: options?.retryStatusCodes ?? [500, 502, 503, 504],
  };

  return retryWithBackoff(
    async () => {
      const response = await fetch(url, init);
      if (opts.retryStatusCodes.includes(response.status)) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    },
    {
      maxRetries: opts.maxRetries,
      baseDelayMs: opts.baseDelayMs,
      maxDelayMs: opts.maxDelayMs,
      multiplier: opts.multiplier,
      jitter: opts.jitter,
      retryIf: (error) => {
        // Only retry network errors or specific HTTP status codes
        if (error.message.startsWith('HTTP')) {
          return opts.retryStatusCodes.some((code) => error.message.includes(String(code)));
        }
        // Network errors (fetch throws for DNS, connection refused, etc.)
        return true;
      },
      onRetry: opts.onRetry,
    },
  );
}
