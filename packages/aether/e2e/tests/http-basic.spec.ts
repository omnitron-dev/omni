/**
 * Basic HTTP Transport E2E Tests
 * Tests browser Netron HTTP client with real Titan backend
 */

import { test, expect, Page } from '@playwright/test';

test.describe('HTTP Transport - Basic Connection and RPC', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/');

    // Initialize test state
    await page.evaluate(() => {
      (window as any).testState = {
        client: null,
        results: [],
      };
    });
  });

  test('should load test page successfully', async () => {
    const title = await page.title();
    expect(title).toBeTruthy();

    // Check that page content is loaded
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('should create and initialize HTTP client', async () => {
    const result = await page.evaluate(async () => {
      try {
        // Import HttpNetronClient from bundled build
        const { HttpNetronClient } = await import('/netron-client.js');

        // Create client
        const client = new HttpNetronClient({
          baseUrl: 'http://localhost:3333',
        });

        // Initialize
        await client.initialize();

        // Store for other tests
        (window as any).testState.client = client;

        return { success: true, clientId: client.getMetrics?.()?.clientId ?? 'unknown' };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
  });

  test('should call getUsers RPC method', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        // Get service interface
        const userService = await client.queryInterface('UserService@1.0.0');
        const users = await userService.getUsers();

        return {
          success: true,
          users,
          count: users.length,
        };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThan(0);
    expect(result.users[0]).toHaveProperty('id');
    expect(result.users[0]).toHaveProperty('name');
    expect(result.users[0]).toHaveProperty('email');
  });

  test('should get single user by ID', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        const userService = await client.queryInterface('UserService@1.0.0');
        const user = await userService.getUser('user-1');

        return { success: true, user };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.id).toBe('user-1');
    expect(result.user).toHaveProperty('name');
    expect(result.user).toHaveProperty('email');
  });

  test('should create new user', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        const userService = await client.queryInterface('UserService@1.0.0');
        const newUser = await userService.createUser({
          name: 'Test User',
          email: 'test@example.com',
          age: 30,
        });

        return { success: true, user: newUser };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.name).toBe('Test User');
    expect(result.user.email).toBe('test@example.com');
    expect(result.user.age).toBe(30);
    expect(result.user).toHaveProperty('id');
    expect(result.user).toHaveProperty('createdAt');
  });

  test('should update existing user', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        const userService = await client.queryInterface('UserService@1.0.0');
        const updatedUser = await userService.updateUser('user-1', {
          name: 'Updated Name',
          age: 35,
        });

        return { success: true, user: updatedUser };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user.id).toBe('user-1');
    expect(result.user.name).toBe('Updated Name');
    expect(result.user.age).toBe(35);
  });

  test('should delete user', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        const userService = await client.queryInterface('UserService@1.0.0');
        const deleted = await userService.deleteUser('user-3');

        return { success: true, deleted };
      } catch (error: any) {
        return { success: false, error: error.message, stack: error.stack };
      }
    });

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
  });

  test('should handle non-existent user gracefully', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        const userService = await client.queryInterface('UserService@1.0.0');
        const user = await userService.getUser('non-existent-id');

        return { success: true, user };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeNull();
  });

  test('should reuse client instance across calls', async () => {
    const result = await page.evaluate(async () => {
      try {
        const { HttpNetronClient } = await import('/netron-client.js');
        const client = new HttpNetronClient({ baseUrl: 'http://localhost:3333' });
        await client.initialize();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Make multiple calls with same client
        const users1 = await userService.getUsers();
        const users2 = await userService.getUsers();
        const user = await userService.getUser('user-1');

        return {
          success: true,
          count1: users1.length,
          count2: users2.length,
          singleUser: user.id,
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.count1).toBe(result.count2);
    expect(result.singleUser).toBe('user-1');
  });
});
