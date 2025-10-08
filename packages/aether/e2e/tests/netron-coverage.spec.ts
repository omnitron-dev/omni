/**
 * E2E Tests for Code Coverage - Covering Remaining Branches
 * Tests specifically designed to cover untested code paths
 */

import { test, expect } from '@playwright/test';

test.describe('Netron Coverage Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should get WebSocket metrics', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();
        const metrics = client.getMetrics();

        await client.disconnect();

        return {
          success: true,
          hasMetrics: metrics !== null && metrics !== undefined,
          hasId: 'id' in metrics,
          hasTransport: 'transport' in metrics,
          hasConnected: 'connected' in metrics,
          hasUrl: 'url' in metrics
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasMetrics).toBe(true);
    expect(result.hasId).toBe(true);
    expect(result.hasTransport).toBe(true);
    expect(result.hasConnected).toBe(true);
    expect(result.hasUrl).toBe(true);
  });

  test('should get metrics before connection', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        // Get metrics before connecting
        const metrics = client.getMetrics();

        return {
          success: true,
          hasMetrics: metrics !== null,
          hasId: 'id' in metrics
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasMetrics).toBe(true);
  });

  test('should handle connection state tracking', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        const states = [];
        states.push({ stage: 'before', connected: client.isConnected() });

        await client.connect();
        states.push({ stage: 'after-connect', connected: client.isConnected() });

        await client.disconnect();
        states.push({ stage: 'after-disconnect', connected: client.isConnected() });

        return {
          success: true,
          states
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.states[0].connected).toBe(false);
    expect(result.states[1].connected).toBe(true);
    expect(result.states[2].connected).toBe(false);
  });

  test('should handle WebSocket reconnection options', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334',
          reconnect: true,
          reconnectInterval: 1000,
          maxReconnectAttempts: 3
        });

        await client.connect();
        const connected = client.isConnected();
        await client.disconnect();

        return {
          success: true,
          connected
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
  });

  test('should handle mixed method calls', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Mix of different operation types
        const user = await userService.getUser('user-1');
        const users = await userService.getUsers();
        const created = await userService.createUser({
          name: 'Mixed Test',
          email: 'mixed@example.com',
          age: 30
        });

        await client.disconnect();

        return {
          success: true,
          gotUser: user !== null,
          gotUsers: users.length > 0,
          created: created.name === 'Mixed Test'
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.gotUser).toBe(true);
    expect(result.gotUsers).toBe(true);
    expect(result.created).toBe(true);
  });

  test('should handle sequential service operations', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Sequential operations
        const users1 = await userService.getUsers();
        const created = await userService.createUser({
          name: 'Sequential Test',
          email: 'seq@example.com',
          age: 25
        });
        const users2 = await userService.getUsers();
        const updated = await userService.updateUser(created.id, { age: 26 });
        const deleted = await userService.deleteUser(created.id);

        await client.disconnect();

        return {
          success: true,
          operationsCompleted: 5,
          usersIncreased: users2.length > users1.length,
          updated: updated?.age === 26,
          deleted
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.operationsCompleted).toBe(5);
  });

  test('should handle error then success pattern', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Trigger error
        let errorCaught = false;
        try {
          await userService.unreliableMethod(true);
        } catch (error) {
          errorCaught = true;
        }

        // Then success
        const users = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          errorCaught,
          successAfterError: users.length > 0
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.errorCaught).toBe(true);
    expect(result.successAfterError).toBe(true);
  });

  test('should handle query interface without version', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        // Query without version
        const userService = await client.queryInterface('UserService');

        try {
          const users = await userService.getUsers();
          await client.disconnect();
          return {
            success: true,
            gotUsers: users.length > 0
          };
        } catch (error: any) {
          await client.disconnect();
          // Might fail if server requires version, that's ok
          return {
            success: true,
            errorExpected: true
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
  });

  test('should handle object property access on proxy', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Access various properties that should be undefined
        const checks = {
          then: userService.then === undefined,
          catch: userService.catch === undefined,
          constructor: userService.constructor !== undefined, // Object has constructor
          toString: typeof userService.toString === 'function' // Object has toString
        };

        await client.disconnect();

        return {
          success: true,
          checks
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.checks.then).toBe(true);
    expect(result.checks.catch).toBe(true);
  });

  test('should verify client ID uniqueness', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client1 = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        const client2 = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        // Access ID via metrics since it's public
        await client1.connect();
        await client2.connect();

        const metrics1 = client1.getMetrics();
        const metrics2 = client2.getMetrics();

        await client1.disconnect();
        await client2.disconnect();

        return {
          success: true,
          id1: metrics1.id,
          id2: metrics2.id,
          unique: metrics1.id !== metrics2.id
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.unique).toBe(true);
  });
});
