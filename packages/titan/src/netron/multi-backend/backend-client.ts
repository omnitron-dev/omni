/**
 * Backend Client
 *
 * Manages a single backend connection using Titan's transport system.
 * Provides HTTP and WebSocket transport options with health tracking.
 *
 * @module @omnitron-dev/titan/netron/multi-backend
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { HttpTransportClient } from '../transport/http/client.js';
import { HttpConnection } from '../transport/http/connection.js';
import { WebSocketConnection } from '../transport/websocket/connection.js';
import { ConnectionState } from '../transport/types.js';
import { TitanError, ErrorCode } from '../../errors/index.js';
import { fallbackLog } from '../../utils/fallback-log.js';
import { WebSocket } from 'ws';
import type {
  BackendConfig,
  BackendStatus,
  BackendHealth,
  TransportType,
  ConnectionMetrics,
  MultiBackendRequestContext,
  MultiBackendRequestHints,
} from './types.js';

/**
 * Backend client events
 */
export interface BackendClientEvents {
  connect: () => void;
  disconnect: (reason?: string) => void;
  error: (error: Error) => void;
  healthChange: (health: BackendHealth) => void;
  stateChange: (state: ConnectionState) => void;
}

/**
 * Backend Client
 *
 * Manages a single backend connection with support for:
 * - HTTP and WebSocket transports
 * - Health monitoring
 * - Connection metrics
 * - Automatic reconnection
 */
export class BackendClient extends EventEmitter {
  readonly id: string;
  readonly url: string;

  private config: BackendConfig;
  private httpClient?: HttpTransportClient;
  private wsConnection?: WebSocketConnection;
  private transport: TransportType;
  private _state: ConnectionState = ConnectionState.DISCONNECTED;
  private _health: BackendHealth = 'unknown';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private unhealthyThreshold: number;
  private healthyThreshold: number;

  private metrics = {
    requestsSent: 0,
    responsesReceived: 0,
    errors: 0,
    latencies: [] as number[],
    lastSuccess: undefined as number | undefined,
    lastError: undefined as number | undefined,
    lastHealthCheck: undefined as number | undefined,
  };

  constructor(config: BackendConfig, options?: { unhealthyThreshold?: number; healthyThreshold?: number }) {
    super();
    this.id = config.id;
    this.url = config.url;
    this.config = config;
    this.transport = config.transport ?? 'http';
    this.unhealthyThreshold = options?.unhealthyThreshold ?? 3;
    this.healthyThreshold = options?.healthyThreshold ?? 2;
  }

  /**
   * Get current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Get current health status
   */
  get health(): BackendHealth {
    return this._health;
  }

  /**
   * Get available services
   */
  get services(): string[] {
    return this.config.services ?? [];
  }

  /**
   * Get backend region
   */
  get region(): string | undefined {
    return this.config.region;
  }

  /**
   * Connect to the backend
   */
  async connect(): Promise<void> {
    if (this._state === ConnectionState.CONNECTED) {
      return;
    }

    this.setState(ConnectionState.CONNECTING);

    try {
      if (this.transport === 'websocket') {
        await this.connectWebSocket();
      } else {
        await this.connectHttp();
      }

      this.setState(ConnectionState.CONNECTED);
      this.recordSuccess();
      this.emit('connect');
    } catch (error) {
      this.setState(ConnectionState.ERROR);
      this.recordFailure();
      this.emit('error', error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  /**
   * Connect via HTTP
   */
  private async connectHttp(): Promise<void> {
    this.httpClient = new HttpTransportClient(this.url, undefined, {
      timeout: this.config.timeout,
      headers: this.config.headers,
    });
    await this.httpClient.initialize();
  }

  /**
   * Connect via WebSocket
   */
  private async connectWebSocket(): Promise<void> {
    const wsUrl = this.url.replace(/^http/, 'ws');
    const wsConfig = this.config.websocket;

    return new Promise((resolve, reject) => {
      try {
        const ws = new WebSocket(wsUrl, wsConfig?.protocols, {
          handshakeTimeout: this.config.timeout,
          headers: this.config.headers,
        });

        this.wsConnection = new WebSocketConnection(
          ws,
          {
            connectTimeout: this.config.timeout,
            headers: this.config.headers,
            reconnect:
              wsConfig?.reconnect !== false
                ? {
                    enabled: true,
                    maxAttempts: wsConfig?.maxReconnectAttempts ?? 10,
                    delay: wsConfig?.reconnectInterval ?? 1000,
                  }
                : undefined,
          },
          false,
          wsUrl
        );

        let isResolved = false;

        this.wsConnection.on('connect', () => {
          if (!isResolved) {
            isResolved = true;
            resolve();
          }
        });

        this.wsConnection.on('error', (error: Error) => {
          this.emit('error', error);
          if (!isResolved) {
            isResolved = true;
            reject(error);
          }
        });

        this.wsConnection.on('disconnect', (reason: string) => {
          this.setState(ConnectionState.DISCONNECTED);
          this.emit('disconnect', reason);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the backend
   */
  async disconnect(): Promise<void> {
    this.setState(ConnectionState.DISCONNECTING);

    try {
      if (this.httpClient) {
        await this.httpClient.close();
        this.httpClient = undefined;
      }

      if (this.wsConnection) {
        await this.wsConnection.close();
        this.wsConnection = undefined;
      }
    } catch (error) {
      // Log but don't throw on disconnect errors
      fallbackLog('error', `Error disconnecting from backend ${this.id}`, { error: error as Error });
    }

    this.setState(ConnectionState.DISCONNECTED);
    this.emit('disconnect');
  }

  /**
   * Invoke a service method
   */
  async invoke<T = unknown>(
    service: string,
    method: string,
    args: unknown[] = [],
    options?: {
      context?: MultiBackendRequestContext;
      hints?: MultiBackendRequestHints;
    }
  ): Promise<T> {
    if (this._state !== ConnectionState.CONNECTED) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: `Backend ${this.id} is not connected`,
        details: { backendId: this.id, state: this._state },
      });
    }

    const startTime = Date.now();
    this.metrics.requestsSent++;

    try {
      let result: T;

      if (this.transport === 'websocket' && this.wsConnection) {
        result = await this.invokeWebSocket<T>(service, method, args, options);
      } else if (this.httpClient) {
        result = await this.httpClient.invoke(service, method, args, {
          context: options?.context
            ? {
                traceId: options.context.traceId,
                spanId: options.context.spanId,
                userId: options.context.userId,
                metadata: options.context.metadata,
              }
            : undefined,
          hints: options?.hints
            ? {
                timeout: options.hints.timeout,
                priority: options.hints.priority,
              }
            : undefined,
        });
      } else {
        throw new TitanError({
          code: ErrorCode.INTERNAL_ERROR,
          message: `No transport available for backend ${this.id}`,
          details: { backendId: this.id },
        });
      }

      const latency = Date.now() - startTime;
      this.metrics.responsesReceived++;
      this.metrics.latencies.push(latency);
      this.recordSuccess();

      return result;
    } catch (error) {
      this.metrics.errors++;
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Invoke via WebSocket
   */
  private async invokeWebSocket<T>(
    service: string,
    method: string,
    args: unknown[],
    _options?: {
      context?: MultiBackendRequestContext;
      hints?: MultiBackendRequestHints;
    }
  ): Promise<T> {
    if (!this.wsConnection) {
      throw new TitanError({
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: 'WebSocket connection not available',
        details: { backendId: this.id },
      });
    }

    // For WebSocket, we need to query the interface first
    const serviceProxy = await (this.wsConnection as any).queryInterface?.(service);
    if (!serviceProxy) {
      throw new TitanError({
        code: ErrorCode.NOT_FOUND,
        message: `Service ${service} not found`,
        details: { backendId: this.id, service },
      });
    }

    if (typeof serviceProxy[method] !== 'function') {
      throw new TitanError({
        code: ErrorCode.METHOD_NOT_ALLOWED,
        message: `Method ${method} not found on service ${service}`,
        details: { backendId: this.id, service, method },
      });
    }

    return serviceProxy[method](...args);
  }

  /**
   * Perform health check
   */
  async healthCheck(): Promise<boolean> {
    this.metrics.lastHealthCheck = Date.now();

    try {
      if (this.transport === 'websocket' && this.wsConnection) {
        await this.wsConnection.ping();
      } else if (this.httpClient) {
        // Use HTTP connection's ping method if available
        const connection = (this.httpClient as any).connection as HttpConnection;
        if (connection) {
          await connection.ping();
        }
      } else {
        // Not connected, try to connect
        await this.connect();
      }

      this.recordSuccess();
      return true;
    } catch (_error) {
      this.recordFailure();
      return false;
    }
  }

  /**
   * Record successful operation
   */
  private recordSuccess(): void {
    this.consecutiveSuccesses++;
    this.consecutiveFailures = 0;
    this.metrics.lastSuccess = Date.now();

    if (this._health !== 'healthy' && this.consecutiveSuccesses >= this.healthyThreshold) {
      this.setHealth('healthy');
    } else if (this._health === 'unhealthy' && this.consecutiveSuccesses > 0) {
      this.setHealth('degraded');
    }
  }

  /**
   * Record failed operation
   */
  private recordFailure(): void {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.metrics.lastError = Date.now();

    if (this.consecutiveFailures >= this.unhealthyThreshold) {
      this.setHealth('unhealthy');
    } else if (this._health === 'healthy') {
      this.setHealth('degraded');
    }
  }

  /**
   * Set connection state
   */
  private setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('stateChange', state);
    }
  }

  /**
   * Set health status
   */
  private setHealth(health: BackendHealth): void {
    if (this._health !== health) {
      this._health = health;
      this.emit('healthChange', health);
    }
  }

  /**
   * Get backend status
   */
  getStatus(): BackendStatus {
    const avgLatency =
      this.metrics.latencies.length > 0
        ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
        : undefined;

    return {
      id: this.id,
      url: this.url,
      health: this._health,
      state: this._state,
      activeConnections: this._state === ConnectionState.CONNECTED ? 1 : 0,
      requestsSent: this.metrics.requestsSent,
      responsesReceived: this.metrics.responsesReceived,
      errors: this.metrics.errors,
      avgLatency,
      lastHealthCheck: this.metrics.lastHealthCheck,
      lastSuccess: this.metrics.lastSuccess,
      lastError: this.metrics.lastError,
      services: this.services,
      region: this.region,
    };
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    const avgLatency =
      this.metrics.latencies.length > 0
        ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
        : undefined;

    return {
      id: this.id,
      url: this.url,
      state: this._state,
      transport: this.transport,
      connectedAt: this._state === ConnectionState.CONNECTED ? this.metrics.lastSuccess : undefined,
      requestsSent: this.metrics.requestsSent,
      responsesReceived: this.metrics.responsesReceived,
      errors: this.metrics.errors,
      avgLatency,
    };
  }

  /**
   * Check if backend is connected
   */
  isConnected(): boolean {
    return this._state === ConnectionState.CONNECTED;
  }

  /**
   * Check if backend is healthy
   */
  isHealthy(): boolean {
    return this._health === 'healthy' || this._health === 'degraded';
  }

  /**
   * Reset metrics
   */
  resetMetrics(): void {
    this.metrics = {
      requestsSent: 0,
      responsesReceived: 0,
      errors: 0,
      latencies: [],
      lastSuccess: undefined,
      lastError: undefined,
      lastHealthCheck: undefined,
    };
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this._health = 'unknown';
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<BackendConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.transport) {
      this.transport = config.transport;
    }
  }
}
