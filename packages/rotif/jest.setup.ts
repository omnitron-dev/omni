// Jest setup for rotif tests
import { jest, afterAll } from '@jest/globals';

// Set test timeout
jest.setTimeout(30000);

// Ensure all Redis connections are tracked and closed
const activeConnections = new Set<any>();

// Hook into Redis client creation if needed
if (typeof global !== 'undefined') {
  (global as any).__activeRedisConnections = activeConnections;
}

// Force cleanup after all tests
afterAll(async () => {
  // Wait a bit for any pending operations
  await new Promise(resolve => setTimeout(resolve, 100));

  // Force close any remaining Redis connections
  if (activeConnections.size > 0) {
    console.warn(`Found ${activeConnections.size} unclosed Redis connections, closing...`);
    for (const conn of activeConnections) {
      try {
        if (conn && typeof conn.disconnect === 'function') {
          await conn.disconnect();
        }
      } catch (e) {
        // Ignore errors
      }
    }
    activeConnections.clear();
  }
});