/**
 * Utility functions for the Template Module
 */

import { randomBytes } from 'node:crypto';
import type { OperationResult } from './types.js';

/**
 * Generate a unique ID
 */
export function generateId(prefix = 'tpl'): string {
  const timestamp = Date.now().toString(36);
  const random = randomBytes(8).toString('hex');
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Create a successful operation result
 */
export function success<T>(data: T, metadata?: Record<string, any>): OperationResult<T> {
  return {
    success: true,
    data,
    metadata,
  };
}

/**
 * Create a failed operation result
 */
export function failure(error: Error | string, metadata?: Record<string, any>): OperationResult {
  return {
    success: false,
    error: error instanceof Error ? error : new Error(error),
    metadata,
  };
}

/**
 * Delay execution for a specified time
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry an operation with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    baseDelay?: number;
    maxDelay?: number;
    factor?: number;
  } = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelay = 1000,
    maxDelay = 10000,
    factor = 2,
  } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        break;
      }

      const delayMs = Math.min(baseDelay * Math.pow(factor, attempt - 1), maxDelay);
      await delay(delayMs);
    }
  }

  throw lastError;
}

/**
 * Create a cache key from components
 */
export function createCacheKey(...components: (string | number | boolean)[]): string {
  return components
    .filter(c => c !== undefined && c !== null)
    .join(':');
}

/**
 * Parse a cache key into components
 */
export function parseCacheKey(key: string): string[] {
  return key.split(':');
}

/**
 * Check if a value is expired based on TTL
 */
export function isExpired(timestamp: Date | number, ttl: number): boolean {
  const now = Date.now();
  const time = typeof timestamp === 'number' ? timestamp : timestamp.getTime();
  return now - time > ttl * 1000;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (obj instanceof Date) {
    return new Date(obj.getTime()) as T;
  }

  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as T;
  }

  if (obj instanceof Set) {
    return new Set(Array.from(obj).map(item => deepClone(item))) as T;
  }

  if (obj instanceof Map) {
    return new Map(Array.from(obj.entries()).map(([k, v]) => [k, deepClone(v)])) as T;
  }

  const cloned = {} as T;
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }

  return cloned;
}

/**
 * Merge deep objects
 */
export function mergeDeep<T extends Record<string, any>>(target: T, ...sources: Partial<T>[]): T {
  if (!sources.length) return target;

  const source = sources.shift();
  if (!source) return target;

  for (const key in source) {
    const sourceValue = source[key];
    const targetValue = target[key];

    if (isObject(sourceValue) && isObject(targetValue)) {
      (target as any)[key] = mergeDeep(targetValue as any, sourceValue as any);
    } else {
      (target as any)[key] = sourceValue;
    }
  }

  return mergeDeep(target, ...sources);
}

/**
 * Check if value is a plain object
 */
function isObject(value: any): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}