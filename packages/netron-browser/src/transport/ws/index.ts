/**
 * WebSocket Transport for Browser
 *
 * Browser-compatible WebSocket transport implementation.
 */

export { WebSocketConnection, ConnectionState, type WebSocketConnectionOptions } from './connection.js';
export { WebSocketPeer, type WebSocketPeerOptions } from './peer.js';

// Connection Manager
export {
  ConnectionManager,
  ConnectionManagerState,
  ManagedConnectionState,
  DEFAULT_CONNECTION_MANAGER_CONFIG,
} from '../connection-manager.js';
export type {
  ConnectionManagerConfig,
  ManagedConnection,
  ConnectionPoolStats,
  ConnectionManagerEvents,
} from '../connection-manager.js';
