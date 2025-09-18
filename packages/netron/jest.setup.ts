// Jest setup for netron tests
import { jest, beforeAll, afterAll } from '@jest/globals';

// Set test timeout
jest.setTimeout(30000);

// Ensure all Redis and WebSocket connections are tracked and closed
const activeRedisConnections = new Set<any>();
const activeWebSockets = new Set<any>();
const activeServers = new Set<any>();

// Hook into global for tracking
if (typeof global !== 'undefined') {
  (global as any).__activeRedisConnections = activeRedisConnections;
  (global as any).__activeWebSockets = activeWebSockets;
  (global as any).__activeServers = activeServers;
}

// Setup Redis test helper - use dynamic import to avoid issues
let redisHelper: any = null;

beforeAll(async () => {
  try {
    const helper = await import('./test/helpers/redis-test-helper.js');
    redisHelper = await helper.setupRedisForTests();
    // Set REDIS_URL environment variable for tests
    process.env['REDIS_URL'] = redisHelper.getConnectionString();
    console.log('Test Redis URL:', process.env['REDIS_URL']);
  } catch (error) {
    console.error('Failed to setup Redis for tests:', error);
    // Continue without Redis - some tests might not need it
  }
});

// Force cleanup after all tests
afterAll(async () => {
  // Wait a bit for any pending operations
  await new Promise(resolve => setTimeout(resolve, 100));

  // Teardown Redis helper
  if (redisHelper) {
    try {
      const helper = await import('./test/helpers/redis-test-helper.js');
      await helper.teardownRedisForTests();
    } catch (error) {
      console.error('Failed to teardown Redis:', error);
    }
  }

  // Force close any remaining Redis connections
  if (activeRedisConnections.size > 0) {
    console.warn(`Found ${activeRedisConnections.size} unclosed Redis connections, closing...`);
    for (const conn of activeRedisConnections) {
      try {
        if (conn && typeof conn.disconnect === 'function') {
          await conn.disconnect();
        } else if (conn && typeof conn.quit === 'function') {
          await conn.quit();
        }
      } catch (e) {
        // Ignore errors
      }
    }
    activeRedisConnections.clear();
  }

  // Close WebSocket connections
  if (activeWebSockets.size > 0) {
    console.warn(`Found ${activeWebSockets.size} unclosed WebSocket connections, closing...`);
    for (const conn of activeWebSockets) {
      try {
        if (conn && typeof conn.close === 'function') {
          conn.close();
        }
      } catch (e) {
        // Ignore errors
      }
    }
    activeWebSockets.clear();
  }

  // Close servers
  if (activeServers.size > 0) {
    console.warn(`Found ${activeServers.size} unclosed servers, closing...`);
    for (const server of activeServers) {
      try {
        if (server && typeof server.close === 'function') {
          await new Promise((resolve) => server.close(resolve));
        }
      } catch (e) {
        // Ignore errors
      }
    }
    activeServers.clear();
  }

  // Clean up environment variable
  delete process.env['REDIS_URL'];
});