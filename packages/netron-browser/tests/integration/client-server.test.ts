/**
 * Integration tests for Netron Browser client with Titan server
 * These tests run in Node.js and are faster than E2E tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTitanServer, TitanServerFixture } from '../fixtures/titan-server.js';
import { HttpClient } from '../../src/client/http-client.js';
import { WebSocketClient } from '../../src/client/ws-client.js';

describe('HTTP Client Integration', () => {
  let server: TitanServerFixture;
  let client: HttpClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: false,
      logLevel: 'silent',
    });

    client = new HttpClient({
      url: server.httpUrl,
      timeout: 5000,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Calculator Service', () => {
    it('should add two numbers', async () => {
      const result = await client.invoke('calculator@1.0.0', 'add', [5, 3]);
      expect(result).toBe(8);
    });

    it('should subtract two numbers', async () => {
      const result = await client.invoke('calculator@1.0.0', 'subtract', [10, 4]);
      expect(result).toBe(6);
    });

    it('should multiply two numbers', async () => {
      const result = await client.invoke('calculator@1.0.0', 'multiply', [6, 7]);
      expect(result).toBe(42);
    });

    it('should divide two numbers', async () => {
      const result = await client.invoke('calculator@1.0.0', 'divide', [20, 4]);
      expect(result).toBe(5);
    });

    it('should handle division by zero', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'divide', [10, 0])
      ).rejects.toThrow('Division by zero');
    });

    it('should handle async operations', async () => {
      const result = await client.invoke('calculator@1.0.0', 'addAsync', [15, 25]);
      expect(result).toBe(40);
    });
  });

  describe('User Service', () => {
    it('should get a user by id', async () => {
      const user = await client.invoke('user@1.0.0', 'getUser', ['1']);
      expect(user).toEqual({
        id: '1',
        name: 'Alice',
        email: 'alice@example.com',
        role: 'admin',
      });
    });

    it('should list all users', async () => {
      const users = await client.invoke('user@1.0.0', 'listUsers', []);
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThanOrEqual(3);
      expect(users[0]).toHaveProperty('id');
      expect(users[0]).toHaveProperty('name');
      expect(users[0]).toHaveProperty('email');
    });

    it('should create a new user', async () => {
      const newUser = {
        name: 'Dave',
        email: 'dave@example.com',
        role: 'user',
      };

      const created = await client.invoke('user@1.0.0', 'createUser', [newUser]);
      expect(created).toMatchObject(newUser);
      expect(created).toHaveProperty('id');
    });

    it('should update a user', async () => {
      const updated = await client.invoke('user@1.0.0', 'updateUser', [
        '1',
        { name: 'Alice Updated' },
      ]);
      expect(updated.name).toBe('Alice Updated');
      expect(updated.id).toBe('1');
    });

    it('should delete a user', async () => {
      const result = await client.invoke('user@1.0.0', 'deleteUser', ['3']);
      expect(result).toEqual({ deleted: true, id: '3' });
    });

    it('should handle non-existent user', async () => {
      await expect(
        client.invoke('user@1.0.0', 'getUser', ['999'])
      ).rejects.toThrow('User not found');
    });
  });

  describe('Echo Service', () => {
    it('should echo a string', async () => {
      const result = await client.invoke('echo@1.0.0', 'echoString', ['Hello, World!']);
      expect(result).toBe('Hello, World!');
    });

    it('should echo a number', async () => {
      const result = await client.invoke('echo@1.0.0', 'echoNumber', [42]);
      expect(result).toBe(42);
    });

    it('should echo a boolean', async () => {
      const result = await client.invoke('echo@1.0.0', 'echoBoolean', [true]);
      expect(result).toBe(true);
    });

    it('should echo an object', async () => {
      const obj = { name: 'Test', value: 123, nested: { key: 'value' } };
      const result = await client.invoke('echo@1.0.0', 'echoObject', [obj]);
      expect(result).toEqual(obj);
    });

    it('should echo an array', async () => {
      const arr = [1, 2, 3, 'test', true, { key: 'value' }];
      const result = await client.invoke('echo@1.0.0', 'echoArray', [arr]);
      expect(result).toEqual(arr);
    });

    it('should handle async echo', async () => {
      const result = await client.invoke('echo@1.0.0', 'echoAsync', ['async test']);
      expect(result).toBe('async test');
    });

    it('should handle thrown errors', async () => {
      await expect(
        client.invoke('echo@1.0.0', 'throwError', ['Test error'])
      ).rejects.toThrow('Test error');
    });
  });

  describe('Stream Service', () => {
    it('should generate numbers', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateNumbers', [5]);
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });

    it('should generate data objects', async () => {
      const result = await client.invoke('stream@1.0.0', 'generateData', [3]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
      expect(result[0]).toHaveProperty('id');
      expect(result[0]).toHaveProperty('timestamp');
      expect(result[0]).toHaveProperty('value');
    });
  });

  describe('Performance', () => {
    it('should handle sequential calls efficiently', async () => {
      const startTime = Date.now();

      for (let i = 0; i < 10; i++) {
        await client.invoke('calculator@1.0.0', 'add', [i, i + 1]);
      }

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(1000); // Should complete in less than 1 second
    });

    it('should handle parallel calls efficiently', async () => {
      const startTime = Date.now();

      const promises = Array.from({ length: 10 }, (_, i) =>
        client.invoke('calculator@1.0.0', 'add', [i, i + 1])
      );

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;
      expect(duration).toBeLessThan(500); // Parallel should be faster
      expect(results).toHaveLength(10);
      expect(results[0]).toBe(1);
      expect(results[9]).toBe(19);
    });

    it('should provide metrics', () => {
      const metrics = client.getMetrics();
      expect(metrics).toHaveProperty('requestsSent');
      expect(metrics).toHaveProperty('responsesReceived');
      expect(metrics).toHaveProperty('errors');
      expect(metrics.requestsSent).toBeGreaterThan(0);
      expect(metrics.responsesReceived).toBeGreaterThan(0);
    });

    it('should handle high concurrency loads', async () => {
      const concurrency = 100;
      const promises = Array.from({ length: concurrency }, (_, i) =>
        client.invoke('calculator@1.0.0', 'add', [i, 1])
      );

      const start = Date.now();
      const results = await Promise.all(promises);
      const duration = Date.now() - start;

      expect(results.length).toBe(concurrency);
      expect(duration).toBeLessThan(2000); // Should handle 100 concurrent in under 2s

      results.forEach((result, i) => {
        expect(result).toBe(i + 1);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent service', async () => {
      await expect(
        client.invoke('nonexistent@1.0.0', 'someMethod', [])
      ).rejects.toThrow();
    });

    it('should handle non-existent method', async () => {
      await expect(
        client.invoke('calculator@1.0.0', 'nonExistentMethod', [])
      ).rejects.toThrow();
    });

    it('should handle invalid arguments', async () => {
      // Calling add with non-numbers - JavaScript will coerce to string concatenation
      const result = await client.invoke('calculator@1.0.0', 'add', ['a', 'b']);
      // JavaScript coercion makes this 'ab' (string concatenation)
      expect(result).toBe('ab');
    });
  });
});

describe('WebSocket Client Integration', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false, // Disable auto-reconnect for tests
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Calculator Service', () => {
    it('should add two numbers', async () => {
      const result = await client.invoke('calculator@1.0.0', 'add', [7, 3]);
      expect(result).toBe(10);
    });

    it('should multiply two numbers', async () => {
      const result = await client.invoke('calculator@1.0.0', 'multiply', [5, 5]);
      expect(result).toBe(25);
    });
  });

  describe('User Service', () => {
    it('should get a user by id', async () => {
      const user = await client.invoke('user@1.0.0', 'getUser', ['2']);
      expect(user).toEqual({
        id: '2',
        name: 'Bob',
        email: 'bob@example.com',
        role: 'user',
      });
    });

    it('should list all users', async () => {
      const users = await client.invoke('user@1.0.0', 'listUsers', []);
      expect(Array.isArray(users)).toBe(true);
      expect(users.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Echo Service', () => {
    it('should echo complex objects', async () => {
      const complexObj = {
        string: 'test',
        number: 42,
        boolean: true,
        array: [1, 2, 3],
        nested: {
          deep: {
            value: 'nested',
          },
        },
      };

      const result = await client.invoke('echo@1.0.0', 'echoObject', [complexObj]);
      expect(result).toEqual(complexObj);
    });
  });

  describe('Connection State', () => {
    it('should report connected state', () => {
      const state = client.getState();
      expect(state).toBe('connected');
    });

    it('should provide metrics', () => {
      const metrics = client.getMetrics();
      expect(metrics).toHaveProperty('requestsSent');
      expect(metrics).toHaveProperty('responsesReceived');
      expect(metrics.requestsSent).toBeGreaterThan(0);
    });
  });
});

describe('Mixed Transport Tests', () => {
  let server: TitanServerFixture;
  let httpClient: HttpClient;
  let wsClient: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: true,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    httpClient = new HttpClient({ url: server.httpUrl });
    wsClient = new WebSocketClient({ url: server.wsUrl, reconnect: false });

    await httpClient.connect();
    await wsClient.connect();
  });

  afterAll(async () => {
    await httpClient.disconnect();
    await wsClient.disconnect();
    await server.cleanup();
  });

  it('should get same results from both transports', async () => {
    const httpResult = await httpClient.invoke('calculator@1.0.0', 'add', [10, 20]);
    const wsResult = await wsClient.invoke('calculator@1.0.0', 'add', [10, 20]);

    expect(httpResult).toBe(30);
    expect(wsResult).toBe(30);
    expect(httpResult).toBe(wsResult);
  });

  it('should handle concurrent operations on both transports', async () => {
    const promises = [
      httpClient.invoke('calculator@1.0.0', 'add', [1, 1]),
      wsClient.invoke('calculator@1.0.0', 'add', [2, 2]),
      httpClient.invoke('calculator@1.0.0', 'multiply', [3, 3]),
      wsClient.invoke('calculator@1.0.0', 'multiply', [4, 4]),
    ];

    const results = await Promise.all(promises);
    expect(results).toEqual([2, 4, 9, 16]);
  });

  it('should handle complex objects identically across transports', async () => {
    const testData = {
      name: 'Test User',
      age: 30,
      tags: ['tag1', 'tag2', 'tag3'],
      metadata: {
        created: Date.now(),
        active: true,
      },
    };

    const httpResult = await httpClient.invoke('echo@1.0.0', 'echoObject', [testData]);
    const wsResult = await wsClient.invoke('echo@1.0.0', 'echoObject', [testData]);

    expect(httpResult).toEqual(testData);
    expect(wsResult).toEqual(testData);
    expect(httpResult).toEqual(wsResult);
  });

  it('should propagate errors identically across transports', async () => {
    const errorMessage = 'Test error across transports';

    // HTTP error
    let httpError: any;
    try {
      await httpClient.invoke('echo@1.0.0', 'throwError', [errorMessage]);
    } catch (e) {
      httpError = e;
    }

    // WebSocket error
    let wsError: any;
    try {
      await wsClient.invoke('echo@1.0.0', 'throwError', [errorMessage]);
    } catch (e) {
      wsError = e;
    }

    expect(httpError).toBeDefined();
    expect(wsError).toBeDefined();
    expect(httpError.message).toBe(errorMessage);
    expect(wsError.message).toBe(errorMessage);
  });

  it('should handle high load on both transports simultaneously', async () => {
    const httpOps = Array.from({ length: 50 }, (_, i) =>
      httpClient.invoke('calculator@1.0.0', 'add', [i, 100])
    );

    const wsOps = Array.from({ length: 50 }, (_, i) =>
      wsClient.invoke('calculator@1.0.0', 'add', [i, 200])
    );

    const [httpResults, wsResults] = await Promise.all([
      Promise.all(httpOps),
      Promise.all(wsOps),
    ]);

    expect(httpResults.length).toBe(50);
    expect(wsResults.length).toBe(50);

    httpResults.forEach((result, i) => {
      expect(result).toBe(i + 100);
    });

    wsResults.forEach((result, i) => {
      expect(result).toBe(i + 200);
    });
  });
});

describe('Advanced Integration Scenarios', () => {
  let server: TitanServerFixture;
  let client: WebSocketClient;

  beforeAll(async () => {
    server = await createTitanServer({
      enableHttp: false,
      enableWebSocket: true,
      logLevel: 'silent',
    });

    client = new WebSocketClient({
      url: server.wsUrl,
      reconnect: false,
    });

    await client.connect();
  });

  afterAll(async () => {
    await client.disconnect();
    await server.cleanup();
  });

  describe('Complex Service Interactions', () => {
    it('should handle multi-step workflows', async () => {
      // Create user
      const newUser = await client.invoke('user@1.0.0', 'createUser', [{
        name: 'Workflow User',
        email: 'workflow@test.com',
        role: 'user',
      }]);

      expect(newUser).toHaveProperty('id');
      const userId = newUser.id;

      // Update user
      const updated = await client.invoke('user@1.0.0', 'updateUser', [
        userId,
        { name: 'Updated Workflow User' },
      ]);

      expect(updated.name).toBe('Updated Workflow User');

      // Verify update
      const fetched = await client.invoke('user@1.0.0', 'getUser', [userId]);
      expect(fetched.name).toBe('Updated Workflow User');

      // Delete user
      const deleted = await client.invoke('user@1.0.0', 'deleteUser', [userId]);
      expect(deleted.deleted).toBe(true);
    });

    it('should handle mixed service calls in workflow', async () => {
      // Use calculator
      const sum = await client.invoke('calculator@1.0.0', 'add', [10, 20]);

      // Use result in another service call
      const users = await client.invoke('user@1.0.0', 'listUsers', []);
      expect(Array.isArray(users)).toBe(true);

      // Echo the combined data
      const combined = { sum, userCount: users.length };
      const echoed = await client.invoke('echo@1.0.0', 'echoObject', [combined]);

      expect(echoed).toEqual(combined);
    });

    it('should maintain state consistency across operations', async () => {
      // Get initial user count
      const initialUsers = await client.invoke('user@1.0.0', 'listUsers', []);
      const initialCount = initialUsers.length;

      // Create multiple users
      const createOps = Array.from({ length: 3 }, (_, i) =>
        client.invoke('user@1.0.0', 'createUser', [{
          name: `Batch User ${i}`,
          email: `batch${i}@test.com`,
          role: 'user',
        }])
      );

      await Promise.all(createOps);

      // Verify count increased
      const afterUsers = await client.invoke('user@1.0.0', 'listUsers', []);
      expect(afterUsers.length).toBe(initialCount + 3);
    });
  });

  describe('Data Type Compatibility', () => {
    it('should handle Date objects', async () => {
      const now = Date.now();
      const result = await client.invoke('echo@1.0.0', 'echoNumber', [now]);
      expect(result).toBe(now);
    });

    it('should handle special numeric values', async () => {
      const specialNumbers = [
        0,
        -0,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER,
        Number.MIN_SAFE_INTEGER,
      ];

      for (const num of specialNumbers) {
        const result = await client.invoke('echo@1.0.0', 'echoNumber', [num]);
        if (Object.is(num, -0)) {
          expect(Object.is(result, -0)).toBe(true);
        } else {
          expect(result).toBe(num);
        }
      }
    });

    it('should handle nested arrays', async () => {
      const nestedArray = [
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [[10, 11], [12, 13]],
      ];

      const result = await client.invoke('echo@1.0.0', 'echoArray', [nestedArray]);
      expect(result).toEqual(nestedArray);
    });

    it('should handle mixed type arrays', async () => {
      const mixedArray = [
        1,
        'two',
        true,
        null,
        { key: 'value' },
        [5, 6],
      ];

      const result = await client.invoke('echo@1.0.0', 'echoArray', [mixedArray]);
      expect(result).toEqual(mixedArray);
    });

    it('should handle sparse arrays', async () => {
      const sparseArray = [1, , 3, , 5]; // eslint-disable-line no-sparse-arrays
      const result = await client.invoke('echo@1.0.0', 'echoArray', [sparseArray]);

      // Note: Sparse arrays might be converted to dense arrays with undefined
      expect(result.length).toBe(sparseArray.length);
    });
  });

  describe('Connection Resilience', () => {
    it('should provide detailed connection metrics', () => {
      const metrics = client.getMetrics();

      expect(metrics).toHaveProperty('id');
      expect(metrics).toHaveProperty('url');
      expect(metrics).toHaveProperty('state');
      expect(metrics).toHaveProperty('transport');
      expect(metrics).toHaveProperty('requestsSent');
      expect(metrics).toHaveProperty('responsesReceived');
      expect(metrics).toHaveProperty('errors');

      expect(metrics.state).toBe('connected');
      expect(metrics.transport).toBe('websocket');
      expect(metrics.requestsSent).toBeGreaterThan(0);
    });

    it('should track errors separately from successful responses', async () => {
      const beforeMetrics = client.getMetrics();
      const beforeErrors = beforeMetrics.errors;

      // Trigger an error
      try {
        await client.invoke('calculator@1.0.0', 'divide', [10, 0]);
      } catch (e) {
        // Expected
      }

      const afterMetrics = client.getMetrics();
      expect(afterMetrics.errors).toBeGreaterThan(beforeErrors);
    });
  });
});
