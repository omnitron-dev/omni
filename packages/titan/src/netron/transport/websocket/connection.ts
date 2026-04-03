/**
 * WebSocket Connection Implementation
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import { WebSocket, RawData } from 'ws';
import { BaseConnection } from '../base-transport.js';
import { ConnectionState } from '../types.js';
import { NetronErrors, Errors } from '../../../errors/index.js';
import type { AuthContext } from '../../auth/types.js';
import type { WebSocketOptions } from './types.js';
import { KeepAliveManager } from './keep-alive-manager.js';

/**
 * WebSocket connection implementation
 */
export class WebSocketConnection extends BaseConnection {
  private socket: WebSocket;
  private pingInterval?: NodeJS.Timeout;
  private pongTimeout?: NodeJS.Timeout;
  private url?: string;
  private keepAliveManager?: KeepAliveManager;
  private usingSharedKeepAlive = false;

  constructor(socket: WebSocket, options: WebSocketOptions = {}, isServer = false, url?: string) {
    super(options);
    this.socket = socket;
    this.url = url;
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
   * Get authentication context for this connection
   */
  getAuthContext(): AuthContext | undefined {
    return (this as any).authContext;
  }

  /**
   * Set authentication context for this connection
   */
  setAuthContext(context: AuthContext): void {
    (this as any).authContext = context;
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
      const buffer =
        data instanceof Buffer
          ? data
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : Buffer.concat(data as Buffer[]);
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
   *
   * Uses shared KeepAliveManager by default for better performance with
   * high connection counts. Falls back to individual timers if needed.
   */
  private startKeepAlive(): void {
    const interval = this.options.keepAlive?.interval ?? 30000;
    const timeout = this.options.keepAlive?.timeout ?? 5000;

    // Use shared keep-alive manager for better performance
    try {
      this.keepAliveManager = KeepAliveManager.getInstance({ interval, timeout });
      this.keepAliveManager.register(this, this.socket);
      this.usingSharedKeepAlive = true;
    } catch (_error) {
      // Fallback to individual timer if shared manager fails
      this.usingSharedKeepAlive = false;
      this.startIndividualKeepAlive(interval, timeout);
    }
  }

  /**
   * Start individual keep-alive timer (fallback method)
   */
  private startIndividualKeepAlive(interval: number, timeout: number): void {
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

      let forceCloseTimeout: NodeJS.Timeout | undefined;

      const closeHandler = () => {
        this.socket.removeListener('close', closeHandler);
        if (forceCloseTimeout) {
          clearTimeout(forceCloseTimeout);
          forceCloseTimeout = undefined;
        }
        resolve();
      };

      this.socket.on('close', closeHandler);
      this.socket.close(code, reason);

      // Force close after timeout
      forceCloseTimeout = setTimeout(() => {
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
    // Cannot reconnect server-side connections
    if ((this as any).isServer) {
      throw Errors.badRequest('Cannot reconnect server-side WebSocket connection');
    }

    // Must have stored URL from client connection
    if (!this.url) {
      throw Errors.badRequest('Cannot reconnect: no URL stored (connection was not created via connect())');
    }

    // Close old socket if still open
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      try {
        this.socket.terminate();
      } catch (_error) {
        // Ignore errors during termination
      }
    }

    // Clean up old timers
    this.cleanup();

    // Create new WebSocket connection
    const newSocket = new WebSocket(this.url, (this.options as WebSocketOptions).protocols, {
      perMessageDeflate: (this.options as WebSocketOptions).perMessageDeflate,
      maxPayload: (this.options as WebSocketOptions).maxPayload,
      handshakeTimeout: (this.options as WebSocketOptions).handshakeTimeout ?? this.options.connectTimeout,
      headers: this.options.headers,
    });

    // Replace the old socket
    this.socket = newSocket;

    // Re-setup event handlers
    this.setupEventHandlers();

    // Restart keep-alive if enabled
    if (this.options.keepAlive?.enabled) {
      this.startKeepAlive();
    }

    // Wait for connection to establish
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        newSocket.terminate();
        reject(NetronErrors.connectionTimeout('websocket', this.url!));
      }, this.options.connectTimeout ?? 10000);

      const onOpen = () => {
        clearTimeout(timeout);
        newSocket.removeListener('error', onError);
        resolve();
      };

      const onError = (error: Error) => {
        clearTimeout(timeout);
        newSocket.removeListener('open', onOpen);
        reject(error);
      };

      newSocket.once('open', onOpen);
      newSocket.once('error', onError);
    });
  }

  /**
   * Clean up resources
   */
  protected override cleanup(): void {
    super.cleanup();

    // Unregister from shared keep-alive manager
    if (this.usingSharedKeepAlive && this.keepAliveManager) {
      this.keepAliveManager.unregister(this);
      this.keepAliveManager = undefined;
      this.usingSharedKeepAlive = false;
    }

    // Clean up individual timers (fallback mode)
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
