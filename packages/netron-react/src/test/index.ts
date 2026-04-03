/**
 * Test utilities for @omnitron-dev/netron-react
 */

import React, { type ReactNode } from 'react';
import { NetronReactClient } from '../core/client.js';
import { NetronProvider } from '../core/provider.js';
import type { QueryKey, NetronReactClientConfig } from '../core/types.js';

// ============================================================================
// Mock Client
// ============================================================================

/**
 * Mock response configuration
 */
export interface MockResponse {
  service: string;
  method: string;
  response?: unknown;
  error?: Error;
  delay?: number;
}

/**
 * Test client configuration
 */
export interface TestClientConfig {
  /** Mock responses */
  mocks?: MockResponse[];
  /** Default response delay */
  defaultDelay?: number;
  /** Client config overrides */
  config?: Partial<NetronReactClientConfig>;
}

/**
 * Create a test client with mocked responses
 */
export function createTestClient(testConfig?: TestClientConfig): NetronReactClient {
  const { mocks = [], defaultDelay = 0, config = {} } = testConfig ?? {};

  // Create mock map
  const mockMap = new Map<string, MockResponse>();
  for (const mock of mocks) {
    const key = `${mock.service}.${mock.method}`;
    mockMap.set(key, mock);
  }

  // Create client with test configuration
  const client = new NetronReactClient({
    url: 'http://test.local',
    transport: 'http',
    ...config,
  });

  // Override invoke to use mocks
  const originalInvoke = client.invoke.bind(client);
  client.invoke = async <T>(
    service: string,
    method: string,
    args: unknown[],
    options?: { timeout?: number }
  ): Promise<T> => {
    const key = `${service}.${method}`;
    const mock = mockMap.get(key);

    if (mock) {
      const delay = mock.delay ?? defaultDelay;
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (mock.error) {
        throw mock.error;
      }

      return mock.response as T;
    }

    // Fall back to original (will likely fail in tests)
    return originalInvoke(service, method, args, options);
  };

  return client;
}

// ============================================================================
// Test Provider
// ============================================================================

/**
 * Test provider props
 */
export interface TestNetronProviderProps {
  /** Test client */
  client?: NetronReactClient;
  /** Test client config */
  testConfig?: TestClientConfig;
  /** Children */
  children: ReactNode;
}

/**
 * Test provider component
 */
export function TestNetronProvider({ client, testConfig, children }: TestNetronProviderProps): React.JSX.Element {
  const testClient = client ?? createTestClient(testConfig);

  return React.createElement(NetronProvider, {
    client: testClient,
    autoConnect: false,
    children,
  });
}

// ============================================================================
// Render Helpers
// ============================================================================

/**
 * Create a wrapper for testing hooks
 */
export function createWrapper(
  client?: NetronReactClient,
  testConfig?: TestClientConfig
): React.FC<{ children: ReactNode }> {
  const testClient = client ?? createTestClient(testConfig);

  return function Wrapper({ children }: { children: ReactNode }) {
    return React.createElement(NetronProvider, {
      client: testClient,
      autoConnect: false,
      children,
    });
  };
}

// ============================================================================
// Mock Service
// ============================================================================

/**
 * Create a mock service with mocked methods
 */
export function createMockService<T extends Record<string, (...args: unknown[]) => Promise<unknown>>>(implementations: {
  [K in keyof T]?: T[K] | ((...args: unknown[]) => unknown);
}): T {
  const mockService = {} as T;

  for (const [method, impl] of Object.entries(implementations)) {
    if (typeof impl === 'function') {
      (mockService as Record<string, unknown>)[method] = impl;
    }
  }

  return mockService;
}

// ============================================================================
// Query Helpers
// ============================================================================

/**
 * Wait for query to settle
 */
export async function waitForQuery(timeout = 5000): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeout);
  });
}

/**
 * Create a query key for testing
 */
export function createQueryKey(...parts: unknown[]): QueryKey {
  return ['test', ...parts] as const;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert query result is loading
 */
export function expectLoading(result: { isLoading: boolean; status: string }): void {
  if (!result.isLoading || result.status !== 'loading') {
    throw new Error(`Expected loading state, got ${result.status}`);
  }
}

/**
 * Assert query result is success
 */
export function expectSuccess<T>(result: {
  isSuccess: boolean;
  data: T | undefined;
}): asserts result is { isSuccess: true; data: T } {
  if (!result.isSuccess || result.data === undefined) {
    throw new Error('Expected success state with data');
  }
}

/**
 * Assert query result is error
 */
export function expectError(result: { isError: boolean; error: unknown }): void {
  if (!result.isError || !result.error) {
    throw new Error('Expected error state');
  }
}

// ============================================================================
// Time Control
// ============================================================================

/**
 * Advance timers and flush promises
 * Note: Call this after setting up fake timers in your test framework
 */
export async function advanceTimersAndFlush(ms: number): Promise<void> {
  // Use vitest fake timers if available in global scope
  const globalAny = globalThis as Record<string, unknown>;
  if (
    globalAny.vi &&
    typeof (globalAny.vi as { advanceTimersByTime?: (ms: number) => void }).advanceTimersByTime === 'function'
  ) {
    (globalAny.vi as { advanceTimersByTime: (ms: number) => void }).advanceTimersByTime(ms);
  }

  // Flush microtasks
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Wait for next tick
 */
export function nextTick(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof setImmediate !== 'undefined') {
      setImmediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}
