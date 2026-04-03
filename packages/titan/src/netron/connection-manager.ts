/**
 * Connection Manager for Netron RPC
 *
 * Industrial-grade connection management with:
 * - Connection pooling with efficient reuse
 * - Health monitoring with heartbeat mechanism
 * - Graceful connection cleanup with no leaks
 * - Exponential backoff with jitter for reconnection
 * - Connection limits per peer
 * - Idle connection timeout
 *
 * @module connection-manager
 * @since 0.5.0
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { ILogger } from '../types/logger.js';
import type { ITransportConnection } from './transport/types.js';
import { Errors } from '../errors/index.js';

/**
 * Connection state machine states
 */
export enum ConnectionManagerState {
  /** Initial state, not started */
  IDLE = 'idle',
  /** Manager is running */
  RUNNING = 'running',
  /** Manager is shutting down */
  STOPPING = 'stopping',
  /** Manager has stopped */
  STOPPED = 'stopped',
}

/**
 * Individual connection state with metadata
 */
export enum ManagedConnectionState {
  /** Connection is being established */
  CONNECTING = 'connecting',
  /** Connection is healthy and available */
  HEALTHY = 'healthy',
  /** Connection is unhealthy (missed heartbeats) */
  UNHEALTHY = 'unhealthy',
  /** Connection is being used */
  IN_USE = 'in_use',
  /** Connection is idle */
  IDLE = 'idle',
  /** Connection is being closed */
  CLOSING = 'closing',
  /** Connection is closed */
  CLOSED = 'closed',
}

/**
 * Configuration for connection manager
 */
export interface ConnectionManagerConfig {
  /** Maximum connections per peer (default: 10) */
  maxConnectionsPerPeer?: number;

  /** Global maximum connections (default: 100) */
  maxTotalConnections?: number;

  /** Connection pool size per peer for reuse (default: 3) */
  poolSize?: number;

  /** Idle connection timeout in ms (default: 30000) */
  idleTimeout?: number;

  /** Health check interval in ms (default: 15000) */
  healthCheckInterval?: number;

  /** Max missed heartbeats before marking unhealthy (default: 3) */
  maxMissedHeartbeats?: number;

  /** Heartbeat timeout in ms (default: 5000) */
  heartbeatTimeout?: number;

  /** Reconnection config */
  reconnect?: {
    /** Enable reconnection (default: true) */
    enabled?: boolean;
    /** Base delay in ms (default: 1000) */
    baseDelay?: number;
    /** Maximum delay in ms (default: 30000) */
    maxDelay?: number;
    /** Maximum attempts (default: 10, 0 = unlimited) */
    maxAttempts?: number;
    /** Jitter factor 0-1 (default: 0.3) */
    jitterFactor?: number;
  };

  /** Enable connection metrics collection (default: true) */
  enableMetrics?: boolean;

  /** Cleanup interval for expired connections in ms (default: 10000) */
  cleanupInterval?: number;
}

/**
 * Managed connection wrapper with health tracking
 */
export interface ManagedConnection {
  /** Unique connection ID */
  id: string;

  /** Peer ID this connection belongs to */
  peerId: string;

  /** Underlying transport connection */
  connection: ITransportConnection;

  /** Current connection state */
  state: ManagedConnectionState;

  /** Last activity timestamp */
  lastActivity: number;

  /** Last successful heartbeat timestamp */
  lastHeartbeat: number;

  /** Number of missed heartbeats */
  missedHeartbeats: number;

  /** Connection created timestamp */
  createdAt: number;

  /** Number of times this connection has been reused */
  reuseCount: number;

  /** Current checkout holder (for debugging) */
  checkedOutBy?: string;

  /** Reconnection attempts counter */
  reconnectAttempts: number;
}

/**
 * Connection pool statistics
 */
export interface ConnectionPoolStats {
  /** Total managed connections */
  totalConnections: number;

  /** Active (in-use) connections */
  activeConnections: number;

  /** Idle connections in pool */
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

  /** Total bytes sent across all connections */
  totalBytesSent: number;

  /** Total bytes received across all connections */
  totalBytesReceived: number;
}

/**
 * Events emitted by ConnectionManager
 */
export interface ConnectionManagerEvents {
  /** Connection added to pool */
  'connection:added': (conn: ManagedConnection) => void;
  /** Connection removed from pool */
  'connection:removed': (conn: ManagedConnection, reason: string) => void;
  /** Connection became unhealthy */
  'connection:unhealthy': (conn: ManagedConnection) => void;
  /** Connection recovered */
  'connection:recovered': (conn: ManagedConnection) => void;
  /** Connection idle timeout */
  'connection:idle': (conn: ManagedConnection) => void;
  /** Reconnection attempt */
  'connection:reconnecting': (peerId: string, attempt: number) => void;
  /** Reconnection succeeded */
  'connection:reconnected': (conn: ManagedConnection) => void;
  /** Reconnection failed */
  'connection:reconnect_failed': (peerId: string, error: Error) => void;
  /** Pool limit reached */
  'pool:limit_reached': (peerId: string, limit: number) => void;
  /** Manager state change */
  'manager:state_change': (oldState: ConnectionManagerState, newState: ConnectionManagerState) => void;
}

/**
 * Required reconnect configuration (all fields required)
 */
interface RequiredReconnectConfig {
  enabled: boolean;
  baseDelay: number;
  maxDelay: number;
  maxAttempts: number;
  jitterFactor: number;
}

/**
 * Fully resolved configuration type
 */
interface ResolvedConnectionManagerConfig {
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
const DEFAULT_CONFIG: ResolvedConnectionManagerConfig = {
  maxConnectionsPerPeer: 10,
  maxTotalConnections: 100,
  poolSize: 3,
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
 * Industrial-grade Connection Manager
 *
 * Features:
 * - Connection state machine with proper transitions
 * - Connection pooling with LRU eviction
 * - Health monitoring via heartbeat/ping
 * - Exponential backoff with jitter for reconnection
 * - Per-peer connection limits
 * - Idle connection cleanup
 * - Thread-safe operations
 * - Comprehensive metrics
 */
export class ConnectionManager extends EventEmitter {
  private readonly config: ResolvedConnectionManagerConfig;
  private state: ConnectionManagerState = ConnectionManagerState.IDLE;
  private connections: Map<string, ManagedConnection> = new Map();
  private peerConnections: Map<string, Set<string>> = new Map();
  private healthCheckTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private logger: ILogger;

  // Metrics tracking
  private totalHealthChecks = 0;
  private successfulHealthChecks = 0;
  private totalBytesSent = 0;
  private totalBytesReceived = 0;

  constructor(logger: ILogger, config: ConnectionManagerConfig = {}) {
    super();
    this.logger = logger.child({ module: 'connection-manager' });

    // Merge config with defaults
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      reconnect: {
        ...DEFAULT_CONFIG.reconnect,
        ...config.reconnect,
      },
    };
  }

  /**
   * Start the connection manager
   */
  start(): void {
    if (this.state !== ConnectionManagerState.IDLE && this.state !== ConnectionManagerState.STOPPED) {
      this.logger.warn({ currentState: this.state }, 'Connection manager already running');
      return;
    }

    const oldState = this.state;
    this.state = ConnectionManagerState.RUNNING;
    this.emit('manager:state_change', oldState, this.state);

    // Start health check timer
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks().catch((err) => {
        this.logger.error({ err }, 'Health check cycle failed');
      });
    }, this.config.healthCheckInterval);

    // Start cleanup timer
    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleConnections();
    }, this.config.cleanupInterval);

    this.logger.info({ config: this.config }, 'Connection manager started');
  }

  /**
   * Stop the connection manager gracefully
   */
  async stop(): Promise<void> {
    if (this.state !== ConnectionManagerState.RUNNING) {
      return;
    }

    const oldState = this.state;
    this.state = ConnectionManagerState.STOPPING;
    this.emit('manager:state_change', oldState, this.state);

    this.logger.info('Stopping connection manager...');

    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Clear reconnect timers
    for (const [_peerId, timer] of this.reconnectTimers) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    // Close all connections gracefully
    const closePromises: Promise<void>[] = [];
    for (const [_id, managed] of this.connections) {
      closePromises.push(this.closeConnection(managed, 'manager_shutdown'));
    }

    await Promise.allSettled(closePromises);

    this.connections.clear();
    this.peerConnections.clear();

    this.state = ConnectionManagerState.STOPPED;
    this.emit('manager:state_change', ConnectionManagerState.STOPPING, this.state);

    this.logger.info('Connection manager stopped');
  }

  /**
   * Add a new connection to the pool
   *
   * @param peerId - Peer identifier
   * @param connection - Transport connection
   * @returns Managed connection or null if limit reached
   */
  addConnection(peerId: string, connection: ITransportConnection): ManagedConnection | null {
    // Check global limit
    if (this.connections.size >= this.config.maxTotalConnections) {
      this.logger.warn(
        { totalConnections: this.connections.size, limit: this.config.maxTotalConnections },
        'Global connection limit reached'
      );
      this.emit('pool:limit_reached', 'global', this.config.maxTotalConnections);
      return null;
    }

    // Check per-peer limit
    const peerConns = this.peerConnections.get(peerId);
    if (peerConns && peerConns.size >= this.config.maxConnectionsPerPeer) {
      this.logger.warn(
        { peerId, connections: peerConns.size, limit: this.config.maxConnectionsPerPeer },
        'Per-peer connection limit reached'
      );
      this.emit('pool:limit_reached', peerId, this.config.maxConnectionsPerPeer);
      return null;
    }

    const now = Date.now();
    const managed: ManagedConnection = {
      id: connection.id,
      peerId,
      connection,
      state: ManagedConnectionState.HEALTHY,
      lastActivity: now,
      lastHeartbeat: now,
      missedHeartbeats: 0,
      createdAt: now,
      reuseCount: 0,
      reconnectAttempts: 0,
    };

    // Store connection
    this.connections.set(managed.id, managed);

    // Track per-peer
    if (!this.peerConnections.has(peerId)) {
      this.peerConnections.set(peerId, new Set());
    }
    this.peerConnections.get(peerId)!.add(managed.id);

    // Setup connection event handlers
    this.setupConnectionHandlers(managed);

    this.emit('connection:added', managed);
    this.logger.debug({ connectionId: managed.id, peerId }, 'Connection added to pool');

    return managed;
  }

  /**
   * Get an available connection for a peer from the pool
   *
   * @param peerId - Peer identifier
   * @param checkoutId - Optional identifier for debugging who checked out
   * @returns Managed connection or null if none available
   */
  checkout(peerId: string, checkoutId?: string): ManagedConnection | null {
    const peerConns = this.peerConnections.get(peerId);
    if (!peerConns || peerConns.size === 0) {
      return null;
    }

    // Find a healthy, idle connection
    for (const connId of peerConns) {
      const managed = this.connections.get(connId);
      if (
        managed &&
        (managed.state === ManagedConnectionState.HEALTHY || managed.state === ManagedConnectionState.IDLE)
      ) {
        managed.state = ManagedConnectionState.IN_USE;
        managed.lastActivity = Date.now();
        managed.reuseCount++;
        managed.checkedOutBy = checkoutId;

        this.logger.debug({ connectionId: managed.id, peerId, checkoutId }, 'Connection checked out');
        return managed;
      }
    }

    return null;
  }

  /**
   * Return a connection to the pool
   *
   * @param connectionId - Connection ID to return
   */
  checkin(connectionId: string): void {
    const managed = this.connections.get(connectionId);
    if (!managed) {
      this.logger.warn({ connectionId }, 'Attempted to check in unknown connection');
      return;
    }

    if (managed.state === ManagedConnectionState.CLOSING || managed.state === ManagedConnectionState.CLOSED) {
      this.logger.debug({ connectionId }, 'Connection already closing/closed, not returning to pool');
      return;
    }

    managed.state = managed.missedHeartbeats > 0 ? ManagedConnectionState.UNHEALTHY : ManagedConnectionState.IDLE;
    managed.lastActivity = Date.now();
    managed.checkedOutBy = undefined;

    this.logger.debug(
      { connectionId: managed.id, peerId: managed.peerId, state: managed.state },
      'Connection checked in'
    );
  }

  /**
   * Remove a connection from the pool
   *
   * @param connectionId - Connection ID to remove
   * @param reason - Reason for removal
   */
  async removeConnection(connectionId: string, reason: string): Promise<void> {
    const managed = this.connections.get(connectionId);
    if (!managed) {
      return;
    }

    await this.closeConnection(managed, reason);
  }

  /**
   * Get all connections for a peer
   */
  getConnectionsForPeer(peerId: string): ManagedConnection[] {
    const peerConns = this.peerConnections.get(peerId);
    if (!peerConns) {
      return [];
    }

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
   * Get a specific connection by ID
   */
  getConnection(connectionId: string): ManagedConnection | undefined {
    return this.connections.get(connectionId);
  }

  /**
   * Check if a peer has available connections
   */
  hasAvailableConnection(peerId: string): boolean {
    const peerConns = this.peerConnections.get(peerId);
    if (!peerConns) {
      return false;
    }

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
   * Get pool statistics
   */
  getStats(): ConnectionPoolStats {
    let activeCount = 0;
    let idleCount = 0;
    let unhealthyCount = 0;
    let totalAge = 0;
    let totalReuse = 0;
    const now = Date.now();

    const connectionsPerPeer = new Map<string, number>();

    for (const [_id, managed] of this.connections) {
      // Count by state
      switch (managed.state) {
        case ManagedConnectionState.IN_USE:
          activeCount++;
          break;
        case ManagedConnectionState.IDLE:
        case ManagedConnectionState.HEALTHY:
          idleCount++;
          break;
        case ManagedConnectionState.UNHEALTHY:
          unhealthyCount++;
          break;
        default:
          // CONNECTING, CLOSING, CLOSED states are not counted as active/idle
          break;
      }

      // Aggregate metrics
      totalAge += now - managed.createdAt;
      totalReuse += managed.reuseCount;

      // Per-peer count
      const peerCount = connectionsPerPeer.get(managed.peerId) ?? 0;
      connectionsPerPeer.set(managed.peerId, peerCount + 1);
    }

    const totalConnections = this.connections.size;

    return {
      totalConnections,
      activeConnections: activeCount,
      idleConnections: idleCount,
      unhealthyConnections: unhealthyCount,
      connectionsPerPeer,
      averageConnectionAge: totalConnections > 0 ? totalAge / totalConnections : 0,
      averageReuseCount: totalConnections > 0 ? totalReuse / totalConnections : 0,
      healthCheckSuccessRate: this.totalHealthChecks > 0 ? this.successfulHealthChecks / this.totalHealthChecks : 1,
      totalBytesSent: this.totalBytesSent,
      totalBytesReceived: this.totalBytesReceived,
    };
  }

  /**
   * Get current manager state
   */
  getState(): ConnectionManagerState {
    return this.state;
  }

  /**
   * Force health check on all connections
   */
  async forceHealthCheck(): Promise<void> {
    await this.performHealthChecks();
  }

  /**
   * Calculate reconnection delay with exponential backoff and jitter
   *
   * @param attempt - Current attempt number (0-based)
   * @returns Delay in milliseconds
   */
  calculateReconnectDelay(attempt: number): number {
    const baseDelay = this.config.reconnect.baseDelay;
    const maxDelay = this.config.reconnect.maxDelay;
    const jitterFactor = this.config.reconnect.jitterFactor;

    // Exponential backoff: baseDelay * 2^attempt
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);

    // Add jitter: delay * (1 - jitter/2 + random * jitter)
    // This spreads reconnection attempts to avoid thundering herd
    const jitter = exponentialDelay * jitterFactor * (Math.random() - 0.5);
    const delay = exponentialDelay + jitter;

    return Math.max(baseDelay, Math.min(delay, maxDelay));
  }

  /**
   * Schedule reconnection for a peer
   *
   * @param peerId - Peer to reconnect
   * @param connectionFactory - Factory function to create new connection
   */
  scheduleReconnect(peerId: string, connectionFactory: () => Promise<ITransportConnection>): void {
    if (!this.config.reconnect.enabled) {
      return;
    }

    // Cancel any existing reconnect timer for this peer
    const existingTimer = this.reconnectTimers.get(peerId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Find the highest attempt count for this peer
    let maxAttempts = 0;
    const peerConns = this.peerConnections.get(peerId);
    if (peerConns) {
      for (const connId of peerConns) {
        const managed = this.connections.get(connId);
        if (managed) {
          maxAttempts = Math.max(maxAttempts, managed.reconnectAttempts);
        }
      }
    }

    // Check if we've exceeded max attempts
    const configMaxAttempts = this.config.reconnect.maxAttempts;
    if (configMaxAttempts > 0 && maxAttempts >= configMaxAttempts) {
      this.logger.error(
        { peerId, attempts: maxAttempts, maxAttempts: configMaxAttempts },
        'Reconnection attempts exhausted'
      );
      this.emit('connection:reconnect_failed', peerId, Errors.timeout('Reconnection', configMaxAttempts));
      return;
    }

    const delay = this.calculateReconnectDelay(maxAttempts);
    this.logger.info({ peerId, attempt: maxAttempts + 1, delay }, 'Scheduling reconnection');

    this.emit('connection:reconnecting', peerId, maxAttempts + 1);

    const timer = setTimeout(async () => {
      this.reconnectTimers.delete(peerId);

      try {
        const newConnection = await connectionFactory();
        const managed = this.addConnection(peerId, newConnection);

        if (managed) {
          managed.reconnectAttempts = maxAttempts + 1;
          this.emit('connection:reconnected', managed);
          this.logger.info({ peerId, connectionId: managed.id }, 'Reconnection successful');
        }
      } catch (error) {
        this.logger.warn({ peerId, error, attempt: maxAttempts + 1 }, 'Reconnection attempt failed');

        // Schedule next attempt
        this.scheduleReconnect(peerId, connectionFactory);
      }
    }, delay);

    this.reconnectTimers.set(peerId, timer);
  }

  /**
   * Cancel pending reconnection for a peer
   */
  cancelReconnect(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
      this.logger.debug({ peerId }, 'Reconnection cancelled');
    }
  }

  // --- Private Methods ---

  /**
   * Setup event handlers for a managed connection
   */
  private setupConnectionHandlers(managed: ManagedConnection): void {
    const { connection } = managed;

    // Track disconnect
    connection.on('disconnect', (reason?: string) => {
      this.handleConnectionDisconnect(managed, reason);
    });

    // Track errors
    connection.on('error', (error: Error) => {
      this.logger.error({ connectionId: managed.id, error }, 'Connection error');
      managed.state = ManagedConnectionState.UNHEALTHY;
      this.emit('connection:unhealthy', managed);
    });

    // Track data for metrics
    if (this.config.enableMetrics) {
      connection.on('data', (data: Buffer | ArrayBuffer) => {
        this.totalBytesReceived += data.byteLength;
        managed.lastActivity = Date.now();
      });
    }
  }

  /**
   * Handle connection disconnect
   */
  private handleConnectionDisconnect(managed: ManagedConnection, reason?: string): void {
    this.logger.info({ connectionId: managed.id, peerId: managed.peerId, reason }, 'Connection disconnected');

    managed.state = ManagedConnectionState.CLOSED;
    this.emit('connection:removed', managed, reason ?? 'disconnected');

    // Remove from tracking
    this.connections.delete(managed.id);
    const peerConns = this.peerConnections.get(managed.peerId);
    if (peerConns) {
      peerConns.delete(managed.id);
      if (peerConns.size === 0) {
        this.peerConnections.delete(managed.peerId);
      }
    }
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const now = Date.now();
    const healthCheckPromises: Promise<void>[] = [];

    for (const [_id, managed] of this.connections) {
      // Skip connections that are closing or in use
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
   * Check health of a single connection
   */
  private async checkConnectionHealth(managed: ManagedConnection, now: number): Promise<void> {
    this.totalHealthChecks++;

    try {
      // Perform ping with timeout
      const rtt = await Promise.race([
        managed.connection.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Heartbeat timeout')), this.config.heartbeatTimeout)
        ),
      ]);

      // Successful heartbeat
      managed.lastHeartbeat = now;
      managed.missedHeartbeats = 0;
      this.successfulHealthChecks++;

      // Recover if was unhealthy
      if (managed.state === ManagedConnectionState.UNHEALTHY) {
        managed.state = ManagedConnectionState.HEALTHY;
        this.emit('connection:recovered', managed);
        this.logger.info({ connectionId: managed.id, rtt }, 'Connection recovered');
      }
    } catch (error) {
      // Failed heartbeat
      managed.missedHeartbeats++;
      this.logger.warn(
        { connectionId: managed.id, missedHeartbeats: managed.missedHeartbeats, error },
        'Heartbeat failed'
      );

      if (managed.missedHeartbeats >= this.config.maxMissedHeartbeats) {
        managed.state = ManagedConnectionState.UNHEALTHY;
        this.emit('connection:unhealthy', managed);
        this.logger.error(
          { connectionId: managed.id, missedHeartbeats: managed.missedHeartbeats },
          'Connection marked unhealthy'
        );
      }
    }
  }

  /**
   * Cleanup idle connections that have exceeded timeout
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, managed] of this.connections) {
      // Only cleanup idle connections
      if (managed.state !== ManagedConnectionState.IDLE && managed.state !== ManagedConnectionState.HEALTHY) {
        continue;
      }

      // Check if idle timeout exceeded
      const idleTime = now - managed.lastActivity;
      if (idleTime > this.config.idleTimeout) {
        // Keep at least poolSize connections per peer
        const peerConns = this.peerConnections.get(managed.peerId);
        if (peerConns && peerConns.size > this.config.poolSize) {
          toRemove.push(id);
          this.logger.debug(
            { connectionId: id, peerId: managed.peerId, idleTime },
            'Marking connection for idle cleanup'
          );
        }
      }
    }

    // Remove idle connections
    for (const id of toRemove) {
      const managed = this.connections.get(id);
      if (managed) {
        this.emit('connection:idle', managed);
        this.closeConnection(managed, 'idle_timeout').catch((err) => {
          this.logger.error({ connectionId: id, err }, 'Error during idle cleanup');
        });
      }
    }

    if (toRemove.length > 0) {
      this.logger.info({ removedCount: toRemove.length }, 'Idle connections cleaned up');
    }
  }

  /**
   * Close a managed connection gracefully
   */
  private async closeConnection(managed: ManagedConnection, reason: string): Promise<void> {
    if (managed.state === ManagedConnectionState.CLOSING || managed.state === ManagedConnectionState.CLOSED) {
      return;
    }

    managed.state = ManagedConnectionState.CLOSING;

    try {
      // Get metrics before closing
      const metrics = managed.connection.getMetrics?.();
      if (metrics) {
        this.totalBytesSent += metrics.bytesSent;
      }

      await managed.connection.close(1000, reason);
    } catch (error) {
      this.logger.warn({ connectionId: managed.id, error }, 'Error closing connection');
    } finally {
      managed.state = ManagedConnectionState.CLOSED;

      // Remove from tracking
      this.connections.delete(managed.id);
      const peerConns = this.peerConnections.get(managed.peerId);
      if (peerConns) {
        peerConns.delete(managed.id);
        if (peerConns.size === 0) {
          this.peerConnections.delete(managed.peerId);
        }
      }

      this.emit('connection:removed', managed, reason);
      this.logger.debug({ connectionId: managed.id, reason }, 'Connection closed');
    }
  }
}
