/**
 * WebSocket Transport Module
 *
 * Exports WebSocket-specific components for Netron transport layer.
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

// Types
export type { WebSocketOptions } from './types.js';

// Core classes
export { WebSocketConnection } from './connection.js';
export { WebSocketServerAdapter } from './server.js';
export { WebSocketTransport } from './transport.js';

// Keep-alive
export { KeepAliveManager } from './keep-alive-manager.js';
export type { KeepAliveConfig } from './keep-alive-manager.js';

// Auth
export { WebSocketAuthHandler, createWebSocketAuthHandler } from './auth.js';
export type { WebSocketAuthOptions, MessageAccessResult } from './auth.js';
