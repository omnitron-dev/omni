// Jest setup for netron tests
import { setupRedisForTests, teardownRedisForTests } from './test/helpers/redis-test-helper';

// Set test timeout
jest.setTimeout(30000);

// Setup Redis for all tests
beforeAll(async () => {
  const helper = await setupRedisForTests();
  // Set REDIS_URL environment variable for tests
  process.env['REDIS_URL'] = helper.getConnectionString();
  console.log('Test Redis URL:', process.env['REDIS_URL']);
});

// Teardown Redis after all tests
afterAll(async () => {
  await teardownRedisForTests();
  // Clean up environment variable
  delete process.env['REDIS_URL'];
});

// Track WebSocket connections and servers
const activeConnections = new Set<any>();
const activeServers = new Set<any>();

if (typeof global !== 'undefined') {
  (global as any).__activeWebSockets = activeConnections;
  (global as any).__activeServers = activeServers;
}

// Force cleanup after all tests
afterAll(async () => {
  // Wait for pending operations
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Close WebSocket connections
  if (activeConnections.size > 0) {
    console.warn(`Found ${activeConnections.size} unclosed WebSocket connections`);
    for (const conn of activeConnections) {
      try {
        if (conn && typeof conn.close === 'function') {
          conn.close();
        }
      } catch (e) {
        // Ignore
      }
    }
    activeConnections.clear();
  }

  // Close servers
  if (activeServers.size > 0) {
    console.warn(`Found ${activeServers.size} unclosed servers`);
    for (const server of activeServers) {
      try {
        if (server && typeof server.close === 'function') {
          await new Promise((resolve) => server.close(resolve));
        }
      } catch (e) {
        // Ignore
      }
    }
    activeServers.clear();
  }
});
