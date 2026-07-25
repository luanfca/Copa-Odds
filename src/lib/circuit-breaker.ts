/**
 * Circuit Breaker pattern implementation.
 * Prevents cascading failures by stopping requests to a failing service
 * and gradually testing recovery.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Requests are immediately rejected (service is failing)
 * - HALF_OPEN: One test request allowed through to check recovery
 */

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit (default: 5) */
  failureThreshold?: number;
  /** Time in ms to wait before trying half-open (default: 30000) */
  recoveryTimeoutMs?: number;
  /** Number of successful calls in half-open before closing (default: 2) */
  successThreshold?: number;
  /** Monitor name for logging (default: 'unnamed') */
  name?: string;
}

interface CircuitMetrics {
  failureCount: number;
  successCount: number;
  lastFailureTime: number | null;
  state: CircuitState;
  totalCalls: number;
  totalFailures: number;
  totalSuccesses: number;
}

export class CircuitBreaker {
  private metrics: CircuitMetrics;
  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly successThreshold: number;
  private readonly name: string;

  constructor(options: CircuitBreakerOptions = {}) {
    this.name = options.name ?? 'unnamed';
    this.failureThreshold = options.failureThreshold ?? 5;
    this.recoveryTimeoutMs = options.recoveryTimeoutMs ?? 30000;
    this.successThreshold = options.successThreshold ?? 2;

    this.metrics = {
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      state: 'closed',
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    };
  }

  /** Get current state */
  get state(): CircuitState {
    return this.metrics.state;
  }

  /** Get current metrics */
  get metricsSnapshot() {
    return { ...this.metrics };
  }

  /** Get formatted metrics for dashboard */
  get dashboardMetrics() {
    return {
      name: this.name,
      state: this.metrics.state,
      failureCount: this.metrics.failureCount,
      successCount: this.metrics.successCount,
      totalCalls: this.metrics.totalCalls,
      totalFailures: this.metrics.totalFailures,
      totalSuccesses: this.metrics.totalSuccesses,
      failureRate: this.metrics.totalCalls > 0
        ? ((this.metrics.totalFailures / this.metrics.totalCalls) * 100).toFixed(1)
        : '0.0',
      lastFailureTime: this.metrics.lastFailureTime
        ? new Date(this.metrics.lastFailureTime).toISOString()
        : null,
    };
  }

  /** Reset the circuit breaker to closed state */
  reset(): void {
    this.metrics = {
      failureCount: 0,
      successCount: 0,
      lastFailureTime: null,
      state: 'closed',
      totalCalls: 0,
      totalFailures: 0,
      totalSuccesses: 0,
    };
  }

  /** Manually trip the circuit to open state */
  trip(): void {
    this.metrics.state = 'open';
    this.metrics.lastFailureTime = Date.now();
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws CircuitOpenError if the circuit is open and recovery timeout hasn't passed.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.metrics.totalCalls++;

    // Check if we should transition from OPEN to HALF_OPEN
    if (this.metrics.state === 'open') {
      const timeSinceLastFailure = this.metrics.lastFailureTime
        ? Date.now() - this.metrics.lastFailureTime
        : Infinity;

      if (timeSinceLastFailure >= this.recoveryTimeoutMs) {
        this.metrics.state = 'half_open';
        this.metrics.successCount = 0;
      } else {
        throw new CircuitOpenError(this.name, this.recoveryTimeoutMs - timeSinceLastFailure);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.metrics.successCount++;
    this.metrics.totalSuccesses++;

    if (this.metrics.state === 'half_open') {
      if (this.metrics.successCount >= this.successThreshold) {
        this.metrics.state = 'closed';
        this.metrics.failureCount = 0;
        this.metrics.successCount = 0;
      }
    } else {
      // Closed state — reset failure count on success
      this.metrics.failureCount = 0;
      this.metrics.successCount = 0;
    }
  }

  private onFailure(): void {
    this.metrics.failureCount++;
    this.metrics.totalFailures++;
    this.metrics.lastFailureTime = Date.now();

    if (this.metrics.state === 'half_open') {
      // Any failure in half_open goes back to open
      this.metrics.state = 'open';
      this.metrics.successCount = 0;
    } else if (this.metrics.failureCount >= this.failureThreshold) {
      this.metrics.state = 'open';
    }
  }
}

/** Error thrown when the circuit is open */
export class CircuitOpenError extends Error {
  constructor(
    public readonly name: string,
    public readonly retryAfterMs: number,
  ) {
    super(
      `Circuit breaker '${name}' is OPEN. Retry after ${Math.ceil(retryAfterMs / 1000)}s.`,
    );
    this.name = 'CircuitOpenError';
  }
}

/** Registry of all circuit breakers for monitoring */
const breakerRegistry = new Map<string, CircuitBreaker>();

/**
 * Get or create a named circuit breaker.
 */
export function getOrCreateBreaker(name: string, options?: CircuitBreakerOptions): CircuitBreaker {
  const existing = breakerRegistry.get(name);
  if (existing) return existing;

  const breaker = new CircuitBreaker({ ...options, name });
  breakerRegistry.set(name, breaker);
  return breaker;
}

/** Get all registered breakers' metrics for dashboard */
export function getAllBreakerMetrics(): Record<string, CircuitBreaker['dashboardMetrics']> {
  const result: Record<string, CircuitBreaker['dashboardMetrics']> = {};
  for (const [name, breaker] of breakerRegistry) {
    result[name] = breaker.dashboardMetrics;
  }
  return result;
}

/** Reset all breakers in the registry */
export function resetAllBreakers(): void {
  for (const breaker of breakerRegistry.values()) {
    breaker.reset();
  }
}
