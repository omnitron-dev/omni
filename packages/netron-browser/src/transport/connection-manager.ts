/**
 * Browser Connection Manager
 *
 * Industrial-grade connection pooling for browser WebSocket connections.
 * Features:
 * - Per-peer connection limits
 * - Health check monitoring
 * - Automatic reconnection with exponential backoff and jitter
 * - Connection lifecycle management
 * - Comprehensive statistics
 *
 * @module netron-browser/transport/connection-manager
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { WebSocketConnection } from './ws/connection.js';

/**
 * Connection manager lifecycle states
 */
export enum ConnectionManagerState {
  IDLE = 'idle',
  RUNNING = 'running',
  STOPPING = 'stopping',
  STOPPED = 'stopped',
}

/**
 * Individual connection states
 */
export enum ManagedConnectionState {
  CONNECTING = 'connecting',
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  IN_USE = 'in_use',
  IDLE = 'idle',
  CLOSING = 'closing',
  CLOSED = 'closed',
}

/**
 * Configuration for the connection manager
 */
export interface ConnectionManagerConfig {
  /** Maximum connections per peer @default 5 */
  maxConnectionsPerPeer?: number;
  /** Maximum total connections @default 50 */
  maxTotalConnections?: number;
  /** Minimum pool size per peer @default 2 */
  poolSize?: number;
  /** Idle timeout in ms @default 30000 */
  idleTimeout?: number;
  /** Health check interval in ms @default 15000 */
  healthCheckInterval?: number;
  /** Max missed heartbeats before unhealthy @default 3 */
  maxMissedHeartbeats?: number;
  /** Heartbeat timeout in ms @default 5000 */
  heartbeatTimeout?: number;
  /** Reconnection configuration */
  reconnect?: {
    /** Enable auto-reconnection @default true */
    enabled?: boolean;
    /** Base delay in ms @default 1000 */
    baseDelay?: number;
    /** Max delay in ms @default 30000 */
    maxDelay?: number;
    /** Max reconnection attempts @default 10 */
    maxAttempts?: number;
    /** Jitter factor (0-1) for thundering herd prevention @default 0.3 */
    jitterFactor?: number;
  };
  /** Enable metrics collection @default true */
  enableMetrics?: boolean;
  /** Cleanup interval in ms @default 10000 */
  cleanupInterval?: number;
}

/**
 * Required reconnect configuration type
 */
export interface RequiredReconnectConfig {
  enabled: boolean;
  baseDelay: number;
  maxDelay: number;
  maxAttempts: number;
  jitterFactor: number;
}

/**
 * Fully resolved configuration type
 */
export interface ResolvedConnectionManagerConfig {
  maxConnectionsPerPeer: number;
  maxTotalConnections: number;
  poolSize: number;
  idleTimeout: number;
  healthCheckInterval: number;
  maxMissedHeartbeats: number;
  heartbeatTimeout: number;
  reconnect: RequiredReconnectConfig;
  enableMetrics: boolean;
  cleanupInterval: number;
}

/**
 * Default configuration values
 */
export const DEFAULT_CONNECTION_MANAGER_CONFIG: ResolvedConnectionManagerConfig = {
  maxConnectionsPerPeer: 5,
  maxTotalConnections: 50,
  poolSize: 2,
  idleTimeout: 30000,
  healthCheckInterval: 15000,
  maxMissedHeartbeats: 3,
  heartbeatTimeout: 5000,
  reconnect: {
    enabled: true,
    baseDelay: 1000,
    maxDelay: 30000,
    maxAttempts: 10,
    jitterFactor: 0.3,
  },
  enableMetrics: true,
  cleanupInterval: 10000,
};

/**
 * Managed connection wrapper with metadata
 */
export interface ManagedConnection {
  /** Unique connection ID */
  id: string;
  /** Associated peer ID */
  peerId: string;
  /** Current connection state */
  state: ManagedConnectionState;
  /** Underlying WebSocket connection */
  connection: WebSocketConnection;
  /** Last activity timestamp */
  lastActivity: number;
  /** Last successful heartbeat timestamp */
  lastHeartbeat: number;
  /** Count of missed heartbeats */
  missedHeartbeats: number;
  /** Connection creation timestamp */
  createdAt: number;
  /** Number of times this connection has been reused */
  reuseCount: number;
  /** ID of current checkout holder (for debugging) */
  checkedOutBy?: string;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
}

/**
 * Pool statistics
 */
export interface ConnectionPoolStats {
  /** Total managed connections */
  totalConnections: number;
  /** Connections currently in use */
  activeConnections: number;
  /** Idle healthy connections */
  idleConnections: number;
  /** Unhealthy connections */
  unhealthyConnections: number;
  /** Connections per peer */
  connectionsPerPeer: Map<string, number>;
  /** Average connection age in ms */
  averageConnectionAge: number;
  /** Average reuse count */
  averageReuseCount: number;
  /** Health check success rate (0-1) */
  healthCheckSuccessRate: number;
  /** Total bytes sent */
  totalBytesSent: number;
  /** Total bytes received */
  totalBytesReceived: number;
}

/**
 * Event names for ConnectionManager
 */
export const CONNECTION_MANAGER_EVENTS = {
  CONNECTION_ADDED: 'connection:added',
  CONNECTION_REMOVED: 'connection:removed',
  CONNECTION_UNHEALTHY: 'connection:unhealthy',
  CONNECTION_RECOVERED: 'connection:recovered',
  CONNECTION_IDLE: 'connection:idle',
  CONNECTION_RECONNECTING: 'connection:reconnecting',
  CONNECTION_RECONNECTED: 'connection:reconnected',
  CONNECTION_RECONNECT_FAILED: 'connection:reconnect_failed',
  POOL_LIMIT_REACHED: 'pool:limit_reached',
  MANAGER_STATE_CHANGE: 'manager:state_change',
} as const;

/**
 * Events emitted by the connection manager
 */
export interface ConnectionManagerEvents {
  'connection:added': (conn: ManagedConnection) => void;
  'connection:removed': (conn: ManagedConnection, reason: string) => void;
  'connection:unhealthy': (conn: ManagedConnection) => void;
  'connection:recovered': (conn: ManagedConnection) => void;
  'connection:idle': (conn: ManagedConnection) => void;
  'connection:reconnecting': (peerId: string, attempt: number) => void;
  'connection:reconnected': (conn: ManagedConnection) => void;
  'connection:reconnect_failed': (peerId: string, error: Error) => void;
  'pool:limit_reached': (peerId: string, limit: number) => void;
  'manager:state_change': (oldState: ConnectionManagerState, newState: ConnectionManagerState) => void;
}

/**
 * Browser Connection Manager
 *
 * Provides industrial-grade connection pooling for WebSocket connections.
 *
 * @example
 * ```typescript
 * const manager = new ConnectionManager({
 *   maxConnectionsPerPeer: 5,
 *   healthCheckInterval: 15000,
 * });
 *
 * manager.start();
 *
 * // Add a connection
 * const managed = manager.addConnection('peer1', wsConnection);
 *
 * // Check out for use
 * const conn = manager.checkout('peer1');
 * try {
 *   await conn.connection.send(data);
 * } finally {
 *   manager.checkin(conn.id);
 * }
 *
 * // Get statistics
 * const stats = manager.getStats();
 * console.log(`Healthy: ${stats.idleConnections}`);
 *
 * manager.stop();
 * ```
 */
export class ConnectionManager extends EventEmitter {
  private state: ConnectionManagerState = ConnectionManagerState.IDLE;
  private config: ResolvedConnectionManagerConfig;

  /** All managed connections by ID */
  private connections = new Map<string, ManagedConnection>();

  /** Connections grouped by peer ID */
  private peerConnections = new Map<string, Set<string>>();

  /** Pending reconnection timers by peer ID */
  private reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Health check timer */
  private healthCheckTimer?: ReturnType<typeof setInterval>;

  /** Cleanup timer */
  private cleanupTimer?: ReturnType<typeof setInterval>;

  /** Statistics counters */
  private totalHealthChecks = 0;
  private successfulHealthChecks = 0;
  private totalBytesSent = 0;
  private totalBytesReceived = 0;

  /** Counter for generating unique IDs */
  private connectionIdCounter = 0;

  constructor(config: ConnectionManagerConfig = {}) {
    super();
    this.config = {
      ...DEFAULT_CONNECTION_MANAGER_CONFIG,
      ...config,
      reconnect: {
        ...DEFAULT_CONNECTION_MANAGER_CONFIG.reconnect,
        ...config.reconnect,
      },
    };
  }

  /**
   * Start the connection manager.
   * Initializes health check and cleanup timers.
   */
  start(): void {
    if (this.state !== ConnectionManagerState.IDLE && this.state !== ConnectionManagerState.STOPPED) {
      return;
    }

    const oldState = this.state;
    this.state = ConnectionManagerState.RUNNING;
    this.emit('manager:state_change', oldState, this.state);

    // Start health check timer
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.config.cleanupInterval);
  }

  /**
   * Stop the connection manager.
   * Gracefully closes all connections.
   */
  async stop(): Promise<void> {
    if (this.state !== ConnectionManagerState.RUNNING) {
      return;
    }

    const oldState = this.state;
    this.state = ConnectionManagerState.STOPPING;
    this.emit('manager:state_change', oldState, this.state);

    // Clear timers
    if (this.healthCheckTimer !== undefined) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Cancel all pending reconnections
    for (const [peerId, timerId] of this.reconnectTimers) {
      clearTimeout(timerId);
      this.reconnectTimers.delete(peerId);
    }

    // Close all connections
    const closePromises: Promise<void>[] = [];
    for (const managed of this.connections.values()) {
      closePromises.push(this.removeConnection(managed.id, 'manager_shutdown'));
    }
    await Promise.allSettled(closePromises);

    this.state = ConnectionManagerState.STOPPED;
    this.emit('manager:state_change', ConnectionManagerState.STOPPING, this.state);
  }

  /**
   * Add a connection to the pool.
   *
   * @param peerId - Associated peer ID
   * @param connection - WebSocket connection to manage
   * @returns Managed connection or null if limits reached
   */
  addConnection(peerId: string, connection: WebSocketConnection): ManagedConnection | null {
    // Check global limit
    if (this.connections.size >= this.config.maxTotalConnections) {
      this.emit('pool:limit_reached', peerId, this.config.maxTotalConnections);
      return null;
    }

    // Check per-peer limit
    const peerConns = this.peerConnections.get(peerId);
    if (peerConns && peerConns.size >= this.config.maxConnectionsPerPeer) {
      this.emit('pool:limit_reached', peerId, this.config.maxConnectionsPerPeer);
      return null;
    }

    const now = Date.now();
    const id = this.generateConnectionId();

    const managed: ManagedConnection = {
      id,
      peerId,
      state: ManagedConnectionState.HEALTHY,
      connection,
      lastActivity: now,
      lastHeartbeat: now,
      missedHeartbeats: 0,
      createdAt: now,
      reuseCount: 0,
      reconnectAttempts: 0,
    };

    // Set up connection event handlers
    this.setupConnectionHandlers(managed);

    // Add to maps
    this.connections.set(id, managed);
    if (!this.peerConnections.has(peerId)) {
      this.peerConnections.set(peerId, new Set());
    }
    this.peerConnections.get(peerId)!.add(id);

    this.emit('connection:added', managed);
    return managed;
  }

  /**
   * Check out a connection for use.
   *
   * @param peerId - Peer ID to get connection for
   * @param checkoutId - Optional identifier for checkout holder
   * @returns Managed connection or null if none available
   */
  checkout(peerId: string, checkoutId?: string): ManagedConnection | null {
    const peerConns = this.peerConnections.get(peerId);
    if (!peerConns || peerConns.size === 0) {
      return null;
    }

    // Find first healthy or idle connection
    for (const connId of peerConns) {
      const managed = this.connections.get(connId);
      if (
        managed &&
        (managed.state === ManagedConnectionState.HEALTHY || managed.state === ManagedConnectionState.IDLE)
      ) {
        managed.state = ManagedConnectionState.IN_USE;
        managed.reuseCount++;
        managed.lastActivity = Date.now();
        managed.checkedOutBy = checkoutId;
        return managed;
      }
    }

    return null;
  }

  /**
   * Return a connection to the pool.
   *
   * @param connectionId - Connection ID to check in
   */
  checkin(connectionId: string): void {
    const managed = this.connections.get(connectionId);
    if (!managed || managed.state !== ManagedConnectionState.IN_USE) {
      return;
    }

    managed.lastActivity = Date.now();
    managed.checkedOutBy = undefined;

    // Set state based on health
    if (managed.missedHeartbeats > 0) {
      managed.state = ManagedConnectionState.UNHEALTHY;
    } else {
      managed.state = ManagedConnectionState.IDLE;
    }
  }

  /**
   * Remove a connection from the pool.
   *
   * @param connectionId - Connection ID to remove
   * @param reason - Reason for removal
   */
  async removeConnection(connectionId: string, reason: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) {
      return;
    }

    managed.state = ManagedConnectionState.CLOSING;

    try {
      // Collect metrics before closing
      const metrics = managed.connection.getMetrics?.();
      if (metrics) {
        this.totalBytesSent += metrics.bytesSent || 0;
        this.totalBytesReceived += metrics.bytesReceived || 0;
      }

      await managed.connection.close();
    } catch (error) {
      console.error('Error closing connection:', error);
    }

    managed.state = ManagedConnectionState.CLOSED;

    // Remove from maps
    this.connections.delete(connectionId);
    const peerConns = this.peerConnections.get(managed.peerId);
    if (peerConns) {
      peerConns.delete(connectionId);
      if (peerConns.size === 0) {
        this.peerConnections.delete(managed.peerId);
      }
    }

    this.emit('connection:removed', managed, reason);
  }

  /**
   * Get all connections for a peer.
   */
  getConnectionsForPeer(peerId: string): ManagedConnection[] {
    const peerConns = this.peerConnections.get(peerId);
    if (!peerConns) return [];

    const result: ManagedConnection[] = [];
    for (const connId of peerConns) {
      const managed = this.connections.get(connId);
      if (managed) {
        result.push(managed);
      }
    }
    return result;
  }

  /**
   * Get a specific connection by ID.
   */
  getConnection(connectionId: string): ManagedConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Check if a peer has any available connections.
   */
  hasAvailableConnection(peerId: string): boolean {
    const peerConns = this.peerConnections.get(peerId);
    if (!peerConns) return false;

    for (const connId of peerConns) {
      const managed = this.connections.get(connId);
      if (
        managed &&
        (managed.state === ManagedConnectionState.HEALTHY || managed.state === ManagedConnectionState.IDLE)
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the current manager state.
   */
  getState(): ConnectionManagerState {
    return this.state;
  }

  /**
   * Get comprehensive pool statistics.
   */
  getStats(): ConnectionPoolStats {
    let activeConnections = 0;
    let idleConnections = 0;
    let unhealthyConnections = 0;
    let totalAge = 0;
    let totalReuse = 0;
    const connectionsPerPeer = new Map<string, number>();

    const now = Date.now();

    for (const managed of this.connections.values()) {
      totalAge += now - managed.createdAt;
      totalReuse += managed.reuseCount;

      switch (managed.state) {
        case ManagedConnectionState.IN_USE:
          activeConnections++;
          break;
        case ManagedConnectionState.HEALTHY:
        case ManagedConnectionState.IDLE:
          idleConnections++;
          break;
        case ManagedConnectionState.UNHEALTHY:
          unhealthyConnections++;
          break;
        default:
          // Handle any unknown states
          break;
      }

      const peerCount = connectionsPerPeer.get(managed.peerId) || 0;
      connectionsPerPeer.set(managed.peerId, peerCount + 1);
    }

    const total = this.connections.size;
    return {
      totalConnections: total,
      activeConnections,
      idleConnections,
      unhealthyConnections,
      connectionsPerPeer,
      averageConnectionAge: total > 0 ? totalAge / total : 0,
      averageReuseCount: total > 0 ? totalReuse / total : 0,
      healthCheckSuccessRate: this.totalHealthChecks > 0 ? this.successfulHealthChecks / this.totalHealthChecks : 1,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
    };
  }

  /**
   * Force an immediate health check of all connections.
   */
  async forceHealthCheck(): Promise<void> {
    await this.performHealthChecks();
  }

  /**
   * Calculate reconnection delay with exponential backoff and jitter.
   *
   * @param attempt - Current attempt number (0-indexed)
   * @returns Delay in milliseconds
   */
  calculateReconnectDelay(attempt: number): number {
    const { baseDelay, maxDelay, jitterFactor } = this.config.reconnect;

    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // Add jitter to prevent thundering herd
    // jitter = delay * factor * (random - 0.5)
    const jitter = exponentialDelay * jitterFactor * (Math.random() - 0.5);

    return Math.max(baseDelay, Math.min(exponentialDelay + jitter, maxDelay));
  }

  /**
   * Schedule a reconnection for a peer.
   *
   * @param peerId - Peer ID to reconnect
   * @param connectionFactory - Factory function to create new connection
   */
  scheduleReconnect(peerId: string, connectionFactory: () => Promise<WebSocketConnection>): void {
    const { enabled, maxAttempts } = this.config.reconnect;
    if (!enabled) {
      return;
    }

    // Cancel existing timer
    const existingTimer = this.reconnectTimers.get(peerId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
    }

    // Find max attempts for this peer
    let currentMaxAttempts = 0;
    const peerConns = this.peerConnections.get(peerId);
    if (peerConns) {
      for (const connId of peerConns) {
        const managed = this.connections.get(connId);
        if (managed) {
          currentMaxAttempts = Math.max(currentMaxAttempts, managed.reconnectAttempts);
        }
      }
    }

    // Check max attempts limit
    if (maxAttempts > 0 && currentMaxAttempts >= maxAttempts) {
      this.emit('connection:reconnect_failed', peerId, new Error('Max reconnection attempts reached'));
      return;
    }

    const delay = this.calculateReconnectDelay(currentMaxAttempts);
    this.emit('connection:reconnecting', peerId, currentMaxAttempts + 1);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(peerId);
      try {
        const newConnection = await connectionFactory();
        const managed = this.addConnection(peerId, newConnection);
        if (managed) {
          managed.reconnectAttempts = currentMaxAttempts + 1;
          this.emit('connection:reconnected', managed);
        }
      } catch {
        // Recursive: schedule next attempt
        this.scheduleReconnect(peerId, connectionFactory);
      }
    }, delay);

    this.reconnectTimers.set(peerId, timer);
  }

  /**
   * Cancel pending reconnection for a peer.
   */
  cancelReconnect(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
  }

  /**
   * Generate a unique connection ID.
   */
  private generateConnectionId(): string {
    return `conn_${++this.connectionIdCounter}_${Date.now()}`;
  }

  /**
   * Set up event handlers for a connection.
   */
  private setupConnectionHandlers(managed: ManagedConnection): void {
    const { connection } = managed;

    connection.on('disconnect', () => {
      this.handleConnectionDisconnect(managed);
    });

    connection.on('error', () => {
      managed.state = ManagedConnectionState.UNHEALTHY;
      this.emit('connection:unhealthy', managed);
    });

    connection.on('message', () => {
      managed.lastActivity = Date.now();
      // Track metrics
      const metrics = connection.getMetrics?.();
      if (metrics) {
        this.totalBytesReceived = metrics.bytesReceived || 0;
        this.totalBytesSent = metrics.bytesSent || 0;
      }
    });
  }

  /**
   * Handle connection disconnect event.
   */
  private handleConnectionDisconnect(managed: ManagedConnection): void {
    const peerId = managed.peerId;
    this.removeConnection(managed.id, 'disconnected');

    // Schedule reconnection if enabled
    if (this.config.reconnect.enabled && this.state === ConnectionManagerState.RUNNING) {
      this.scheduleReconnect(peerId, async () => {
        // This should be overridden by the consumer
        throw new Error('Connection factory not provided');
      });
    }
  }

  /**
   * Perform health checks on all connections.
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    const healthCheckPromises: Promise<void>[] = [];

    for (const managed of this.connections.values()) {
      // Skip connections that are not healthy candidates
      if (
        managed.state === ManagedConnectionState.CLOSING ||
        managed.state === ManagedConnectionState.CLOSED ||
        managed.state === ManagedConnectionState.IN_USE
      ) {
        continue;
      }

      healthCheckPromises.push(this.checkConnectionHealth(managed, now));
    }

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Check health of a single connection.
   */
  private async checkConnectionHealth(managed: ManagedConnection, now: number): Promise<void> {
    this.totalHealthChecks++;

    try {
      // Create timeout promise
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Health check timeout')), this.config.heartbeatTimeout);
      });

      // Ping and race against timeout
      await Promise.race([managed.connection.ping(), timeoutPromise]);

      // Success
      managed.lastHeartbeat = now;
      managed.missedHeartbeats = 0;
      this.successfulHealthChecks++;

      // Recover if was unhealthy
      if (managed.state === ManagedConnectionState.UNHEALTHY) {
        managed.state = ManagedConnectionState.HEALTHY;
        this.emit('connection:recovered', managed);
      }
    } catch {
      managed.missedHeartbeats++;

      if (managed.missedHeartbeats >= this.config.maxMissedHeartbeats) {
        managed.state = ManagedConnectionState.UNHEALTHY;
        this.emit('connection:unhealthy', managed);
      }
    }
  }

  /**
   * Clean up idle connections that exceed timeout.
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();

    for (const managed of this.connections.values()) {
      if (managed.state !== ManagedConnectionState.IDLE) {
        continue;
      }

      const idleTime = now - managed.lastActivity;
      if (idleTime < this.config.idleTimeout) {
        continue;
      }

      // Keep at least poolSize connections per peer
      const peerConns = this.peerConnections.get(managed.peerId);
      if (peerConns && peerConns.size <= this.config.poolSize) {
        continue;
      }

      // Close excess idle connection
      this.emit('connection:idle', managed);
      this.removeConnection(managed.id, 'idle_timeout');
    }
  }
}
