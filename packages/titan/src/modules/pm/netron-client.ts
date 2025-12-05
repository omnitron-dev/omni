/**
 * Netron Client for Process Manager
 *
 * Handles the client side of Netron communication with spawned processes.
 * Production-grade implementation with proper connection lifecycle management.
 */

import { Netron } from '../../netron/index.js';
import { RemotePeer } from '../../netron/remote-peer.js';
import { Errors } from '../../errors/index.js';
import type { ILogger } from '../logger/logger.types.js';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
   * Start the Netron client
   */
  async start(): Promise<void> {
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
   * Perform the actual connection with timeout
   */
  private async doConnect(transportUrl: string): Promise<void> {
    // Get transport based on URL
    const { getTransportForAddress } = await import('../../netron/transport/index.js');
    const transport = getTransportForAddress(transportUrl);

    if (!transport) {
      throw Errors.notFound('Transport for URL', transportUrl);
    }

    // Connect with timeout
    const connection = await Promise.race([
      transport.connect(transportUrl),
      this.createTimeout(this.options.connectTimeout, 'Connection'),
    ]);

    // Create remote peer with the connection
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.remotePeer = new RemotePeer(this.netron, connection as any);

    // Setup disconnect handler for auto-reconnect
    this.setupDisconnectHandler();

    // Add to netron's peer list
    this.netron.peers.set(this.remotePeer.id, this.remotePeer);

    this._state = ConnectionState.CONNECTED;
    this.logger.info({ processId: this.processId, transportUrl }, 'Connected to process');
  }

  /**
   * Setup handler for peer disconnect events
   */
  private setupDisconnectHandler(): void {
    if (!this.remotePeer) return;

    // Remove previous handler if exists
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
          this.logger.error(
            { error, processId: this.processId },
            'Reconnection failed'
          );
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
      // Log but don't expose internal details in error message
      this.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
          serviceName,
          processId: this.processId,
        },
        'Failed to query interface'
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
