/**
 * Mock for @kysera/infra
 */

import { vi } from 'vitest';

// Transient error codes that should trigger retries
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'ER_LOCK_WAIT_TIMEOUT',
  'ER_LOCK_DEADLOCK',
  '40001', // Serialization failure
  '40P01', // Deadlock
  '57014', // Query cancelled
  '08000', // Connection exception
  '08003', // Connection does not exist
  '08006', // Connection failure
]);

export const isTransientError = vi.fn().mockImplementation((error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: string }).code;
  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return true;
  }
  const message = error.message.toLowerCase();
  if (
    message.includes('connection refused') ||
    message.includes('connection reset') ||
    message.includes('timeout') ||
    message.includes('deadlock')
  ) {
    return true;
  }
  return false;
});

export const withRetry = vi.fn().mockImplementation(async (fn, options: any = {}) => {
  const maxAttempts = options.maxAttempts || 3;
  const delayMs = options.delayMs || 100;
  const shouldRetry = options.shouldRetry || isTransientError;

  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts && shouldRetry(error)) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
});

export const createRetryWrapper = vi.fn().mockImplementation(
  (options: any = {}) =>
    async (fn: () => Promise<any>) =>
      withRetry(fn, options)
);

// ─── Health ──────────────────────────────────────────────────────────────────

export const checkDatabaseHealth = vi.fn().mockImplementation(async () => ({
  status: 'healthy' as const,
  checks: [{ name: 'ping', status: 'pass' as const, duration: 1 }],
  metrics: undefined,
}));

export const performHealthCheck = vi.fn().mockImplementation(async () => ({
  status: 'healthy' as const,
  checks: [],
  metrics: undefined,
}));

export const getMetrics = vi.fn().mockReturnValue({ pool: null, queries: null });
export const hasDatabaseMetrics = vi.fn().mockReturnValue(false);

export class HealthMonitor {
  start() {}
  stop() {}
  getStatus() {
    return { status: 'healthy' as const, checks: [], metrics: undefined };
  }
}

// ─── Pool ────────────────────────────────────────────────────────────────────

export const createMetricsPool = vi.fn().mockImplementation((pool: any) => pool);
export const isMetricsPool = vi.fn().mockReturnValue(false);

// ─── Shutdown ────────────────────────────────────────────────────────────────

export const gracefulShutdown = vi.fn().mockResolvedValue(undefined);
export const shutdownDatabase = vi.fn().mockResolvedValue(undefined);
export const registerShutdownHandlers = vi.fn();
export const createShutdownController = vi.fn().mockReturnValue({
  shutdown: vi.fn().mockResolvedValue(undefined),
  register: vi.fn(),
});

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

export class CircuitBreakerError extends Error {
  constructor(message = 'Circuit breaker is open') {
    super(message);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private failures = 0;
  private _state: 'closed' | 'open' | 'half-open' = 'closed';
  private lastFailureTime = 0;
  private readonly threshold: number;
  private readonly resetTimeoutMs: number;

  constructor(threshold = 5, resetTimeoutMs = 30000) {
    this.threshold = threshold;
    this.resetTimeoutMs = resetTimeoutMs;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if we should transition from open to half-open
    if (this._state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.resetTimeoutMs) {
        this._state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      // Success - reset on half-open, keep closed
      if (this._state === 'half-open') {
        this.reset();
      }
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      if (this.failures >= this.threshold) {
        this._state = 'open';
      }
      throw error;
    }
  }

  isOpen(): boolean {
    return this._state === 'open';
  }

  getState(): { state: 'closed' | 'open' | 'half-open'; failures: number } {
    return {
      state: this._state,
      failures: this.failures,
    };
  }

  reset(): void {
    this.failures = 0;
    this._state = 'closed';
    this.lastFailureTime = 0;
  }
}
