/**
 * Transport Abstraction Layer Types
 *
 * Provides a pluggable transport system for Netron, replacing hardcoded WebSocket dependency
 * while maintaining full compatibility with existing packet protocol.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import type { Packet } from '../packet/packet.js';

// Re-export Packet for convenience
export { Packet } from '../packet/packet.js';

/**
 * Transport capabilities descriptor
 */
export interface TransportCapabilities {
  /** Supports streaming data */
  streaming: boolean;
  /** Supports bidirectional communication */
  bidirectional: boolean;
  /**
   * Protocol is natively binary at wire level.
   *
   * True: Protocol transmits raw binary data (TCP, Unix sockets, WebSocket binary frames)
   * False: Protocol is text-based even if it can carry binary payloads (HTTP)
   *
   * This indicates the fundamental nature of the protocol, not the ability to
   * transport binary data (all transports can carry binary data in some form).
   *
   * Examples:
   * - TCP: true (raw bytes on wire)
   * - Unix Socket: true (raw bytes on wire)
   * - WebSocket: true (supports binary frames per spec)
   * - HTTP: false (text protocol: headers + status line always text, even with binary body)
   */
  binary: boolean;
  /** Supports automatic reconnection */
  reconnection: boolean;
  /** Supports multiplexing multiple connections */
  multiplexing: boolean;
  /** Supports server mode (listening for connections) */
  server: boolean;
}

/**
 * Base transport options
 */
export interface TransportOptions {
  /** Reconnection options */
  reconnect?: {
    enabled?: boolean;
    maxAttempts?: number;
    delay?: number;
    maxDelay?: number;
    factor?: number;
  };
  /** Connection timeout in milliseconds */
  connectTimeout?: number;
  /** Keep-alive configuration */
  keepAlive?: {
    enabled?: boolean;
    interval?: number;
    timeout?: number;
  };
  /** Buffer sizes */
  bufferSize?: number;
  /** Enable compression */
  compression?: boolean;
  /** Custom headers or metadata */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** HTTP server specific options */
  host?: string;
  port?: number;
  cors?: any;
}

/**
 * Connection state
 */
export enum ConnectionState {
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  DISCONNECTING = 'disconnecting',
  DISCONNECTED = 'disconnected',
  RECONNECTING = 'reconnecting',
  ERROR = 'error'
}

/**
 * Connection events
 */
export interface ConnectionEvents {
  'connect': () => void;
  'disconnect': (reason?: string) => void;
  'error': (error: Error) => void;
  'data': (data: Buffer | ArrayBuffer) => void;
  'packet': (packet: Packet) => void;
  'state': (state: ConnectionState) => void;
  'reconnect': (attempt: number) => void;
  'reconnect_failed': () => void;
}

/**
 * Transport connection interface
 */
export interface ITransportConnection extends EventEmitter {
  /** Connection ID */
  readonly id: string;

  /** Current connection state */
  readonly state: ConnectionState;

  /** Remote address (if available) */
  readonly remoteAddress?: string;

  /** Local address (if available) */
  readonly localAddress?: string;

  /** Send raw data */
  send(data: Buffer | ArrayBuffer | Uint8Array): Promise<void>;

  /** Send a packet (convenience method) */
  sendPacket(packet: Packet): Promise<void>;

  /** Close the connection */
  close(code?: number, reason?: string): Promise<void>;

  /** Ping the connection (if supported) */
  ping?(): Promise<void>;

  /** Get connection metrics */
  getMetrics?(): ConnectionMetrics;
}

/**
 * Server events
 */
export interface ServerEvents {
  'connection': (connection: ITransportConnection) => void;
  'error': (error: Error) => void;
  'listening': () => void;
  'close': () => void;
}

/**
 * Transport server interface
 */
export interface ITransportServer extends EventEmitter {
  /** Server address */
  readonly address?: string;

  /** Server port */
  readonly port?: number;

  /** Active connections */
  readonly connections: Map<string, ITransportConnection>;

  /** Start listening */
  listen(): Promise<void>;

  /** Stop the server */
  close(): Promise<void>;

  /** Broadcast to all connections */
  broadcast(data: Buffer | ArrayBuffer): Promise<void>;

  /** Get server metrics */
  getMetrics?(): ServerMetrics;
}

/**
 * Connection metrics
 */
export interface ConnectionMetrics {
  /** Bytes sent */
  bytesSent: number;
  /** Bytes received */
  bytesReceived: number;
  /** Packets sent */
  packetsSent: number;
  /** Packets received */
  packetsReceived: number;
  /** Connection duration in milliseconds */
  duration: number;
  /** Round-trip time in milliseconds */
  rtt?: number;
  /** Packet loss percentage */
  packetLoss?: number;
}

/**
 * Server metrics
 */
export interface ServerMetrics {
  /** Total connections handled */
  totalConnections: number;
  /** Currently active connections */
  activeConnections: number;
  /** Total bytes sent */
  totalBytesSent: number;
  /** Total bytes received */
  totalBytesReceived: number;
  /** Server uptime in milliseconds */
  uptime: number;
}

/**
 * Transport interface - main abstraction
 */
export interface ITransport {
  /** Transport name */
  readonly name: string;

  /** Transport capabilities */
  readonly capabilities: TransportCapabilities;

  /** Connect to a remote endpoint */
  connect(address: string, options?: TransportOptions): Promise<ITransportConnection>;

  /** Create a server (if supported) */
  createServer?(options?: TransportOptions): Promise<ITransportServer>;

  /** Check if address is valid for this transport */
  isValidAddress(address: string): boolean;

  /** Parse address into components */
  parseAddress(address: string): TransportAddress;
}

/**
 * Transport address components
 */
export interface TransportAddress {
  /** Transport protocol (ws, tcp, unix, etc.) */
  protocol: string;
  /** Host or path */
  host?: string;
  /** Port number */
  port?: number;
  /** Unix socket path */
  path?: string;
  /** Additional parameters */
  params?: Record<string, string>;
}

/**
 * Transport factory function
 */
export type TransportFactory = () => ITransport;

/**
 * Transport registry interface
 */
export interface ITransportRegistry {
  /** Register a transport */
  register(name: string, factory: TransportFactory): void;

  /** Get a transport by name */
  get(name: string): ITransport | undefined;

  /** Get all registered transport names */
  list(): string[];

  /** Check if transport is registered */
  has(name: string): boolean;

  /** Unregister a transport */
  unregister(name: string): boolean;

  /** Get transport by address protocol */
  getByProtocol(protocol: string): ITransport | undefined;
}