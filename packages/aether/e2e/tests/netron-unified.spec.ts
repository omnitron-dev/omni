/**
 * E2E Tests for Unified Netron Client
 * Tests both HTTP and WebSocket transports with the new unified API
 */

import { test, expect } from '@playwright/test';

test.describe('Unified Netron Client - HTTP Transport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should create Netron client with HTTP transport', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        return {
          success: true,
          connected: client.isConnected(),
          transport: client.getTransport()
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.transport).toBe('http');
  });

  test('should invoke service methods via HTTP', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');
        const users = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          users,
          count: users.length
        };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.users[0]).toHaveProperty('id');
    expect(result.users[0]).toHaveProperty('name');
  });

  test('should handle fluent interface pattern with HTTP', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Call multiple methods in sequence
        const users = await userService.getUsers();
        const firstUser = await userService.getUser(users[0].id);
        const newUser = await userService.createUser({
          name: 'Test User',
          email: 'test@example.com',
          age: 25,
          active: true
        });

        await client.disconnect();

        return {
          success: true,
          allUsers: users.length,
          firstUser: firstUser !== null,
          newUser: newUser.name === 'Test User'
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.allUsers).toBeGreaterThan(0);
    expect(result.firstUser).toBe(true);
    expect(result.newUser).toBe(true);
  });

  test('should handle errors gracefully', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Try to get non-existent user
        const user = await userService.getUser('non-existent-id');

        await client.disconnect();

        return {
          success: true,
          user: user === null
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBe(true);
  });

  test('should support CRUD operations', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333',
          timeout: 10000
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Create
        const newUser = await userService.createUser({
          name: 'CRUD Test',
          email: 'crud@test.com',
          age: 30,
          active: true
        });

        // Read
        const fetchedUser = await userService.getUser(newUser.id);

        // Update
        const updatedUser = await userService.updateUser(newUser.id, {
          age: 31
        });

        // Delete
        const deleted = await userService.deleteUser(newUser.id);

        // Verify deletion
        const deletedUser = await userService.getUser(newUser.id);

        await client.disconnect();

        return {
          success: true,
          created: newUser.name === 'CRUD Test',
          fetched: fetchedUser?.name === 'CRUD Test',
          updated: updatedUser?.age === 31,
          deleted: deleted === true,
          verifyDeleted: deletedUser === null
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.fetched).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.verifyDeleted).toBe(true);
  });

  test('should get metrics', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const metrics = client.getMetrics();

        await client.disconnect();

        return {
          success: true,
          metrics: metrics !== null,
          hasId: 'id' in metrics
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.metrics).toBe(true);
    expect(result.hasId).toBe(true);
  });

  test('should reject events with HTTP transport', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        // Try to subscribe (should fail)
        try {
          await client.subscribe('test.event', () => {});
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            errorMessage: error.message.includes('not supported')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.errorMessage).toBe(true);
  });
});

test.describe('Unified Netron Client - Advanced Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should handle concurrent requests', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Make 5 concurrent requests
        const promises = [];
        for (let i = 0; i < 5; i++) {
          promises.push(userService.getUsers());
        }

        const results = await Promise.all(promises);

        await client.disconnect();

        return {
          success: true,
          count: results.length,
          allValid: results.every(r => Array.isArray(r) && r.length > 0)
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('Concurrent test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.count).toBe(5);
    expect(result.allValid).toBe(true);
  });

  test('should handle timeout configuration', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333',
          timeout: 100 // Very short timeout
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Try to call slow method (should timeout)
        // Pass 5000ms delay, which is much longer than our 100ms timeout
        try {
          await userService.slowMethod(5000);
          return { success: false, error: 'Should have timed out' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            timedOut: error.message.includes('timeout') || error.message.includes('abort') || error.message.includes('Timeout')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('Timeout test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(true);
  });

  test('should handle custom headers', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333',
          headers: {
            'X-Custom-Header': 'test-value'
          }
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');
        const users = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          users: users.length > 0
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('Custom headers test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.users).toBe(true);
  });
});
