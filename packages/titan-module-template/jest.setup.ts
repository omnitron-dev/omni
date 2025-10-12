// Jest setup for module tests
import { jest, beforeAll, afterAll } from '@jest/globals';
import 'reflect-metadata';

// Set test timeout
jest.setTimeout(30000);

// Track active connections and resources
const activeConnections = new Set<any>();
const activeTimers = new Set<NodeJS.Timeout>();

// Hook into global for tracking
if (typeof global !== 'undefined') {
  (global as any).__activeConnections = activeConnections;
  (global as any).__activeTimers = activeTimers;
}

// Setup before all tests
beforeAll(async () => {
  // Add any global setup here
  console.log('Starting tests for Titan module');
});

// Cleanup after all tests
afterAll(async () => {
  // Wait a bit for any pending operations
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Clean up any active connections
  if (activeConnections.size > 0) {
    console.warn(`Found ${activeConnections.size} unclosed connections, closing...`);
    for (const conn of activeConnections) {
      try {
        if (conn && typeof conn.close === 'function') {
          await conn.close();
        } else if (conn && typeof conn.disconnect === 'function') {
          await conn.disconnect();
        }
      } catch (e) {
        // Ignore errors
      }
    }
    activeConnections.clear();
  }

  // Clear any active timers
  if (activeTimers.size > 0) {
    console.warn(`Found ${activeTimers.size} active timers, clearing...`);
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.clear();
  }
});
