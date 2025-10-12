/**
 * E2E Test Helper Utilities
 */

import { Page } from '@playwright/test';

/**
 * Connect HTTP peer with managers
 */
export async function connectHttpPeer(page: Page, url = 'http://localhost:3333') {
  return await page.evaluate(async (serverUrl) => {
    const { HttpRemotePeer } = await import('../../src/netron/transport/http/peer.js');
    const { HttpCacheManager } = await import('../../src/netron/transport/http/cache-manager.js');
    const { RetryManager } = await import('../../src/netron/transport/http/retry-manager.js');

    const peer = new HttpRemotePeer(serverUrl);
    const cacheManager = new HttpCacheManager({ maxEntries: 100 });
    const retryManager = new RetryManager();

    peer.setCacheManager(cacheManager);
    peer.setRetryManager(retryManager);

    await peer.connect();

    window.testState.httpPeer = peer;
    window.testState.cacheManager = cacheManager;
    window.testState.retryManager = retryManager;
    window.updateConnectionStatus();

    return { connected: true };
  }, url);
}

/**
 * Connect WebSocket peer
 */
export async function connectWebSocketPeer(page: Page, url = 'ws://localhost:3334') {
  return await page.evaluate(async (serverUrl) => {
    const { WebSocketRemotePeer } = await import('../../src/netron/transport/websocket/peer.js');

    const peer = new WebSocketRemotePeer(serverUrl);
    await peer.connect();

    window.testState.wsPeer = peer;
    window.testState.subscriptions = [];
    window.updateConnectionStatus();

    return { connected: true };
  }, url);
}

/**
 * Disconnect all peers
 */
export async function disconnectAllPeers(page: Page) {
  return await page.evaluate(async () => {
    // Cleanup subscriptions
    if (window.testState.subscriptions) {
      window.testState.subscriptions.forEach((unsub: () => void) => unsub());
      window.testState.subscriptions = [];
    }

    // Disconnect HTTP peer
    if (window.testState.httpPeer) {
      await window.testState.httpPeer.disconnect();
      window.testState.httpPeer = null;
      window.testState.cacheManager = null;
      window.testState.retryManager = null;
    }

    // Disconnect WebSocket peer
    if (window.testState.wsPeer) {
      await window.testState.wsPeer.disconnect();
      window.testState.wsPeer = null;
    }

    window.updateConnectionStatus();
  });
}

/**
 * Get HTTP interface
 */
export async function getHttpInterface<T>(page: Page, serviceName: string): Promise<T> {
  return (await page.evaluate(async (name) => {
    if (!window.testState.httpPeer) {
      throw new Error('HTTP peer not connected');
    }
    const service = await window.testState.httpPeer.queryInterface(name);
    return service;
  }, serviceName)) as T;
}

/**
 * Get HTTP fluent interface
 */
export async function getHttpFluentInterface<T>(page: Page, serviceName: string): Promise<T> {
  return (await page.evaluate(async (name) => {
    if (!window.testState.httpPeer) {
      throw new Error('HTTP peer not connected');
    }
    const service = await window.testState.httpPeer.queryFluentInterface(name);
    return service;
  }, serviceName)) as T;
}

/**
 * Get WebSocket interface
 */
export async function getWebSocketInterface<T>(page: Page, serviceName: string): Promise<T> {
  return (await page.evaluate(async (name) => {
    if (!window.testState.wsPeer) {
      throw new Error('WebSocket peer not connected');
    }
    const service = await window.testState.wsPeer.queryInterface(name);
    return service;
  }, serviceName)) as T;
}

/**
 * Wait for condition
 */
export async function waitFor(
  page: Page,
  condition: () => boolean | Promise<boolean>,
  timeout = 5000,
  interval = 100
): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const result = await page.evaluate(condition);
    if (result) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Measure execution time
 */
export async function measureTime<T>(page: Page, fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
  return await page.evaluate(async (serializedFn) => {
    const fn = eval(`(${serializedFn})`);
    const start = performance.now();
    const result = await fn();
    const duration = performance.now() - start;
    return { result, duration };
  }, fn.toString());
}

/**
 * Get cache statistics
 */
export async function getCacheStats(page: Page) {
  return await page.evaluate(() => {
    if (!window.testState.cacheManager) {
      throw new Error('Cache manager not available');
    }
    return window.testState.cacheManager.getStats();
  });
}

/**
 * Clear all caches
 */
export async function clearAllCaches(page: Page) {
  return await page.evaluate(() => {
    if (window.testState.cacheManager) {
      window.testState.cacheManager.clear();
    }
  });
}

/**
 * Create test user
 */
export async function createTestUser(page: Page, data: { name: string; email: string; age: number }) {
  return await page.evaluate(async (userData) => {
    const userService = await window.testState.httpPeer.queryInterface('UserService@1.0.0');
    return await userService.createUser(userData);
  }, data);
}

/**
 * Subscribe to messages with callback
 */
export async function subscribeToMessages(page: Page, callback: (message: any) => void): Promise<() => void> {
  // Store callback in window for access
  await page.exposeFunction('__messageCallback', callback);

  await page.evaluate(async () => {
    const eventService = await window.testState.wsPeer.queryInterface('EventService@1.0.0');

    const unsubscribe = eventService.subscribeToMessages((message: any) => {
      (window as any).__messageCallback(message);
    });

    window.testState.subscriptions.push(unsubscribe);
  });

  // Return cleanup function
  return async () => {
    await page.evaluate(() => {
      if (window.testState.subscriptions.length > 0) {
        const unsub = window.testState.subscriptions.pop();
        if (unsub) unsub();
      }
    });
  };
}

/**
 * Collect stream chunks
 */
export async function collectStreamChunks<T>(
  page: Page,
  stream: ReadableStream<T>,
  maxChunks = Infinity
): Promise<T[]> {
  return await page.evaluate(async (max) => {
    const chunks: any[] = [];
    const reader = (window as any).__testStream.getReader();

    let count = 0;
    while (count < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      count++;
    }

    return chunks;
  }, maxChunks);
}

/**
 * Assert eventually (with retry)
 */
export async function assertEventually<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: { timeout?: number; interval?: number; message?: string } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100, message = 'Assertion failed' } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const value = await fn();
    if (predicate(value)) return;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`${message} (timeout after ${timeout}ms)`);
}

/**
 * Parallel test execution
 */
export async function parallel<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  return await Promise.all(tasks.map((task) => task()));
}

/**
 * Sequential test execution
 */
export async function sequential<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results: T[] = [];
  for (const task of tasks) {
    results.push(await task());
  }
  return results;
}

/**
 * Retry with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; initialDelay?: number; maxDelay?: number } = {}
): Promise<T> {
  const { maxAttempts = 3, initialDelay = 100, maxDelay = 5000 } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, maxDelay);
      }
    }
  }

  throw lastError;
}

/**
 * Type definitions for window.testState
 */
declare global {
  interface Window {
    testState: {
      httpPeer: any;
      wsPeer: any;
      cacheManager: any;
      retryManager: any;
      userService: any;
      streamService: any;
      eventService: any;
      subscriptions: Array<() => void>;
    };
    updateConnectionStatus: () => void;
    displayResult: (elementId: string, data: any, isError?: boolean) => void;
    appendResult: (elementId: string, data: any) => void;
  }
}
