/**
 * Test client setup utilities for integration testing
 *
 * Provides helpers to create NetronReactClient instances connected
 * to mock servers, and React wrappers for testing hooks.
 */

import * as React from 'react';
import type { ReactNode } from 'react';
import { NetronReactClient, createNetronClient } from '../../src/core/client.js';
import { NetronProvider } from '../../src/core/provider.js';
import type { NetronReactClientConfig } from '../../src/core/types.js';
import type { MockServer } from './mock-server.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Test client configuration options
 */
export interface TestClientOptions {
  /** Override transport type */
  transport?: 'http' | 'websocket' | 'auto';
  /** Request timeout in ms */
  timeout?: number;
  /** Whether to auto-connect (default: false for tests) */
  autoConnect?: boolean;
  /** Additional client configuration */
  config?: Partial<NetronReactClientConfig>;
}

/**
 * Test wrapper configuration options
 */
export interface TestWrapperOptions extends TestClientOptions {
  /** Auto-connect in provider (default: false for tests) */
  providerAutoConnect?: boolean;
  /** Default options for queries/mutations */
  defaultOptions?: NetronReactClientConfig['defaults'];
}

/**
 * Connected test client result
 */
export interface ConnectedTestClient {
  /** The NetronReactClient instance */
  client: NetronReactClient;
  /** Disconnect and cleanup function */
  cleanup: () => Promise<void>;
}

// ============================================================================
// Client Creation
// ============================================================================

/**
 * Create a test client connected to a mock server
 *
 * This creates a NetronReactClient configured to connect to the provided
 * mock server. The client is NOT automatically connected - call connect()
 * or use createConnectedTestClient for auto-connection.
 *
 * @example
 * ```typescript
 * const server = await createMockServer();
 * const client = createTestClient(server);
 *
 * await client.connect();
 * // ... run tests
 * await client.disconnect();
 * await server.close();
 * ```
 */
export function createTestClient(server: MockServer, options: TestClientOptions = {}): NetronReactClient {
  const { transport = 'http', timeout = 5000, config = {} } = options;

  return createNetronClient({
    url: server.url,
    transport,
    timeout,
    devTools: false,
    defaults: {
      staleTime: 0,
      cacheTime: 0, // Disable caching by default in tests
      retry: 0, // Disable retries by default in tests
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    ...config,
  });
}

/**
 * Create a test client and automatically connect it
 *
 * Returns both the client and a cleanup function that handles
 * disconnection properly.
 *
 * @example
 * ```typescript
 * const server = await createMockServer({ handler: createNetronHandler(testServices) });
 * const { client, cleanup } = await createConnectedTestClient(server);
 *
 * try {
 *   // ... run tests
 * } finally {
 *   await cleanup();
 *   await server.close();
 * }
 * ```
 */
export async function createConnectedTestClient(
  server: MockServer,
  options: TestClientOptions = {}
): Promise<ConnectedTestClient> {
  const client = createTestClient(server, options);

  await client.connect();

  return {
    client,
    cleanup: async () => {
      await client.disconnect();
    },
  };
}

// ============================================================================
// React Wrappers
// ============================================================================

/**
 * Create a React wrapper component for testing hooks
 *
 * Use this with testing-library's renderHook:
 *
 * @example
 * ```typescript
 * const server = await createMockServer({ handler: createNetronHandler(testServices) });
 * const wrapper = createTestWrapper(server);
 *
 * const { result } = renderHook(() => useQuery({
 *   queryKey: ['user', '1'],
 *   queryFn: () => client.invoke('user', 'getUser', ['1']),
 * }), { wrapper });
 *
 * await waitFor(() => expect(result.current.isSuccess).toBe(true));
 * ```
 */
export function createTestWrapper(
  serverOrClient: MockServer | NetronReactClient,
  options: TestWrapperOptions = {}
): React.FC<{ children: ReactNode }> {
  const { providerAutoConnect = false, defaultOptions, ...clientOptions } = options;

  // Create or use existing client
  const client =
    serverOrClient instanceof NetronReactClient ? serverOrClient : createTestClient(serverOrClient, clientOptions);

  return function TestWrapper({ children }: { children: ReactNode }) {
    return React.createElement(NetronProvider, {
      client,
      autoConnect: providerAutoConnect,
      defaultOptions: defaultOptions ? { queries: defaultOptions } : undefined,
      children,
    });
  };
}

/**
 * Create a wrapper that provides a pre-connected client
 *
 * Use this when you need the client to be connected before rendering hooks.
 *
 * @example
 * ```typescript
 * const { wrapper, cleanup } = await createConnectedWrapper(server);
 *
 * const { result } = renderHook(() => useService('user'), { wrapper });
 *
 * await cleanup();
 * ```
 */
export async function createConnectedWrapper(
  server: MockServer,
  options: TestWrapperOptions = {}
): Promise<{
  wrapper: React.FC<{ children: ReactNode }>;
  client: NetronReactClient;
  cleanup: () => Promise<void>;
}> {
  const { client, cleanup } = await createConnectedTestClient(server, options);

  const wrapper = createTestWrapper(client, {
    ...options,
    providerAutoConnect: false, // Already connected
  });

  return {
    wrapper,
    client,
    cleanup,
  };
}

// ============================================================================
// Custom Test Client with Mocked Invoke
// ============================================================================

/**
 * Mock response definition
 */
export interface MockResponseDef {
  /** Service name */
  service: string;
  /** Method name */
  method: string;
  /** Response to return (or function to generate) */
  response?: unknown | ((...args: unknown[]) => unknown | Promise<unknown>);
  /** Error to throw */
  error?: Error | ((...args: unknown[]) => Error);
  /** Delay before responding (ms) */
  delay?: number;
  /** Match specific args (optional) */
  matchArgs?: unknown[] | ((args: unknown[]) => boolean);
  /** Called when this mock is matched */
  onMatch?: (args: unknown[]) => void;
}

/**
 * Create a client with mocked invoke method (no server needed)
 *
 * Useful for unit testing without network overhead.
 *
 * @example
 * ```typescript
 * const client = createMockedClient([
 *   {
 *     service: 'user',
 *     method: 'getUser',
 *     response: (id) => ({ id, name: `User ${id}` }),
 *   },
 *   {
 *     service: 'user',
 *     method: 'deleteUser',
 *     error: new Error('Not authorized'),
 *   },
 * ]);
 *
 * const user = await client.invoke('user', 'getUser', ['1']);
 * // { id: '1', name: 'User 1' }
 * ```
 */
export function createMockedClient(
  mocks: MockResponseDef[] = [],
  options: Partial<NetronReactClientConfig> = {}
): NetronReactClient {
  // Create mock map
  const mockMap = new Map<string, MockResponseDef[]>();
  for (const mock of mocks) {
    const key = `${mock.service}.${mock.method}`;
    const existing = mockMap.get(key) || [];
    existing.push(mock);
    mockMap.set(key, existing);
  }

  // Create client with fake URL
  const client = createNetronClient({
    url: 'http://mocked.local',
    transport: 'http',
    devTools: false,
    defaults: {
      staleTime: 0,
      cacheTime: 0,
      retry: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
    ...options,
  });

  // Override invoke method
  const originalInvoke = client.invoke.bind(client);

  client.invoke = async <T>(
    service: string,
    method: string,
    args: unknown[],
    invokeOptions?: { timeout?: number }
  ): Promise<T> => {
    const key = `${service}.${method}`;
    const mockDefs = mockMap.get(key);

    if (mockDefs && mockDefs.length > 0) {
      // Find matching mock (first match wins)
      let mock: MockResponseDef | undefined;

      for (const def of mockDefs) {
        if (def.matchArgs !== undefined) {
          if (typeof def.matchArgs === 'function') {
            if (def.matchArgs(args)) {
              mock = def;
              break;
            }
          } else if (JSON.stringify(def.matchArgs) === JSON.stringify(args)) {
            mock = def;
            break;
          }
        } else {
          // No matchArgs = matches all
          mock = def;
          break;
        }
      }

      if (mock) {
        // Call onMatch callback
        mock.onMatch?.(args);

        // Apply delay
        if (mock.delay && mock.delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, mock.delay));
        }

        // Handle error
        if (mock.error) {
          const error = typeof mock.error === 'function' ? mock.error(...args) : mock.error;
          throw error;
        }

        // Handle response
        if (mock.response !== undefined) {
          const response = typeof mock.response === 'function' ? await mock.response(...args) : mock.response;
          return response as T;
        }

        // Return undefined if no response defined
        return undefined as T;
      }
    }

    // No mock found - throw error by default (tests should mock everything)
    throw new Error(`No mock found for ${service}.${method}. ` + `Add a mock definition or use a real mock server.`);
  };

  // Also mark as "connected" for convenience
  (client as unknown as { connectionState: string }).connectionState = 'connected';

  return client;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Add a mock to an existing mocked client
 */
export function addMock(client: NetronReactClient, mock: MockResponseDef): void {
  const mocks: MockResponseDef[] = (client as unknown as { _testMocks?: MockResponseDef[] })._testMocks || [];
  mocks.push(mock);
  (client as unknown as { _testMocks: MockResponseDef[] })._testMocks = mocks;

  // Recreate the invoke handler
  const currentInvoke = client.invoke.bind(client);

  client.invoke = async <T>(
    service: string,
    method: string,
    args: unknown[],
    options?: { timeout?: number }
  ): Promise<T> => {
    const key = `${service}.${method}`;

    for (const m of mocks) {
      if (`${m.service}.${m.method}` === key) {
        if (m.delay && m.delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, m.delay));
        }
        if (m.error) {
          throw typeof m.error === 'function' ? m.error(...args) : m.error;
        }
        if (m.response !== undefined) {
          return (typeof m.response === 'function' ? await m.response(...args) : m.response) as T;
        }
      }
    }

    return currentInvoke(service, method, args, options);
  };
}

/**
 * Wait for the client to be in a specific connection state
 */
export async function waitForConnectionState(
  client: NetronReactClient,
  state: 'connected' | 'disconnected' | 'connecting' | 'reconnecting' | 'failed',
  timeout: number = 5000
): Promise<void> {
  const startTime = Date.now();

  while (client.getConnectionState() !== state) {
    if (Date.now() - startTime > timeout) {
      throw new Error(
        `Timeout waiting for connection state "${state}". ` + `Current state: "${client.getConnectionState()}"`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Clear all cached data from the client
 */
export function clearClientCache(client: NetronReactClient): void {
  client.clear();
}
