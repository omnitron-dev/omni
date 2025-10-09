/**
 * WebSocket Transport Implementation
 *
 * Default transport for Netron, providing WebSocket connectivity for both browser and Node.js.
 * Fully compatible with the existing Netron WebSocket implementation.
 */

import { WebSocket, WebSocketServer, RawData } from 'ws';
import { IncomingMessage } from 'node:http';
import { BaseTransport, BaseConnection, BaseServer } from './base-transport.js';
import {
  TransportCapabilities,
  TransportOptions,
  ITransportConnection,
  ITransportServer,
  ConnectionState
} from './types.js';
import { NetronErrors, Errors } from '../../errors/index.js';

/**
 * WebSocket-specific options
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
}

/**
 * WebSocket connection implementation
 */
export class WebSocketConnection extends BaseConnection {
  private socket: WebSocket;
  private pingInterval?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;

  constructor(socket: WebSocket, options: WebSocketOptions = {}, isServer = false) {
    super(options);
    this.socket = socket;
    (this as any).isServer = isServer;
    this.setupEventHandlers();

    // Start keep-alive if enabled
    if (options.keepAlive?.enabled) {
      this.startKeepAlive();
    }

    // If socket is already open, emit connect immediately
    if (socket.readyState === WebSocket.OPEN) {
      // Use setImmediate to ensure event handlers are attached first
      setImmediate(() => this.handleConnect());
    }
  }

  get remoteAddress(): string | undefined {
    // @ts-expect-error - _socket exists on ws WebSocket
    return this.socket._socket?.remoteAddress;
  }

  get localAddress(): string | undefined {
    // @ts-expect-error - _socket exists on ws WebSocket
    return this.socket._socket?.localAddress;
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    // Handle connection open
    this.socket.on('open', () => {
      this.handleConnect();
    });

    // Handle incoming messages
    this.socket.on('message', (data: RawData) => {
      const buffer = data instanceof Buffer ? data :
        data instanceof ArrayBuffer ? Buffer.from(data) :
          Buffer.concat(data as Buffer[]);
      this.handleData(buffer);
    });

    // Handle errors
    this.socket.on('error', (error: Error) => {
      this.setState(ConnectionState.ERROR);
      this.emit('error', error);
    });

    // Handle close
    this.socket.on('close', (code: number, reason: Buffer) => {
      this.cleanup();
      this.handleDisconnect(reason?.toString());
    });

    // Handle pong for keep-alive
    this.socket.on('pong', () => {
      if (this.pongTimeout) {
        clearTimeout(this.pongTimeout);
        this.pongTimeout = undefined;
      }
    });

    // If socket is already open, emit connect
    if (this.socket.readyState === WebSocket.OPEN) {
      this.handleConnect();
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.setState(ConnectionState.CONNECTING);
    }
  }

  /**
   * Start keep-alive mechanism
   */
  private startKeepAlive(): void {
    const interval = this.options.keepAlive?.interval ?? 30000;
    const timeout = this.options.keepAlive?.timeout ?? 5000;

    this.pingInterval = setInterval(() => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.ping();

        // Set pong timeout
        this.pongTimeout = setTimeout(() => {
          this.socket.terminate();
        }, timeout);
      }
    }, interval);
  }

  /**
   * Send data through WebSocket
   */
  async send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) {
        reject(NetronErrors.connectionClosed('websocket', 'WebSocket is not in OPEN state'));
        return;
      }

      this.socket.send(data, (error) => {
        if (error) {
          reject(error);
        } else {
          this.metrics.bytesSent += data.byteLength;
          resolve();
        }
      });
    });
  }

  /**
   * Close the WebSocket connection
   */
  async close(code: number = 1000, reason?: string): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.readyState === WebSocket.CLOSED) {
        resolve();
        return;
      }

      this.setState(ConnectionState.DISCONNECTING);

      const closeHandler = () => {
        this.socket.removeListener('close', closeHandler);
        resolve();
      };

      this.socket.on('close', closeHandler);
      this.socket.close(code, reason);

      // Force close after timeout
      setTimeout(() => {
        if (this.socket.readyState !== WebSocket.CLOSED) {
          this.socket.terminate();
        }
        resolve();
      }, 5000);
    });
  }

  /**
   * Reconnect the WebSocket
   */
  protected async doReconnect(): Promise<void> {
    // WebSocket doesn't support direct reconnection,
    // would need to create new socket with same URL
    throw Errors.notImplemented('WebSocket reconnection requires creating new connection');
  }

  /**
   * Clean up resources
   */
  protected override cleanup(): void {
    super.cleanup();

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = undefined;
    }

    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = undefined;
    }
  }
}

/**
 * WebSocket server implementation
 */
export class WebSocketServerAdapter extends BaseServer {
  private wss: WebSocketServer;
  private httpServer?: any;

  constructor(wss: WebSocketServer, options: WebSocketOptions = {}) {
    super(options);
    this.wss = wss;
    this.setupEventHandlers();

    // Don't emit listening in constructor - wait for listen() to be called
  }

  get address(): string | undefined {
    const addr = this.wss.address();
    if (typeof addr === 'string') return addr;
    return addr?.address;
  }

  get port(): number | undefined {
    const addr = this.wss.address();
    if (typeof addr === 'object' && addr !== null) {
      return addr.port;
    }
    // Fallback to options if address() doesn't work yet
    return (this.wss as any).options?.port;
  }

  /**
   * Setup WebSocket server event handlers
   */
  private setupEventHandlers(): void {
    // Handle new connections
    this.wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
      const connection = new WebSocketConnection(socket, this.options as WebSocketOptions, true);

      // Add request info to connection
      (connection as any).request = request;

      this.handleConnection(connection);
    });

    // Handle server errors
    this.wss.on('error', (error: Error) => {
      this.emit('error', error);
    });

    // Handle server close
    this.wss.on('close', () => {
      this.handleClose();
    });

    // If server is already listening
    // @ts-expect-error - WebSocketServer doesn't have a listening property, but it works
    if (this.wss.listening || (this.wss as any).options?.server) {
      this.handleListening();
    }
  }

  /**
   * Start listening (WebSocketServer might already be listening)
   */
  async listen(): Promise<void> {
    // No-op if WebSocketServer was created with port option - it's automatically listening
    // Otherwise, WebSocketServer must have been provided with a server option
    if ((this.wss as any).options?.port || (this.wss as any).options?.server || (this.wss as any).listening) {
      // Emit listening event on next tick to ensure listeners are attached
      process.nextTick(() => this.handleListening());
      // Also return a promise that resolves after the event is emitted
      await new Promise(resolve => setImmediate(resolve));
    } else {
      throw Errors.badRequest('WebSocketServer is not configured to listen. Provide port or server option.');
    }
  }

  /**
   * Close the WebSocket server
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Close all connections
      for (const client of this.wss.clients) {
        client.close(1001, 'Server closing');
      }

      this.wss.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }
}

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
    server: true
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
        headers: options.headers
      });

      // Create connection immediately to set up event handlers
      const connection = new WebSocketConnection(socket, options);

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          socket.terminate();
          reject(NetronErrors.connectionTimeout('websocket', address));
        }, options.connectTimeout ?? 10000);

        socket.once('open', () => {
          clearTimeout(timeout);
          resolve(connection);
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
      const connection = new WebSocketConnection(socket, options);

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
  override async createServer(options: WebSocketOptions = {}): Promise<ITransportServer> {
    // Check if we're in Node.js
    if (typeof window !== 'undefined') {
      throw Errors.notImplemented('Cannot create WebSocket server in browser environment');
    }

    // Parse host and port from options
    const host = options.host || '0.0.0.0'; // Use 0.0.0.0 to bind to all interfaces
    const port = options.port || 8080;

    const wss = new WebSocketServer({
      host,
      port,
      perMessageDeflate: options.perMessageDeflate,
      maxPayload: options.maxPayload,
      ...((options as any).serverOptions || {})
    });

    const server = new WebSocketServerAdapter(wss, options);

    // The WebSocketServer automatically starts listening when created with a port
    // Wait a bit to ensure it's ready
    await new Promise(resolve => setTimeout(resolve, 100));

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