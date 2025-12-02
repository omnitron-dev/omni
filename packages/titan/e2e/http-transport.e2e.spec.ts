/**
 * E2E Tests for HTTP Transport
 * Tests all Netron capabilities over HTTP: invoke, batch, discovery, errors, streams
 */

import { Netron } from '../src/netron/index.js';
import { HttpNativeServer } from '../src/netron/transport/http/index.js';
import { HttpTransportClient } from '../src/netron/transport/http/index.js';
import { TestService, type User } from './server/services/test.service.js';

const skipTests = process.env.USE_MOCK_REDIS === 'true' || process.env.CI === 'true';

if (skipTests) {
  console.log('⏭️ Skipping http-transport.e2e.spec.ts - requires external services');
}

const describeOrSkip = skipTests ? describe.skip : describe;

describeOrSkip('Netron HTTP Transport E2E', () => {
  let netron: Netron;
  let server: HttpNativeServer;
  let client: HttpTransportClient;
  let testService: TestService;

  const SERVER_PORT = 3500;
  const BASE_URL = `http://localhost:${SERVER_PORT}`;

  beforeAll(async () => {
    // Create minimal logger for tests
    const logger: any = {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: () => logger,
      time: () => () => {},
      isLevelEnabled: () => true,
    };

    // Create Netron instance
    netron = new Netron(logger);
    await netron.start();

    // Create and expose test service
    testService = new TestService();
    await netron.peer.exposeService(testService);

    // Create HTTP server
    server = new HttpNativeServer({
      port: SERVER_PORT,
      host: '0.0.0.0',
      cors: true,
    });

    server.setPeer(netron.peer);
    await server.listen();

    // Create HTTP client
    client = new HttpTransportClient(BASE_URL, netron);
    await client.initialize();
  });

  afterAll(async () => {
    await client?.close();
    await server?.close();
    await netron?.stop();
  });

  // Helper function to invoke RPC
  const invoke = async (service: string, method: string, input: any = []) => {
    const response = await fetch(`${BASE_URL}/netron/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: `test-${Date.now()}`,
        version: '2.0',
        timestamp: Date.now(),
        service,
        method,
        input: Array.isArray(input) ? input : [input],
      }),
    });

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error?.message || 'RPC error');
    }
    return result.data;
  };

  describe('Basic RPC Operations', () => {
    test('should invoke hello method', async () => {
      const result = await invoke('TestService', 'hello', ['World']);
      expect(result).toBe('Hello, World!');
    });

    test('should get all users', async () => {
      const users = await invoke('TestService', 'getUsers', []);
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThan(0);
      expect(users[0]).toHaveProperty('id');
      expect(users[0]).toHaveProperty('name');
      expect(users[0]).toHaveProperty('email');
    });

    test('should get user by ID', async () => {
      const user = await invoke('TestService', 'getUser', ['1']);
      expect(user).toBeTruthy();
      expect(user.id).toBe('1');
      expect(user.name).toBe('Alice');
    });

    test('should return null for non-existent user', async () => {
      const user = await invoke('TestService', 'getUser', ['999']);
      expect(user).toBeNull();
    });

    test('should create new user', async () => {
      const newUser = {
        name: 'David',
        email: 'david@test.com',
        age: 28,
      };

      const created = await invoke('TestService', 'createUser', [newUser]);
      expect(created).toBeTruthy();
      expect(created.id).toBeTruthy();
      expect(created.name).toBe('David');
      expect(created.email).toBe('david@test.com');
      expect(created.age).toBe(28);
    });

    test('should update user', async () => {
      const updates = { age: 31 };
      const updated = await invoke('TestService', 'updateUser', ['1', updates]);
      expect(updated).toBeTruthy();
      expect(updated.id).toBe('1');
      expect(updated.age).toBe(31);
    });

    test('should delete user', async () => {
      const deleted = await invoke('TestService', 'deleteUser', ['2']);
      expect(deleted).toBe(true);

      // Verify deleted
      const user = await invoke('TestService', 'getUser', ['2']);
      expect(user).toBeNull();
    });

    test('should handle errors correctly', async () => {
      await expect(invoke('TestService', 'throwError', ['Test error message'])).rejects.toThrow('Test error message');
    });
  });

  describe('Discovery & Metadata', () => {
    test('should discover available services', async () => {
      const response = await fetch(`${BASE_URL}/netron/discovery`);
      expect(response.ok).toBe(true);

      const discovery = await response.json();
      expect(discovery.services).toBeDefined();
      expect(discovery.services.TestService).toBeDefined();
      expect(discovery.services.TestService.version).toBe('1.0.0');
      expect(Array.isArray(discovery.services.TestService.methods)).toBe(true);
    });

    test('should query interface metadata', async () => {
      const response = await fetch(`${BASE_URL}/netron/query-interface`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'test-query-1',
          version: '2.0',
          timestamp: Date.now(),
          serviceName: 'TestService',
        }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.methods).toBeDefined();
      expect(typeof result.data.methods).toBe('object');
      expect(Object.keys(result.data.methods).length).toBeGreaterThan(0);

      // Verify structure - methods should be a Record<string, MethodInfo>
      const methodNames = Object.keys(result.data.methods);
      expect(methodNames).toContain('hello');
      expect(methodNames).toContain('getUsers');
    });

    test('should list server capabilities', async () => {
      const response = await fetch(`${BASE_URL}/netron/discovery`);
      const discovery = await response.json();

      expect(discovery.server).toBeDefined();
      expect(discovery.server.version).toBe('2.0.0');
      expect(discovery.server.protocol).toBe('2.0');
      expect(Array.isArray(discovery.server.features)).toBe(true);
      expect(discovery.server.features).toContain('batch');
      expect(discovery.server.features).toContain('discovery');
    });
  });

  describe('Batch Operations', () => {
    test('should execute batch request with multiple methods', async () => {
      const response = await fetch(`${BASE_URL}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'req-1',
              service: 'TestService',
              method: 'hello',
              input: ['Alice'],
            },
            {
              id: 'req-2',
              service: 'TestService',
              method: 'hello',
              input: ['Bob'],
            },
            {
              id: 'req-3',
              service: 'TestService',
              method: 'getUsers',
              input: [],
            },
          ],
        }),
      });

      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.id).toBe('batch-1');
      expect(Array.isArray(result.responses)).toBe(true);
      expect(result.responses.length).toBe(3);

      expect(result.responses[0].success).toBe(true);
      expect(result.responses[0].data).toBe('Hello, Alice!');

      expect(result.responses[1].success).toBe(true);
      expect(result.responses[1].data).toBe('Hello, Bob!');

      expect(result.responses[2].success).toBe(true);
      expect(Array.isArray(result.responses[2].data)).toBe(true);
    });

    test('should handle mixed success and error in batch', async () => {
      const response = await fetch(`${BASE_URL}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-2',
          version: '2.0',
          timestamp: Date.now(),
          requests: [
            {
              id: 'req-1',
              service: 'TestService',
              method: 'hello',
              input: ['World'],
            },
            {
              id: 'req-2',
              service: 'TestService',
              method: 'throwError',
              input: ['Intentional error'],
            },
            {
              id: 'req-3',
              service: 'TestService',
              method: 'getUser',
              input: ['1'],
            },
          ],
        }),
      });

      const result = await response.json();
      expect(result.id).toBe('batch-2');
      expect(result.responses.length).toBe(3);

      expect(result.responses[0].success).toBe(true);
      expect(result.responses[1].success).toBe(false);
      expect(result.responses[1].error).toBeDefined();
      expect(result.responses[2].success).toBe(true);
    });

    test('should maintain order in batch responses', async () => {
      const requests = Array.from({ length: 10 }, (_, i) => ({
        id: `req-${i}`,
        service: 'TestService',
        method: 'hello',
        input: [`User${i}`],
      }));

      const response = await fetch(`${BASE_URL}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'batch-order',
          version: '2.0',
          timestamp: Date.now(),
          requests,
        }),
      });

      const result = await response.json();
      expect(result.responses.length).toBe(10);

      for (let i = 0; i < 10; i++) {
        expect(result.responses[i].id).toBe(`req-${i}`);
        expect(result.responses[i].data).toBe(`Hello, User${i}!`);
      }
    });
  });

  describe('Error Handling', () => {
    test('should return proper error for non-existent service', async () => {
      const response = await fetch(`${BASE_URL}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'err-1',
          version: '2.0',
          timestamp: Date.now(),
          service: 'NonExistentService',
          method: 'someMethod',
          input: [],
        }),
      });

      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error.code).toBe('404');
    });

    test('should return proper error for non-existent method', async () => {
      const response = await fetch(`${BASE_URL}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'err-2',
          version: '2.0',
          timestamp: Date.now(),
          service: 'TestService',
          method: 'nonExistentMethod',
          input: [],
        }),
      });

      const result = await response.json();
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    test('should handle invalid request format', async () => {
      const response = await fetch(`${BASE_URL}/netron/invoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invalid: 'request',
        }),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('Performance', () => {
    test('should handle slow method with appropriate delay', async () => {
      const delayMs = 500;
      const start = Date.now();

      const result = await invoke('TestService', 'slowMethod', [delayMs]);

      const elapsed = Date.now() - start;
      expect(result).toBe(`Completed after ${delayMs}ms`);
      expect(elapsed).toBeGreaterThanOrEqual(delayMs);
    });

    test('should handle batch efficiently', async () => {
      const requests = Array.from({ length: 50 }, (_, i) => ({
        id: `perf-${i}`,
        service: 'TestService',
        method: 'hello',
        input: [`User${i}`],
      }));

      const start = Date.now();

      const response = await fetch(`${BASE_URL}/netron/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'perf-batch',
          version: '2.0',
          timestamp: Date.now(),
          requests,
        }),
      });

      const elapsed = Date.now() - start;
      const result = await response.json();

      expect(result.id).toBe('perf-batch');
      expect(result.responses.length).toBe(50);
      // Batch should be faster than sequential (each hello takes 50ms, so 50 * 50ms = 2500ms sequential)
      expect(elapsed).toBeLessThan(2500);
    });
  });
});
