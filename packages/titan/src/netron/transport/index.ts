/**
 * Transport Abstraction Layer
 *
 * Exports all transport-related types and implementations.
 */

// Export types
export * from './types.js';

// Export base classes
export { BaseTransport, BaseConnection, BaseServer } from './base-transport.js';

// Export transport implementations
export { WebSocketTransport, WebSocketConnection, WebSocketServerAdapter, WebSocketOptions } from './websocket-transport.js';
export { TcpTransport, TcpConnection, TcpServer, TcpOptions } from './tcp-transport.js';
export { UnixSocketTransport, NamedPipeTransport, UnixSocketOptions } from './unix-transport.js';

// Export registry
export {
  TransportRegistry,
  getTransportRegistry,
  registerTransport,
  getTransport,
  getTransportForAddress
} from './transport-registry.js';

// Auto-register transports when module is imported
import { registerTransport } from './transport-registry.js';
import { WebSocketTransport } from './websocket-transport.js';
import { TcpTransport } from './tcp-transport.js';
import { UnixSocketTransport, NamedPipeTransport } from './unix-transport.js';

// Register default transports
if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js environment - register all transports
  registerTransport('ws', () => new WebSocketTransport());
  registerTransport('tcp', () => new TcpTransport());
  registerTransport('unix', () => new UnixSocketTransport());

  // Register named pipe for Windows
  if (process.platform === 'win32') {
    registerTransport('pipe', () => new NamedPipeTransport());
  }
} else {
  // Browser environment - only WebSocket
  registerTransport('ws', () => new WebSocketTransport());
}