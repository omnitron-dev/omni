/**
 * WebSocket Transport Types
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import type { TransportOptions } from '../types.js';

/**
 * WebSocket-specific transport options
 */
export interface WebSocketOptions extends TransportOptions {
  /** Server host for listening */
  host?: string;

  /** Server port for listening */
  port?: number;

  /** WebSocket sub-protocols */
  protocols?: string[];

  /** Per-message deflate compression */
  perMessageDeflate?: boolean | object;

  /** Maximum payload size in bytes */
  maxPayload?: number;

  /** Handshake timeout in milliseconds */
  handshakeTimeout?: number;

  /** Origin for browser WebSocket */
  origin?: string;

  /** Path prefix for WebSocket upgrade path matching (for reverse proxy support) */
  pathPrefix?: string;
}
