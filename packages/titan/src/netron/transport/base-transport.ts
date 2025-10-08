/**
 * Base Transport Implementation
 *
 * Provides common functionality for all transport implementations.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { randomUUID } from 'node:crypto';
import {
  ITransport,
  ITransportConnection,
  ITransportServer,
  TransportCapabilities,
  TransportOptions,
  TransportAddress,
  ConnectionState,
  ConnectionMetrics,
  ServerMetrics
} from './types.js';
import { Packet, encodePacket, decodePacket, TYPE_PING } from '../packet/index.js';

/**
 * Base connection class with common functionality
 */
export abstract class BaseConnection extends EventEmitter implements ITransportConnection {
  public readonly id: string = randomUUID();
  protected _state: ConnectionState = ConnectionState.DISCONNECTED;
  protected metrics: ConnectionMetrics = {
    bytesSent: 0,
    bytesReceived: 0,
    packetsSent: 0,
    packetsReceived: 0,
    duration: 0,
    rtt: undefined
  };
  protected connectionStartTime?: number;
  protected reconnectAttempts = 0;
  protected reconnectTimer?: NodeJS.Timeout;
  private pendingPings = new Map<number, { resolve: (rtt: number) => void; reject: (error: Error) => void; startTime: number; }>();

  constructor(protected options: TransportOptions = {}) {
    super();
  }

  get state(): ConnectionState {
    return this._state;
  }

  protected setState(state: ConnectionState): void {
    if (this._state !== state) {
      this._state = state;
      this.emit('state', state);
    }
  }

  abstract get remoteAddress(): string | undefined;
  abstract get localAddress(): string | undefined;
  abstract send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void>;
  abstract close(code?: number, reason?: string): Promise<void>;

  /**
   * Send a packet with automatic encoding
   */
  async sendPacket(packet: Packet): Promise<void> {
    const encoded = encodePacket(packet);
    await this.send(encoded);
    this.metrics.packetsSent++;
  }

  /**
   * Handle received data and decode packets
   */
  protected handleData(data: Buffer | ArrayBuffer): void {
    this.metrics.bytesReceived += data.byteLength;

    // Check if this looks like a packet (starts with valid packet header)
    // Packets start with a 4-byte ID, then a flags byte
    // For now, just check if it's binary-looking data vs text
    let isLikelyText = false;
    if (Buffer.isBuffer(data) && data.length > 0) {
      const firstByte = data[0]!;
      isLikelyText = firstByte === 0x7B || // '{' for JSON
                     firstByte === 0x22 || // '"' for strings
                     (firstByte >= 0x20 && firstByte <= 0x7E); // printable ASCII
    }

    if (isLikelyText) {
      // Emit as raw data for handshake messages
      this.emit('data', data);
    } else {
      // Try to decode as packet
      try {
        const packet = decodePacket(data);
        this.metrics.packetsReceived++;

        // Handle PING packets internally
        if (packet.getType() === TYPE_PING) {
          this.handlePingPacket(packet);
        } else {
          this.emit('packet', packet);
        }
      } catch (error: any) {
        // Not a valid packet, emit as raw data
        this.emit('data', data);
      }
    }
  }

  /**
   * Handle PING packet
   */
  private handlePingPacket(packet: Packet): void {
    // Check if this is a ping request (impulse = 1) or response (impulse = 0)
    if (packet.getImpulse() === 1) {
      // This is a ping request - send pong response
      const pongPacket = new Packet(packet.id);
      pongPacket.setType(TYPE_PING);
      pongPacket.setImpulse(0); // Response
      pongPacket.data = packet.data; // Echo timestamp
      this.sendPacket(pongPacket).catch(err => {
        console.error('Failed to send pong:', err);
      });
    } else {
      // This is a pong response - resolve pending ping
      const pending = this.pendingPings.get(packet.id);
      if (pending) {
        this.pendingPings.delete(packet.id);
        const rtt = Date.now() - pending.startTime;
        this.metrics.rtt = rtt;
        pending.resolve(rtt);
      }
    }
  }

  /**
   * Handle connection establishment
   */
  protected handleConnect(): void {
    this.connectionStartTime = Date.now();
    this.reconnectAttempts = 0;
    this.setState(ConnectionState.CONNECTED);
    this.emit('connect');
  }

  /**
   * Handle disconnection with optional reconnection
   */
  protected handleDisconnect(reason?: string): void {
    this.setState(ConnectionState.DISCONNECTED);
    this.emit('disconnect', reason);

    if (this.options.reconnect?.enabled &&
        this.reconnectAttempts < (this.options.reconnect.maxAttempts ?? 5)) {
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  protected scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    const delay = Math.min(
      (this.options.reconnect?.delay ?? 1000) *
      Math.pow(this.options.reconnect?.factor ?? 2, this.reconnectAttempts),
      this.options.reconnect?.maxDelay ?? 30000
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectAttempts++;
      this.setState(ConnectionState.RECONNECTING);
      this.emit('reconnect', this.reconnectAttempts);
      this.doReconnect().catch(error => {
        if (this.reconnectAttempts >= (this.options.reconnect?.maxAttempts ?? 5)) {
          this.emit('reconnect_failed');
        } else {
          this.handleDisconnect('Reconnection failed');
        }
      });
    }, delay);
  }

  /**
   * Perform reconnection (override in subclasses)
   */
  protected abstract doReconnect(): Promise<void>;

  /**
   * Ping the connection using TYPE_PING packet
   * Returns round-trip time in milliseconds
   */
  async ping(): Promise<number> {
    if (this._state !== ConnectionState.CONNECTED) {
      throw new Error('Connection is not established');
    }

    const pingPacket = new Packet(Packet.nextId());
    pingPacket.setType(TYPE_PING);
    pingPacket.setImpulse(1); // Request
    pingPacket.data = Date.now(); // Timestamp

    return new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingPings.delete(pingPacket.id);
        reject(new Error('Ping timeout'));
      }, this.options.requestTimeout ?? 5000);

      this.pendingPings.set(pingPacket.id, {
        resolve: (rtt: number) => {
          clearTimeout(timeout);
          resolve(rtt);
        },
        reject: (error: Error) => {
          clearTimeout(timeout);
          reject(error);
        },
        startTime: Date.now()
      });

      this.sendPacket(pingPacket).catch(err => {
        clearTimeout(timeout);
        this.pendingPings.delete(pingPacket.id);
        reject(err);
      });
    });
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return {
      ...this.metrics,
      duration: this.connectionStartTime ? Date.now() - this.connectionStartTime : 0
    };
  }

  /**
   * Clean up resources
   */
  protected cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    // Reject all pending pings
    for (const [id, pending] of this.pendingPings.entries()) {
      pending.reject(new Error('Connection closed'));
    }
    this.pendingPings.clear();
  }
}

/**
 * Base server class with common functionality
 */
export abstract class BaseServer extends EventEmitter implements ITransportServer {
  public readonly connections = new Map<string, ITransportConnection>();
  protected metrics: ServerMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    totalBytesSent: 0,
    totalBytesReceived: 0,
    uptime: 0
  };
  protected serverStartTime?: number;

  constructor(protected options: TransportOptions = {}) {
    super();
  }

  abstract get address(): string | undefined;
  abstract get port(): number | undefined;
  abstract listen(): Promise<void>;
  abstract close(): Promise<void>;

  /**
   * Handle new connection
   */
  protected handleConnection(connection: ITransportConnection): void {
    this.connections.set(connection.id, connection);
    this.metrics.totalConnections++;
    this.metrics.activeConnections++;

    // Track metrics
    connection.on('disconnect', () => {
      this.connections.delete(connection.id);
      this.metrics.activeConnections--;
    });

    // Forward connection metrics to server
    const originalSend = connection.send.bind(connection);
    connection.send = async (data: Buffer | ArrayBuffer | Uint8Array) => {
      this.metrics.totalBytesSent += data.byteLength;
      return originalSend(data);
    };

    connection.on('data', (data: Buffer | ArrayBuffer) => {
      this.metrics.totalBytesReceived += data.byteLength;
    });

    this.emit('connection', connection);
  }

  /**
   * Broadcast data to all connections
   */
  async broadcast(data: Buffer | ArrayBuffer): Promise<void> {
    const promises = Array.from(this.connections.values()).map(conn =>
      conn.send(data).catch(error => {
        console.error(`Failed to broadcast to connection ${conn.id}:`, error);
      })
    );
    await Promise.all(promises);
  }

  /**
   * Broadcast packet to all connected clients
   */
  async broadcastPacket(packet: Packet): Promise<void> {
    const promises = Array.from(this.connections.values()).map(conn =>
      conn.sendPacket(packet).catch(error => {
        console.error(`Failed to broadcast packet to connection ${conn.id}:`, error);
      })
    );
    await Promise.all(promises);
  }

  /**
   * Get server metrics
   */
  getMetrics(): ServerMetrics {
    return {
      ...this.metrics,
      uptime: this.serverStartTime ? Date.now() - this.serverStartTime : 0
    };
  }

  /**
   * Handle server start
   */
  protected handleListening(): void {
    this.serverStartTime = Date.now();
    this.emit('listening');
  }

  /**
   * Handle server close
   */
  protected handleClose(): void {
    this.emit('close');
  }
}

/**
 * Base transport class with common functionality
 */
export abstract class BaseTransport implements ITransport {
  abstract readonly name: string;
  abstract readonly capabilities: TransportCapabilities;
  abstract connect(address: string, options?: TransportOptions): Promise<ITransportConnection>;

  /**
   * Default implementation for server creation (can be overridden)
   */
  createServer?(options?: TransportOptions): Promise<ITransportServer> {
    if (!this.capabilities.server) {
      throw new Error(`Transport ${this.name} does not support server mode`);
    }
    throw new Error(`Transport ${this.name} has not implemented createServer`);
  }

  /**
   * Parse a connection address into components
   */
  parseAddress(address: string): TransportAddress {
    // Handle various address formats
    // Support both IPv4 and IPv6 addresses
    const urlPattern = /^([a-z]+):\/\/(\[([^\]]+)\]|([^:/]+))(?::(\d+))?(\/.*)?(\?.*)?$/i;
    const unixPattern = /^unix:(.+)$/i;
    const ipcPattern = /^ipc:(.+)$/i;

    // Try URL pattern first
    const urlMatch = address.match(urlPattern);
    if (urlMatch) {
      const [, protocol, , ipv6Host, regularHost, port, path, query] = urlMatch;
      // Keep brackets for IPv6 addresses
      const host = ipv6Host ? `[${ipv6Host}]` : regularHost;
      const params: Record<string, string> = {};

      if (query) {
        const searchParams = new URLSearchParams(query.substring(1));
        searchParams.forEach((value, key) => {
          params[key] = value;
        });
      }

      const parsedPort = port ? parseInt(port, 10) : undefined;
      if (parsedPort !== undefined && (parsedPort < 0 || parsedPort > 65535)) {
        throw new Error(`Port number out of range: ${parsedPort}`);
      }

      return {
        protocol: protocol || 'tcp',
        host,
        port: parsedPort,
        path,
        params
      };
    }

    // Try Unix socket pattern
    const unixMatch = address.match(unixPattern);
    if (unixMatch) {
      return {
        protocol: 'unix',
        path: unixMatch[1]
      };
    }

    // Try IPC pattern
    const ipcMatch = address.match(ipcPattern);
    if (ipcMatch) {
      return {
        protocol: 'ipc',
        path: ipcMatch[1]
      };
    }

    // Default: assume it's a host:port
    const parts = address.split(':');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        protocol: this.name,
        host: parts[0],
        port: parseInt(parts[1], 10)
      };
    }

    return {
      protocol: this.name,
      host: address
    };
  }

  /**
   * Check if address is valid for this transport
   */
  isValidAddress(address: string): boolean {
    try {
      const parsed = this.parseAddress(address);
      return parsed.protocol === this.name ||
             (this.name === 'ws' && (parsed.protocol === 'ws' || parsed.protocol === 'wss'));
    } catch {
      return false;
    }
  }
}