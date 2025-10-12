/**
 * Runtime detection utilities for cross-platform support
 */

import { Errors } from '../errors/index.js';

/**
 * Supported runtime environments
 */
export enum Runtime {
  Node = 'node',
  Bun = 'bun',
  Deno = 'deno',
  Browser = 'browser',
  Unknown = 'unknown',
}

/**
 * Runtime information
 */
export interface RuntimeInfo {
  runtime: Runtime;
  version?: string;
  isBrowser: boolean;
  isServer: boolean;
  hasWorkers: boolean;
  hasESM: boolean;
  platform?: string;
}

/**
 * Detect the current runtime environment
 */
export function detectRuntime(): RuntimeInfo {
  // Check for Bun
  if (typeof globalThis !== 'undefined' && (globalThis as any).Bun) {
    return {
      runtime: Runtime.Bun,
      version: (globalThis as any).Bun.version,
      isBrowser: false,
      isServer: true,
      hasWorkers: true,
      hasESM: true,
      platform: process?.platform,
    };
  }

  // Check for Deno
  if (typeof globalThis !== 'undefined' && (globalThis as any).Deno) {
    return {
      runtime: Runtime.Deno,
      version: (globalThis as any).Deno.version?.deno,
      isBrowser: false,
      isServer: true,
      hasWorkers: true,
      hasESM: true,
      platform: (globalThis as any).Deno.build?.os,
    };
  }

  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions?.node) {
    return {
      runtime: Runtime.Node,
      version: process.versions.node,
      isBrowser: false,
      isServer: true,
      hasWorkers: typeof (globalThis as any).Worker !== 'undefined',
      hasESM: true, // Node 12+ has ESM support
      platform: process.platform,
    };
  }

  // Check for browser
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    return {
      runtime: Runtime.Browser,
      version: navigator?.userAgent,
      isBrowser: true,
      isServer: false,
      hasWorkers: typeof Worker !== 'undefined',
      hasESM: true, // Modern browsers support ESM
      platform: navigator?.platform,
    };
  }

  // Unknown runtime
  return {
    runtime: Runtime.Unknown,
    isBrowser: false,
    isServer: false,
    hasWorkers: false,
    hasESM: false,
  };
}

/**
 * Global runtime info singleton
 */
let runtimeInfo: RuntimeInfo | null = null;

/**
 * Get cached runtime info
 */
export function getRuntimeInfo(): RuntimeInfo {
  if (!runtimeInfo) {
    runtimeInfo = detectRuntime();
  }
  return runtimeInfo;
}

/**
 * Check if running in Node.js
 */
export function isNode(): boolean {
  return getRuntimeInfo().runtime === Runtime.Node;
}

/**
 * Check if running in Bun
 */
export function isBun(): boolean {
  return getRuntimeInfo().runtime === Runtime.Bun;
}

/**
 * Check if running in Deno
 */
export function isDeno(): boolean {
  return getRuntimeInfo().runtime === Runtime.Deno;
}

/**
 * Check if running in a browser
 */
export function isBrowser(): boolean {
  return getRuntimeInfo().isBrowser;
}

/**
 * Check if running on a server
 */
export function isServer(): boolean {
  return getRuntimeInfo().isServer;
}

/**
 * Check if ESM is supported
 */
export function hasESMSupport(): boolean {
  return getRuntimeInfo().hasESM;
}

/**
 * Check if Workers are supported
 */
export function hasWorkerSupport(): boolean {
  return getRuntimeInfo().hasWorkers;
}

/**
 * Get global object based on runtime
 */
export function getGlobalObject(): any {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  if (typeof global !== 'undefined') {
    return global;
  }
  if (typeof self !== 'undefined') {
    return self;
  }
  throw Errors.internal('Unable to locate global object');
}

/**
 * Runtime-specific implementation loader
 */
export async function loadRuntimeModule<T>(modulePaths: {
  node?: string;
  bun?: string;
  deno?: string;
  browser?: string;
  default: string;
}): Promise<T> {
  const runtime = getRuntimeInfo().runtime;

  let modulePath: string;
  switch (runtime) {
    case Runtime.Node:
      modulePath = modulePaths.node || modulePaths.default;
      break;
    case Runtime.Bun:
      modulePath = modulePaths.bun || modulePaths.node || modulePaths.default;
      break;
    case Runtime.Deno:
      modulePath = modulePaths.deno || modulePaths.default;
      break;
    case Runtime.Browser:
      modulePath = modulePaths.browser || modulePaths.default;
      break;
    default:
      modulePath = modulePaths.default;
  }

  try {
    const module = await import(modulePath);
    return module.default || module;
  } catch (error) {
    throw Errors.internal(
      `Failed to load module '${modulePath}' for runtime '${runtime}'`,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Performance timer abstraction
 */
export class PerformanceTimer {
  private start: number;

  constructor() {
    this.start = this.now();
  }

  private now(): number {
    if (typeof performance !== 'undefined' && performance.now) {
      return performance.now();
    }
    if (isNode() && process.hrtime) {
      const [seconds, nanoseconds] = process.hrtime();
      return seconds * 1000 + nanoseconds / 1000000;
    }
    return Date.now();
  }

  elapsed(): number {
    return this.now() - this.start;
  }

  reset(): void {
    this.start = this.now();
  }
}

/**
 * Memory usage helper
 */
export function getMemoryUsage(): { used: number; total: number } | null {
  const runtime = getRuntimeInfo();

  if (runtime.runtime === Runtime.Node && process.memoryUsage) {
    const usage = process.memoryUsage();
    return {
      used: usage.heapUsed,
      total: usage.heapTotal,
    };
  }

  if (runtime.runtime === Runtime.Bun && (globalThis as any).Bun) {
    // Bun-specific memory API if available
    try {
      const usage = (globalThis as any).Bun.memoryUsage?.();
      if (usage) {
        return {
          used: usage.heapUsed,
          total: usage.heapTotal,
        };
      }
    } catch {
      // Ignore errors when memory usage is not available
    }
  }

  if (runtime.runtime === Runtime.Deno && (globalThis as any).Deno) {
    // Deno-specific memory API if available
    try {
      const metrics = (globalThis as any).Deno.metrics?.();
      if (metrics) {
        return {
          used: metrics.memory.heapUsed,
          total: metrics.memory.heapTotal,
        };
      }
    } catch {
      // Ignore errors when memory usage is not available
    }
  }

  if (runtime.isBrowser && (performance as any).memory) {
    const memory = (performance as any).memory;
    return {
      used: memory.usedJSHeapSize,
      total: memory.totalJSHeapSize,
    };
  }

  return null;
}
