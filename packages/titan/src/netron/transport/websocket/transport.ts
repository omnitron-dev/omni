/**
 * WebSocket Transport Implementation
 *
 * Default transport for Netron, providing WebSocket connectivity for both browser and Node.js.
 * Fully compatible with the existing Netron WebSocket implementation.
 *
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import { WebSocket, WebSocketServer } from 'ws';
import { BaseTransport } from '../base-transport.js';
import type { TransportCapabilities, ITransportConnection, ITransportServer } from '../types.js';
import { NetronErrors, Errors } from '../../../errors/index.js';
import { WebSocketConnection } from './connection.js';
import { WebSocketServerAdapter } from './server.js';
import type { WebSocketOptions } from './types.js';

/**
 * WebSocket Transport
 */
export class WebSocketTransport extends BaseTransport {
  readonly name = 'websocket';
  readonly capabilities: TransportCapabilities = {
    streaming: true,
    bidirectional: true,
    binary: true,
    reconnection: false, // WebSockets don't support native reconnection
    multiplexing: false,
    server: true,
  };

  /**
   * Connect to a WebSocket server
   */
  async connect(address: string, options: WebSocketOptions = {}): Promise<ITransportConnection> {
    const parsed = this.parseAddress(address);

    // Build WebSocket URL
    let url: string;
    if (address.startsWith('ws://') || address.startsWith('wss://')) {
      url = address;
    } else if (parsed.host && parsed.port) {
      const protocol = options.headers?.['X-Forwarded-Proto'] === 'https' ? 'wss' : 'ws';
      url = `${protocol}://${parsed.host}:${parsed.port}${parsed.path || ''}`;
    } else {
      throw Errors.badRequest(`Invalid WebSocket address: ${address}`, { address, parsed });
    }

    // Detect environment
    const isNode = typeof window === 'undefined';

    if (isNode) {
      // Node.js environment
      const socket = new WebSocket(url, options.protocols, {
        perMessageDeflate: options.perMessageDeflate,
        maxPayload: options.maxPayload,
        handshakeTimeout: options.handshakeTimeout ?? options.connectTimeout,
        headers: options.headers,
      });

      // Create connection with URL for reconnection support
      const connection = new WebSocketConnection(socket, options, false, url);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.terminate();
          reject(NetronErrors.connectionTimeout('websocket', address));
        }, options.connectTimeout ?? 10000);

        socket.once('open', () => {
          clearTimeout(timeout);
          // Nothing the server sent may be delivered before the caller of
          // `connect()` has had its turn to listen.
          //
          // `ws` hands over the bytes that arrived in the SAME read as the
          // `101 Switching Protocols` response by unshifting them onto the
          // socket, and the socket replays them on `process.nextTick` — which
          // runs before any promise continuation. So when the server's first
          // frame shares a read with the 101, it is emitted while the caller
          // is still waiting for this promise to settle, and the connection
          // re-emits it to no listener. In Netron that frame is the handshake
          // (`{type:'id'}`, sent 10 ms after the server accepts): it was lost
          // and `Netron.connect()` waited for it forever. Two writes 10 ms
          // apart share one read whenever the client is not reading for 10 ms
          // — a GC pause, a descheduled process, a busy loop. Measured with
          // 200 busy loops on the machine: 4, 5 and 4 of 2400 connects hung
          // in three runs, 0 of 7200 with the pause below
          // (`a-handshake-the-client-heard-before-it-listened.test.ts`).
          //
          // TCP never had this (measured with the same stall), nor Unix
          // sockets, which share its connection class: their data arrives in
          // its own I/O callback, after every continuation queued by
          // 'connect'. Pausing
          // here and resuming on the next macrotask gives this transport the
          // same order — the bytes stay buffered in the socket, nothing is
          // copied or dropped, and `setImmediate` runs only after every
          // microtask, including the caller's continuation, has drained.
          socket.pause();
          resolve(connection);
          setImmediate(() => socket.resume());
        });

        socket.once('error', (error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    } else {
      // Browser environment
      const BrowserWebSocket = (window as any).WebSocket || (window as any).MozWebSocket;
      if (!BrowserWebSocket) {
        throw Errors.notImplemented('WebSocket is not supported in this browser');
      }

      const socket = new BrowserWebSocket(url, options.protocols) as unknown as WebSocket;
      const connection = new WebSocketConnection(socket, options, false, url);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.close();
          reject(NetronErrors.connectionTimeout('websocket', url));
        }, options.connectTimeout ?? 10000);

        connection.once('connect', () => {
          clearTimeout(timeout);
          resolve(connection);
        });

        connection.once('error', (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        });
      });
    }
  }

  /**
   * Create a WebSocket server
   */
  override async createServer(addressOrOptions?: string | WebSocketOptions): Promise<ITransportServer> {
    // Check if we're in Node.js
    if (typeof window !== 'undefined') {
      throw Errors.notImplemented('Cannot create WebSocket server in browser environment');
    }

    // Accept either a `ws://host:port` address or an options object, matching
    // TcpTransport and UnixSocketTransport. Options-only used to be the whole
    // contract here, so a caller passing an address string got its host and
    // port silently dropped and the server bound the 0.0.0.0:8080 default —
    // no error, just a server nobody could reach at the address they asked for.
    let options: WebSocketOptions = {};
    let host = '0.0.0.0'; // Use 0.0.0.0 to bind to all interfaces
    let port = 8080;

    if (typeof addressOrOptions === 'string') {
      const parsed = this.parseAddress(addressOrOptions);
      host = parsed.host || host;
      port = parsed.port ?? port;
    } else if (addressOrOptions) {
      options = addressOrOptions;
      host = options.host || host;
      // `??`, not `||`. Port 0 is how a caller asks the OS for any free port
      // — what every test, sidecar and anything that must not collide passes
      // — and `0 || 8080` handed all of them the one port most likely to be
      // occupied. There is no bind error to read afterwards: when 8080 is
      // free the server comes up on it and nothing looks wrong, so this
      // surfaces as a connection timeout on a machine where something else
      // holds the port. `host` keeps `||`: an empty string is nobody's
      // deliberate value, while 0 is.
      port = options.port ?? port;
    }

    const wss = new WebSocketServer({
      host,
      port,
      perMessageDeflate: options.perMessageDeflate,
      maxPayload: options.maxPayload,
      ...((options as any).serverOptions || {}),
    });

    const server = new WebSocketServerAdapter(wss, options);

    // The WebSocketServer automatically starts listening when created with a port
    // Wait a bit to ensure it's ready
    await new Promise((resolve) => setTimeout(resolve, 100));

    return server;
  }

  /**
   * Parse WebSocket address with default port handling
   */
  override parseAddress(address: string): any {
    const parsed = super.parseAddress(address);

    // Add default ports for ws and wss protocols
    if (!parsed.port) {
      if (parsed.protocol === 'ws') {
        parsed.port = 80;
      } else if (parsed.protocol === 'wss') {
        parsed.port = 443;
      }
    }

    // Set default path if not specified
    if (!parsed.path) {
      parsed.path = '/';
    }

    return parsed;
  }

  /**
   * Check if address is valid WebSocket URL
   */
  override isValidAddress(address: string): boolean {
    try {
      // Check for WebSocket protocols explicitly in the address
      if (address.startsWith('ws://') || address.startsWith('wss://')) {
        new URL(address); // Validate URL format
        return true;
      }

      // WebSocket requires explicit ws:// or wss:// prefix
      // Don't accept plain addresses without protocol
      return false;
    } catch {
      return false;
    }
  }
}
