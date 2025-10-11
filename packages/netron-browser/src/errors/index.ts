/**
 * Error system for Netron Browser Client
 * Compatible with Titan's error protocol for seamless client-server communication
 */

// Core error classes and types
export * from './codes.js';
export * from './core.js';
export * from './netron.js';
export * from './serialization.js';
export * from './factories.js';
export * from './legacy.js';

// Re-export commonly used items for convenience
export { ErrorCode, ErrorCategory } from './codes.js';
export { TitanError, createError, ensureError } from './core.js';
export {
  NetronError,
  ServiceNotFoundError,
  MethodNotFoundError,
  TransportError,
  PeerError,
  RpcError,
  StreamError,
  SerializationError,
} from './netron.js';
export { Errors, NetronErrors, toTitanError, assert, assertDefined, assertType } from './factories.js';
export {
  serializeError,
  deserializeError,
  parseHttpError,
  parseWebSocketError,
  serializeWebSocketError,
} from './serialization.js';
