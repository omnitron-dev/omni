/**
 * Utility functions for Netron Browser Client
 */

import { cuid } from '@omnitron-dev/cuid';
import type { HttpRequestMessage, RequestContext, RequestHints } from '../types/index.js';

// Re-export LRU cache
export { LRUCache, DEFAULT_LRU_CACHE_OPTIONS } from './lru-cache.js';
export type { LRUCacheOptions, LRUCacheStats } from './lru-cache.js';

// Re-export validation utilities
export {
  isValidDefId,
  isValidPropertyName,
  isValidServiceName,
  parseQualifiedServiceName,
  createValidationError,
  validateRpcInputs,
  escapeRegex,
  createPatternRegex,
  MAX_LENGTHS,
} from './validation.js';

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return cuid();
}

/**
 * Create an HTTP request message
 */
export function createRequestMessage(
  service: string,
  method: string,
  args: any[],
  options?: {
    context?: RequestContext;
    hints?: RequestHints;
  }
): HttpRequestMessage {
  return {
    id: generateRequestId(),
    service,
    method,
    input: args, // Server expects 'input' not 'args'
    context: options?.context,
    hints: options?.hints,
  };
}

/**
 * Validate URL format
 */
export function validateUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize URL (remove trailing slash)
 */
export function normalizeUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

/**
 * Convert HTTP URL to WebSocket URL
 */
export function httpToWsUrl(url: string): string {
  return url.replace(/^http/, 'ws');
}

/**
 * Check if code is running in browser
 */
export function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

/**
 * Check if WebSocket is supported
 */
export function isWebSocketSupported(): boolean {
  return isBrowser() && 'WebSocket' in window;
}

/**
 * Check if fetch is supported
 */
export function isFetchSupported(): boolean {
  return typeof fetch !== 'undefined';
}

/**
 * Sleep for specified milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate exponential backoff delay with jitter.
 *
 * Uses **full jitter** per AWS's "Exponential Backoff And Jitter"
 * recommendation (Marc Brooker, 2015) — see
 * https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/.
 *
 *   exp   = min(baseDelay * 2^(attempt-1), maxDelay)
 *   delay = random_between(baseDelay, exp)
 *
 * Why full jitter (NOT the previous capped-exp ± 25%):
 *   The pre-fix algorithm clustered every retry inside a 50% wide
 *   window around the exponential — fine in isolation, lethal at
 *   scale. With N clients disconnecting on a server restart and
 *   computing attempt=1 (1s base): the old code spread them across
 *   [750ms, 1250ms] — a 500ms thundering-herd window. N=10000 →
 *   20k retries/sec hits the rebooting server. Full jitter
 *   spreads the same retries across [1s, 1s] up to [1s, maxDelay]
 *   as `attempt` grows, dramatically lowering peak request rate
 *   while preserving the same expected completion time.
 *
 *   The `Math.max(baseDelay, …)` floor ensures the first retry
 *   never fires faster than `baseDelay` even when the random
 *   draw lands at the lower bound — the only way a true zero
 *   could appear is if `baseDelay <= 0`, which is a caller bug.
 */
export function calculateBackoff(attempt: number, baseDelay: number = 1000, maxDelay: number = 30000): number {
  const safeBase = Math.max(1, baseDelay);
  const safeMax = Math.max(safeBase, maxDelay);
  const exponential = Math.min(safeBase * Math.pow(2, Math.max(0, attempt - 1)), safeMax);
  // Full jitter: uniform draw from [safeBase, exponential].
  const span = Math.max(0, exponential - safeBase);
  const delay = safeBase + Math.random() * span;
  return Math.floor(delay);
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as any;
  }

  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item)) as any;
  }

  if (obj instanceof Object) {
    const clonedObj: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }

  return obj;
}

/**
 * Merge objects deeply
 */
export function deepMerge<T extends object>(target: T, ...sources: Partial<T>[]): T {
  if (!sources.length) return target;

  const source = sources.shift();
  if (!source) return target;

  for (const key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const sourceValue = source[key];
      const targetValue = target[key];

      if (
        sourceValue &&
        typeof sourceValue === 'object' &&
        !Array.isArray(sourceValue) &&
        targetValue &&
        typeof targetValue === 'object' &&
        !Array.isArray(targetValue)
      ) {
        target[key] = deepMerge(targetValue as any, sourceValue as any);
      } else {
        target[key] = sourceValue as any;
      }
    }
  }

  return deepMerge(target, ...sources);
}

/**
 * Debounce function
 */
export function debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
  let timeout: number | undefined;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait) as unknown as number;
  };
}

/**
 * Throttle function
 */
export function throttle<T extends (...args: any[]) => any>(func: T, limit: number): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
