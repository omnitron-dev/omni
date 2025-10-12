/**
 * Utility functions for Netron Browser Client
 */

import { cuid } from '@omnitron-dev/cuid';
import type { HttpRequestMessage, RequestContext, RequestHints } from '../types/index.js';

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
    version: '2.0',
    timestamp: Date.now(),
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
 * Calculate exponential backoff delay
 */
export function calculateBackoff(attempt: number, baseDelay: number = 1000): number {
  return Math.min(baseDelay * Math.pow(2, attempt - 1), 30000);
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
    timeout = window.setTimeout(later, wait);
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
