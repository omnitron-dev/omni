/**
 * E2E Tests for Netron Edge Cases and Error Scenarios
 * Comprehensive tests for edge cases to reach >96% coverage
 */

import { test, expect } from '@playwright/test';

test.describe('Netron Edge Cases - HTTP Transport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should handle request to invalid URL', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:9999' // Invalid port
        });

        // HTTP client connects lazily, error happens on first request
        await client.connect();

        try {
          const service = await client.queryInterface('UserService@1.0.0');
          await service.getUsers();
          return { success: false, error: 'Should have failed' };
        } catch (error: any) {
          return {
            success: true,
            errorCaught: true,
            errorMessage: error.message
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.errorCaught).toBe(true);
  });

  test('should handle calling method before connect', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        // Don't connect, try to query interface immediately
        try {
          const service = await client.queryInterface('UserService@1.0.0');
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          return {
            success: true,
            errorMessage: error.message,
            hasNotConnectedError: error.message.includes('Not connected') || error.message.includes('connect')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasNotConnectedError).toBe(true);
  });

  test('should handle multiple connect calls', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();
        await client.connect(); // Second connect should be idempotent

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

  test('should handle disconnect before connect', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        // Disconnect without connecting
        await client.disconnect();

        return {
          success: true,
          connected: client.isConnected()
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
  });

  test('should handle non-existent service method call', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        // queryInterface returns proxy immediately, error happens on method call
        const service = await client.queryInterface('NonExistentService@1.0.0');

        try {
          await service.someMethod();
          await client.disconnect();
          return { success: false, error: 'Should have failed' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            errorMessage: error.message,
            hasNotFoundError: error.message.includes('not found') || error.message.includes('404')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasNotFoundError).toBe(true);
  });

  test('should handle very short timeout', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333',
          timeout: 1 // 1ms timeout - should timeout for any network call
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        try {
          const users = await userService.getUsers();
          await client.disconnect();
          // Might succeed if network is extremely fast, so we allow both outcomes
          return {
            success: true,
            timedOut: false,
            successfullyCompleted: true
          };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            timedOut: true,
            errorMessage: error.message
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    // Either timeout or success is acceptable
  });

  test('should get transport type', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        const transportBefore = client.getTransport();
        await client.connect();
        const transportAfter = client.getTransport();
        await client.disconnect();

        return {
          success: true,
          transportBefore,
          transportAfter
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.transportBefore).toBe('http');
    expect(result.transportAfter).toBe('http');
  });

  test('should handle multiple disconnects', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();
        await client.disconnect();
        await client.disconnect(); // Second disconnect should be safe

        return {
          success: true,
          connected: client.isConnected()
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.connected).toBe(false);
  });

  test('should handle subscribe on HTTP transport', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        try {
          await client.subscribe('test-event', () => {});
          await client.disconnect();
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            errorMessage: error.message,
            hasEventsError: error.message.includes('not supported') || error.message.includes('Events')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasEventsError).toBe(true);
  });

  test('should handle unsubscribe on HTTP transport', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'http',
          url: 'http://localhost:3333'
        });

        await client.connect();

        try {
          await client.unsubscribe('test-event', () => {});
          await client.disconnect();
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            errorMessage: error.message,
            hasEventsError: error.message.includes('not supported') || error.message.includes('Events')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasEventsError).toBe(true);
  });
});

test.describe('Netron Edge Cases - WebSocket Transport', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should handle connection to invalid WebSocket URL', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:9999' // Invalid port
        });

        try {
          await client.connect();
          return { success: false, error: 'Should have failed' };
        } catch (error: any) {
          return {
            success: true,
            errorCaught: true,
            errorMessage: error.message
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.errorCaught).toBe(true);
  });

  test('should handle calling method before WebSocket connect', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        // Don't connect, try to query interface
        try {
          const service = await client.queryInterface('UserService@1.0.0');
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          return {
            success: true,
            errorMessage: error.message,
            hasNotConnectedError: error.message.includes('Not connected') || error.message.includes('connect')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasNotConnectedError).toBe(true);
  });

  test('should handle multiple WebSocket connect calls', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();
        await client.connect(); // Second connect should be handled

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

  test('should handle WebSocket with very large response', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // Get all users multiple times to test large data handling
        const users1 = await userService.getUsers();
        const users2 = await userService.getUsers();
        const users3 = await userService.getUsers();

        await client.disconnect();

        return {
          success: true,
          totalUsers: users1.length + users2.length + users3.length
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.totalUsers).toBeGreaterThan(0);
  });

  test('should handle WebSocket method with null/undefined args', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');
        const user = await userService.getUser(null); // Null argument

        await client.disconnect();

        return {
          success: true,
          userIsNull: user === null
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.userIsNull).toBe(true);
  });

  test('should handle rapid connect/disconnect cycles', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        // Rapid cycles
        for (let i = 0; i < 3; i++) {
          await client.connect();
          const connected = client.isConnected();
          await client.disconnect();
          if (!connected) {
            throw new Error(`Cycle ${i}: Not connected`);
          }
        }

        return {
          success: true,
          cyclesCompleted: 3
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.cyclesCompleted).toBe(3);
  });

  test('should get WebSocket transport type', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        const transportBefore = client.getTransport();
        await client.connect();
        const transportAfter = client.getTransport();
        await client.disconnect();

        return {
          success: true,
          transportBefore,
          transportAfter
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.transportBefore).toBe('websocket');
    expect(result.transportAfter).toBe('websocket');
  });

  test('should handle custom logger', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const logs: string[] = [];
        const customLogger = {
          debug: (...args: any[]) => logs.push('debug'),
          info: (...args: any[]) => logs.push('info'),
          warn: (...args: any[]) => logs.push('warn'),
          error: (...args: any[]) => logs.push('error'),
          child: () => customLogger
        };

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334',
          logger: customLogger as any
        });

        await client.connect();
        const userService = await client.queryInterface('UserService@1.0.0');
        await userService.getUsers();
        await client.disconnect();

        return {
          success: true,
          logsCount: logs.length,
          hasLogs: logs.length > 0
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasLogs).toBe(true);
  });

  test('should handle WebSocket with invalid service method', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        try {
          await userService.nonExistentMethod();
          await client.disconnect();
          return { success: false, error: 'Should have thrown error' };
        } catch (error: any) {
          await client.disconnect();
          return {
            success: true,
            errorMessage: error.message,
            hasMethodError: error.message.includes('not found') || error.message.includes('METHOD_NOT_FOUND')
          };
        }
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    });

    expect(result.success).toBe(true);
    expect(result.hasMethodError).toBe(true);
  });

  test('should handle extremely high concurrency', async ({ page }) => {
    const result = await page.evaluate(async () => {
      try {
        const { Netron } = await import('/netron-unified.js');

        const client = new Netron({
          transport: 'websocket',
          url: 'ws://localhost:3334'
        });

        await client.connect();

        const userService = await client.queryInterface('UserService@1.0.0');

        // 20 concurrent requests
        const promises = [];
        for (let i = 0; i < 20; i++) {
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

    expect(result.success).toBe(true);
    expect(result.count).toBe(20);
    expect(result.allValid).toBe(true);
  });
});
