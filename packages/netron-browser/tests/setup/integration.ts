/**
 * Setup file for integration tests
 * Provides WebSocket polyfill for Node.js environment
 */

import { WebSocket } from 'ws';

// Polyfill WebSocket for Node.js environment
if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}