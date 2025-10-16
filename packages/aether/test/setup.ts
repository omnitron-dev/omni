/**
 * Test setup for Aether tests
 */

import { vi } from 'vitest';
import { TextEncoder, TextDecoder } from 'util';

// Polyfill for Node.js environment
global.TextEncoder = TextEncoder as any;
global.TextDecoder = TextDecoder as any;

// Mock fetch for Node.js
if (!global.fetch) {
  vi.stubGlobal('fetch', vi.fn());
}

// Mock WebSocket for Node.js
if (!global.WebSocket) {
  vi.stubGlobal('WebSocket', vi.fn());
}

// Mock Request/Response for Node.js
if (!global.Request) {
  vi.stubGlobal('Request', vi.fn());
}

if (!global.Response) {
  vi.stubGlobal('Response', vi.fn());
}

// Mock Headers for Node.js
if (!global.Headers) {
  vi.stubGlobal('Headers', vi.fn());
}

// Mock process.env for tests
process.env.NODE_ENV = 'test';

// Setup test timeouts
vi.setConfig({ testTimeout: 10000 });

// Cleanup after each test
afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
});
