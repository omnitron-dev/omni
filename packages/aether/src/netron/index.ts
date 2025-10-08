import 'reflect-metadata';

// Basic types and utilities first
export * from './uid.js';
export * from './types.js';
export * from './utils.js';
export * from './constants.js';

// Core classes - order matters for initialization
export * from './definition.js';
export * from './reference.js';
export * from './stream-reference.js';

// Abstract peer MUST come before Interface and LocalPeer to avoid circular dependency
export * from './abstract-peer.js';

// Interfaces and decorators
export * from './interface.js';

// Predicates - exported after all classes they depend on
export * from './predicates.js';

// Stream classes
export * from './writable-stream.js';
export * from './readable-stream.js';

// Other components
export * from './task-manager.js';

// Packet system (includes serializer)
export * from './packet/index.js';

// Export decorators from decorators/core
export { Service, Public, Method } from './decorators.js';

// Logger
export { BrowserLogger, type ILogger } from './logger.js';

// Browser client exports (main API)
export { BrowserNetronClient, type BrowserNetronClientOptions } from './client.js';
export { WebSocketRemotePeer as BrowserRemotePeer } from './clients/websocket/peer.js';
export { BrowserWebSocketConnection, type WebSocketClientOptions } from './clients/websocket/client.js';
export { HttpNetronClient, type HttpClientOptions } from './http-client.js';
