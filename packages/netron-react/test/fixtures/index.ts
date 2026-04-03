/**
 * Test fixtures for netron-react integration testing
 *
 * This module provides comprehensive testing utilities including:
 * - Mock HTTP server simulating Netron RPC protocol
 * - Pre-configured test services (user, echo, counter, math, todo)
 * - Test client creation helpers
 * - React wrapper utilities for hook testing
 *
 * @example Basic usage with mock server
 * ```typescript
 * import {
 *   createMockServer,
 *   createNetronHandler,
 *   testServices,
 *   createTestClient,
 * } from '@omnitron-dev/netron-react/test/fixtures';
 *
 * const server = await createMockServer({
 *   handler: createNetronHandler(testServices.services),
 * });
 *
 * const client = createTestClient(server);
 * await client.connect();
 *
 * const user = await client.invoke('user', 'getUser', ['1']);
 * console.log(user); // { id: '1', name: 'Alice', ... }
 *
 * await client.disconnect();
 * await server.close();
 * ```
 *
 * @example Testing React hooks
 * ```typescript
 * import { renderHook, waitFor } from '@testing-library/react';
 * import { useQuery } from '@omnitron-dev/netron-react';
 * import { createMockServer, createNetronHandler, testServices, createConnectedWrapper } from './fixtures';
 *
 * describe('useQuery', () => {
 *   let server: MockServer;
 *   let wrapper: React.FC;
 *   let cleanup: () => Promise<void>;
 *
 *   beforeEach(async () => {
 *     server = await createMockServer({
 *       handler: createNetronHandler(testServices.services),
 *     });
 *     const result = await createConnectedWrapper(server);
 *     wrapper = result.wrapper;
 *     cleanup = result.cleanup;
 *   });
 *
 *   afterEach(async () => {
 *     await cleanup();
 *     await server.close();
 *     testServices.resetAll();
 *   });
 *
 *   it('fetches data successfully', async () => {
 *     const { result } = renderHook(
 *       () => useQuery({
 *         queryKey: ['user', '1'],
 *         queryFn: async ({ signal }) => {
 *           // ... fetch logic
 *         },
 *       }),
 *       { wrapper }
 *     );
 *
 *     await waitFor(() => expect(result.current.isSuccess).toBe(true));
 *     expect(result.current.data).toEqual({ id: '1', name: 'Alice', ... });
 *   });
 * });
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Mock Server
// ============================================================================

export * from './mock-server.js';

// ============================================================================
// Test Services
// ============================================================================

export * from './test-services.js';

// ============================================================================
// Test Client
// ============================================================================

export * from './test-client.js';

// ============================================================================
// Convenience Re-exports
// ============================================================================

/**
 * Create a fully configured test environment
 *
 * Combines server creation, service setup, and client creation into one call.
 *
 * @example
 * ```typescript
 * const env = await createTestEnvironment();
 *
 * // Use the client
 * const user = await env.client.invoke('user', 'getUser', ['1']);
 *
 * // Clean up
 * await env.cleanup();
 * ```
 */
export async function createTestEnvironment(
  options: {
    /** Custom services to use */
    services?: Record<string, Record<string, (...args: unknown[]) => unknown | Promise<unknown>>>;
    /** Server options */
    serverOptions?: import('./mock-server.js').MockServerOptions;
    /** Client options */
    clientOptions?: import('./test-client.js').TestClientOptions;
  } = {}
): Promise<{
  server: import('./mock-server.js').MockServer;
  client: import('../../src/core/client.js').NetronReactClient;
  services: ReturnType<typeof createTestServices>;
  cleanup: () => Promise<void>;
}> {
  const { createMockServer, createNetronHandler } = await import('./mock-server.js');
  const { createConnectedTestClient } = await import('./test-client.js');
  const { createTestServices } = await import('./test-services.js');

  // Create services
  const services = createTestServices();
  const serviceRegistry = options.services ? { ...services.services, ...options.services } : services.services;

  // Create server with handler
  const server = await createMockServer({
    handler: createNetronHandler(serviceRegistry),
    ...options.serverOptions,
  });

  // Create connected client
  const { client, cleanup: clientCleanup } = await createConnectedTestClient(server, options.clientOptions);

  return {
    server,
    client,
    services,
    cleanup: async () => {
      await clientCleanup();
      await server.close();
      services.resetAll();
    },
  };
}
