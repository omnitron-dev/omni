/**
 * Keep-Alive Manager for WebSocket Connections
 *
 * Provides shared timer management for WebSocket keep-alive (ping/pong) operations.
 * Uses a timer wheel pattern to batch ping operations across multiple connections,
 * significantly reducing timer overhead for high connection counts (>100).
 *
 * @module @omnitron-dev/titan/netron/transport/websocket
 */

import { WebSocket } from 'ws';
import type { WebSocketConnection } from './connection.js';

/**
 * Connection entry in the keep-alive registry
 */
interface ConnectionEntry {
  connection: WebSocketConnection;
  socket: WebSocket;
  pongTimeout?: NodeJS.Timeout;
}

/**
 * Keep-alive manager configuration
 */
export interface KeepAliveConfig {
  /** Interval between ping operations in milliseconds */
  interval: number;
  /** Timeout for pong response in milliseconds */
  timeout: number;
}

/**
 * Shared keep-alive manager for WebSocket connections
 *
 * Uses a singleton pattern with a shared timer wheel to batch ping operations
 * across all registered connections. This reduces timer overhead from O(n)
 * individual timers to O(1) shared timer.
 *
 * Expected performance gain: 20-30% reduction in timer overhead for >100 connections.
 *
 * @example
 * ```typescript
 * const manager = KeepAliveManager.getInstance({ interval: 30000, timeout: 5000 });
 * manager.register(connection, socket);
 * // ... later ...
 * manager.unregister(connection);
 * ```
 */
export class KeepAliveManager {
  /**
   * WIRE-12: managers are keyed by config, NOT a single process-global
   * singleton. A lone singleton meant the FIRST caller's
   * `{interval, timeout}` was forced onto every WebSocket connection in
   * the process — a second connection (or a second Netron instance) that
   * asked for a different interval/timeout silently got the first one's.
   * Keying by config preserves the timer-wheel win (connections that
   * share a config share a manager + one timer) while honouring distinct
   * keep-alive settings.
   */
  private static instances = new Map<string, KeepAliveManager>();
  private connections = new Map<string, ConnectionEntry>();
  private timer?: NodeJS.Timeout;
  private config: KeepAliveConfig;

  private constructor(config: KeepAliveConfig) {
    this.config = config;
  }

  private static keyFor(config: KeepAliveConfig): string {
    return `${config.interval}:${config.timeout}`;
  }

  /**
   * Get or create the manager for a given keep-alive config. Calls with
   * an equal `{interval, timeout}` share one manager (and its timer
   * wheel); calls with a different config get a distinct manager.
   *
   * @param config - Keep-alive configuration (interval and timeout)
   * @returns The KeepAliveManager for this config
   */
  static getInstance(config: KeepAliveConfig): KeepAliveManager {
    const key = KeepAliveManager.keyFor(config);
    let instance = KeepAliveManager.instances.get(key);
    if (!instance) {
      instance = new KeepAliveManager(config);
      KeepAliveManager.instances.set(key, instance);
    }
    return instance;
  }

  /**
   * Destroy and drop every manager (primarily for testing).
   */
  static reset(): void {
    for (const instance of KeepAliveManager.instances.values()) {
      instance.destroy();
    }
    KeepAliveManager.instances.clear();
  }

  /**
   * Register a connection for keep-alive management
   *
   * @param connection - The WebSocket connection to manage
   * @param socket - The underlying WebSocket instance
   */
  register(connection: WebSocketConnection, socket: WebSocket): void {
    // Store connection entry
    this.connections.set(connection.id, {
      connection,
      socket,
    });

    // Setup pong handler for this connection
    const pongHandler = () => {
      const entry = this.connections.get(connection.id);
      if (entry?.pongTimeout) {
        clearTimeout(entry.pongTimeout);
        entry.pongTimeout = undefined;
      }
    };

    socket.on('pong', pongHandler);

    // Store cleanup function on socket for later removal
    (socket as any).__keepAliveCleanup = () => {
      socket.removeListener('pong', pongHandler);
    };

    // Start timer if this is the first connection
    if (this.connections.size === 1) {
      this.startTimer();
    }
  }

  /**
   * Unregister a connection from keep-alive management
   *
   * @param connection - The connection to unregister
   */
  unregister(connection: WebSocketConnection): void {
    this.removeConnection(connection.id);
  }

  /**
   * Remove a connection by id: clear its pong timeout, detach the 'pong'
   * listener, drop it from the registry, and stop the shared timer if no
   * connections remain.
   *
   * Shared by unregister() and the pong-timeout termination path. WIRE-12:
   * the latter formerly did a bare `connections.delete(id)`, leaving the
   * 'pong' listener attached to the (possibly lingering) socket and the
   * shared timer spinning even after it drained the last connection.
   */
  private removeConnection(id: string): void {
    const entry = this.connections.get(id);
    if (!entry) {
      return;
    }

    if (entry.pongTimeout) {
      clearTimeout(entry.pongTimeout);
      entry.pongTimeout = undefined;
    }

    if ((entry.socket as any).__keepAliveCleanup) {
      (entry.socket as any).__keepAliveCleanup();
      delete (entry.socket as any).__keepAliveCleanup;
    }

    this.connections.delete(id);

    if (this.connections.size === 0) {
      this.stopTimer();
    }
  }

  /**
   * Start the shared timer
   */
  private startTimer(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      this.pingAll();
    }, this.config.interval);

    // Allow Node.js to exit if only timer is active
    this.timer.unref?.();
  }

  /**
   * Stop the shared timer
   */
  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Send ping to all registered connections
   *
   * Iterates through all connections and sends ping frames.
   * For each ping, sets a timeout to terminate the connection
   * if pong is not received within the configured timeout.
   */
  private pingAll(): void {
    for (const [id, entry] of this.connections.entries()) {
      const { socket } = entry;

      // Only ping if socket is open
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      try {
        // Send ping
        socket.ping();

        // Clear any existing pong timeout
        if (entry.pongTimeout) {
          clearTimeout(entry.pongTimeout);
        }

        // Set new pong timeout
        entry.pongTimeout = setTimeout(() => {
          // Terminate connection if no pong received
          try {
            socket.terminate();
          } catch (_error) {
            // Ignore errors during termination
          }

          // Full cleanup (listener + timer), not a bare delete (WIRE-12).
          this.removeConnection(id);
        }, this.config.timeout);
      } catch (_error) {
        // Ignore ping errors (connection may be closing)
      }
    }
  }

  /**
   * Get current connection count
   *
   * @returns Number of active connections being managed
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Check if a connection is registered
   *
   * @param connection - The connection to check
   * @returns True if the connection is registered
   */
  isRegistered(connection: WebSocketConnection): boolean {
    return this.connections.has(connection.id);
  }

  /**
   * Get current configuration
   *
   * @returns The current keep-alive configuration
   */
  getConfig(): Readonly<KeepAliveConfig> {
    return { ...this.config };
  }

  /**
   * Destroy the manager and clean up all resources
   *
   * Stops the timer and clears all pending timeouts.
   * Should be called when shutting down the application.
   */
  destroy(): void {
    // Stop timer
    this.stopTimer();

    // Clear all pong timeouts and remove listeners
    for (const [_id, entry] of this.connections.entries()) {
      if (entry.pongTimeout) {
        clearTimeout(entry.pongTimeout);
      }
      if ((entry.socket as any).__keepAliveCleanup) {
        (entry.socket as any).__keepAliveCleanup();
        delete (entry.socket as any).__keepAliveCleanup;
      }
    }

    // Clear connections
    this.connections.clear();
  }
}
