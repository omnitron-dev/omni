/**
 * Netron Client for Process Manager
 *
 * Handles the client side of Netron communication with spawned processes.
 * Production-grade implementation with proper connection lifecycle management.
 */

import { Netron } from '@omnitron-dev/titan/netron';
import { RemotePeer } from '@omnitron-dev/titan/netron';
import { Errors } from '@omnitron-dev/titan/errors';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

/**
 * Connection state enum for proper lifecycle tracking
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  DISCONNECTING = 'disconnecting',
  FAILED = 'failed',
}

/**
 * Connection options for the Netron client
 */
export interface INetronClientOptions {
  /**
   * Connection timeout in milliseconds (default: 10000)
   */
  connectTimeout?: number;
  /**
   * Maximum number of connection retries (default: 3)
   */
  maxRetries?: number;
  /**
   * Base delay for exponential backoff in milliseconds (default: 1000)
   */
  baseDelay?: number;
  /**
   * Maximum delay for exponential backoff in milliseconds (default: 30000)
   */
  maxDelay?: number;
  /**
   * Whether to enable automatic reconnection (default: false)
   */
  autoReconnect?: boolean;
}

const DEFAULT_OPTIONS: Required<INetronClientOptions> = {
  connectTimeout: 10000,
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 30000,
  autoReconnect: false,
};

/**
 * Create a Netron client that can connect to a spawned process
 */
export class NetronClient {
  private netron: Netron;
  private remotePeer?: RemotePeer;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private options: Required<INetronClientOptions>;
  private retryCount = 0;
  private disconnectHandler?: () => void;
  private transportUrl?: string;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(
    private readonly processId: string,
    private readonly logger: ILogger,
    options: INetronClientOptions = {}
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.netron = new Netron(logger as any, {
      id: `pm-client-${processId}`,
      allowServiceEvents: true,
    });
  }

  /**
   * Get current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Start the Netron client and register transports
   */
  async start(): Promise<void> {
    // Register Unix socket transport so the client can connect to unix:// URLs
    const { UnixSocketTransport } = await import('@omnitron-dev/titan/netron/transport/unix');
    this.netron.registerTransport('unix', () => new UnixSocketTransport());

    await this.netron.start();
  }

  /**
   * Connect to a remote process with retry logic and timeout
   */
  async connect(transportUrl: string): Promise<void> {
    if (this._state === ConnectionState.CONNECTED) {
      this.logger.debug({ processId: this.processId }, 'Already connected');
      return;
    }

    if (this._state === ConnectionState.CONNECTING) {
      throw Errors.conflict('Connection already in progress');
    }

    this._state = ConnectionState.CONNECTING;
    this.transportUrl = transportUrl;
    this.retryCount = 0;

    try {
      await this.connectWithRetry(transportUrl);
    } catch (error) {
      this._state = ConnectionState.FAILED;
      throw error;
    }
  }

  /**
   * Connect with retry logic and exponential backoff
   */
  private async connectWithRetry(transportUrl: string): Promise<void> {
    while (this.retryCount <= this.options.maxRetries) {
      try {
        await this.doConnect(transportUrl);
        this.retryCount = 0;
        return;
      } catch (error) {
        this.retryCount++;
        const isLastAttempt = this.retryCount > this.options.maxRetries;

        this.logger.warn(
          {
            processId: this.processId,
            transportUrl,
            attempt: this.retryCount,
            maxRetries: this.options.maxRetries,
            error: error instanceof Error ? error.message : String(error),
          },
          isLastAttempt ? 'Connection failed, no more retries' : 'Connection failed, retrying'
        );

        if (isLastAttempt) {
          throw error;
        }

        // Exponential backoff with jitter
        const delay = Math.min(
          this.options.baseDelay * Math.pow(2, this.retryCount - 1) + Math.random() * 1000,
          this.options.maxDelay
        );
        await this.sleep(delay);
      }
    }
  }

  /**
   * Perform the actual connection with timeout.
   * Uses Netron.connect() for proper handshake protocol negotiation
   * (ID exchange + peer initialization).
   */
  private async doConnect(transportUrl: string): Promise<void> {
    // Use Netron's built-in connect which handles the full protocol handshake:
    // 1. Transport connect
    // 2. Server sends { type: 'id', id: serverId }
    // 3. Client sends { type: 'client-id', id: clientId }
    // 4. peer.init() with service definition exchange
    const peer = await Promise.race([
      this.netron.connect(transportUrl, false),
      this.createTimeout(this.options.connectTimeout, 'Connection'),
    ]);

    this.remotePeer = peer as RemotePeer;

    // Setup disconnect handler for auto-reconnect
    this.setupDisconnectHandler();

    this._state = ConnectionState.CONNECTED;
    this.logger.info({ processId: this.processId, transportUrl }, 'Connected to process');
  }

  /**
   * Setup handler for peer disconnect events
   */
  private setupDisconnectHandler(): void {
    if (!this.remotePeer) return;

    // Remove previous handler if exists
    const peerAny = this.remotePeer as any;
    if (this.disconnectHandler && typeof peerAny.off === 'function') {
      peerAny.off('manual-disconnect', this.disconnectHandler);
    }

    this.disconnectHandler = () => {
      this.logger.warn({ processId: this.processId }, 'Remote peer disconnected');
      this._state = ConnectionState.DISCONNECTED;
      this.cleanup();

      // Auto-reconnect if enabled
      if (this.options.autoReconnect && this.transportUrl) {
        this.scheduleReconnect();
      }
    };

    // Use once if available, otherwise fall back to on
    if (typeof peerAny.once === 'function') {
      peerAny.once('manual-disconnect', this.disconnectHandler);
    } else if (typeof peerAny.on === 'function') {
      peerAny.on('manual-disconnect', this.disconnectHandler);
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this._state === ConnectionState.RECONNECTING) return;

    this._state = ConnectionState.RECONNECTING;
    const delay = this.options.baseDelay;

    this.logger.info({ processId: this.processId, delay }, 'Scheduling reconnection');

    this.reconnectTimer = setTimeout(async () => {
      if (this.transportUrl && this._state === ConnectionState.RECONNECTING) {
        try {
          await this.connectWithRetry(this.transportUrl);
        } catch (error) {
          this.logger.error({ error, processId: this.processId }, 'Reconnection failed');
          this._state = ConnectionState.FAILED;
        }
      }
    }, delay);
  }

  /**
   * Query a service interface from the remote process
   */
  async queryInterface<T>(serviceName: string): Promise<T | null> {
    if (this._state !== ConnectionState.CONNECTED || !this.remotePeer) {
      throw Errors.conflict(`Not connected to process (state: ${this._state})`);
    }

    try {
      // Query the interface from the remote peer
      const serviceStub = await this.remotePeer.queryInterface<T>(serviceName);
      return serviceStub;
    } catch (error) {
      // Log at warn level with full stack to surface actual root cause
      this.logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          serviceName,
          processId: this.processId,
          peerConnected: !!this.remotePeer,
          socketReady: (this.remotePeer as any)?.socket?.readyState,
        },
        'Failed to query interface from remote peer'
      );
      return null;
    }
  }

  /**
   * Call a method on the remote process with timeout
   */
  async call(serviceName: string, methodName: string, args: unknown[]): Promise<unknown> {
    const service = await this.queryInterface(serviceName);
    if (!service) {
      throw Errors.notFound('Service', serviceName);
    }

    const method = (service as Record<string, unknown>)[methodName];
    if (typeof method !== 'function') {
      throw Errors.notFound('Method', `${serviceName}.${methodName}`);
    }

    // Execute the method
    return await method(...args);
  }

  /**
   * Disconnect from the remote process
   */
  async disconnect(): Promise<void> {
    if (this._state === ConnectionState.DISCONNECTED) {
      return;
    }

    if (this._state === ConnectionState.DISCONNECTING) {
      this.logger.debug({ processId: this.processId }, 'Disconnect already in progress');
      return;
    }

    this._state = ConnectionState.DISCONNECTING;

    // Cancel any pending reconnection
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    try {
      this.cleanup();
      await this.netron.stop();
      this._state = ConnectionState.DISCONNECTED;
      this.logger.debug({ processId: this.processId }, 'Disconnected from process');
    } catch (error) {
      this.logger.error({ error, processId: this.processId }, 'Error during disconnect');
      this._state = ConnectionState.FAILED;
      throw error;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.remotePeer) {
      // Remove disconnect handler
      const peerAny = this.remotePeer as any;
      if (this.disconnectHandler && typeof peerAny.off === 'function') {
        peerAny.off('manual-disconnect', this.disconnectHandler);
      }
      this.disconnectHandler = undefined;

      // Remove from peers
      this.netron.peers.delete(this.remotePeer.id);

      // Close transport if it has a close method
      if (peerAny.transport && typeof peerAny.transport.close === 'function') {
        peerAny.transport.close().catch((error: unknown) => {
          this.logger.debug({ error, processId: this.processId }, 'Error closing transport');
        });
      }

      this.remotePeer = undefined;
    }
  }

  /**
   * Get the Netron instance
   */
  getNetron(): Netron {
    return this.netron;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  /**
   * Create a timeout promise
   */
  private createTimeout(ms: number, operation: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(Errors.timeout(operation, ms));
      }, ms);
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
