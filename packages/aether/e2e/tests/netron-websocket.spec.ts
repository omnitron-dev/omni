/**
 * E2E Tests for Unified Netron Client - WebSocket Transport
 * Comprehensive tests for WebSocket transport functionality
 */

import { test, expect } from '@playwright/test';

test.describe('Unified Netron Client - WebSocket Transport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should create Netron client with WebSocket transport', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        return {
          success: true,
          connected: client.isConnected(),
          metrics: client.getMetrics(),
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket connection test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.connected).toBe(true);
    expect(result.metrics.connected).toBe(true);
  });

  test('should invoke service methods via WebSocket', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');
        const users = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          usersCount: users.length,
          hasUsers: users.length > 0,
          firstUser: users[0],
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket invoke test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.usersCount).toBeGreaterThan(0);
    expect(result.hasUsers).toBe(true);
    expect(result.firstUser).toHaveProperty('id');
    expect(result.firstUser).toHaveProperty('name');
  });

  test('should handle WebSocket method with arguments', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');
        const user = await userService.getUser('user-1');

        await client.disconnect();

        return {
          success: true,
          userId: user?.id,
          userName: user?.name,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket arguments test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.userId).toBe('user-1');
    expect(result.userName).toBeTruthy();
  });

  test('should handle errors gracefully via WebSocket', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');

        try {
          await userService.unreliableMethod(true); // Should fail
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            errorMessage: error.message,
            hasError: true,
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket error handling test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.hasError).toBe(true);
    expect(result.errorMessage).toBeTruthy();
  });

  test('should support CRUD operations via WebSocket', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');

        // Create
        const newUser = await userService.createUser({
          name: 'Test User WS',
          email: 'testws@example.com',
          age: 25,
        });

        // Read
        const readUser = await userService.getUser(newUser.id);

        // Update
        const updatedUser = await userService.updateUser(newUser.id, {
          age: 26,
        });

        // Delete
        const deleted = await userService.deleteUser(newUser.id);

        await client.disconnect();

        return {
          success: true,
          created: newUser.name === 'Test User WS',
          read: readUser?.id === newUser.id,
          updated: updatedUser?.age === 26,
          deleted: deleted === true,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket CRUD test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.created).toBe(true);
    expect(result.read).toBe(true);
    expect(result.updated).toBe(true);
    expect(result.deleted).toBe(true);
  });

  test('should handle concurrent requests via WebSocket', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');

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
          allValid: results.every((r) => Array.isArray(r) && r.length > 0),
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket concurrent test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.count).toBe(5);
    expect(result.allValid).toBe(true);
  });

  test('should handle timeout configuration via WebSocket', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 100 }); // Very short timeout
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');

        // Try to call slow method (should timeout)
        try {
          await userService.slowMethod(5000);
          return { success: false, error: 'Should have timed out' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            timedOut: error.message.includes('timeout') || error.message.includes('Timeout'),
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket timeout test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.timedOut).toBe(true);
  });

  test('should handle findUsers with filters via WebSocket', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');
        const activeUsers = await userService.findUsers({ active: true });
        const olderUsers = await userService.findUsers({ minAge: 30 });

        await client.disconnect();

        return {
          success: true,
          activeUsersCount: activeUsers.length,
          olderUsersCount: olderUsers.length,
          allActive: activeUsers.every((u: any) => u.active === true),
          allOlder: olderUsers.every((u: any) => u.age >= 30),
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket filters test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.activeUsersCount).toBeGreaterThan(0);
    expect(result.allActive).toBe(true);
    expect(result.allOlder).toBe(true);
  });

  test('should handle disconnect and reconnect', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });

        // Connect
        await client.connect('ws://localhost:3334');
        const connected1 = client.isConnected();

        // Disconnect
        await client.disconnect();
        const connected2 = client.isConnected();

        // Reconnect
        await client.connect('ws://localhost:3334');
        const connected3 = client.isConnected();

        // Test method call
        const userService = client.queryInterface('UserService@1.0.0');
        const users = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          connected1,
          connected2,
          connected3,
          usersCount: users.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket reconnect test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.connected1).toBe(true);
    expect(result.connected2).toBe(false);
    expect(result.connected3).toBe(true);
    expect(result.usersCount).toBeGreaterThan(0);
  });

  test('should properly return service proxy', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { BrowserNetronClient } = await import('/netron-unified.js');

        const client = new BrowserNetronClient({ timeout: 10000 });
        await client.connect('ws://localhost:3334');

        const userService = client.queryInterface('UserService@1.0.0');

        // Check that proxy behaves correctly
        const isObject = typeof userService === 'object';
        const hasGetUsers = typeof userService.getUsers === 'function';

        // Call a method
        const users = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          isObject,
          hasGetUsers,
          gotUsers: users.length > 0,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    if (!result.success) {
      console.error('WebSocket proxy test failed:', result.error);
    }
    expect(result.success).toBe(true);
    expect(result.isObject).toBe(true);
    expect(result.hasGetUsers).toBe(true);
    expect(result.gotUsers).toBe(true);
  });
});
