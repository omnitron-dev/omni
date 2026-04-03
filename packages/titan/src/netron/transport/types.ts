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
  /** Connection timeout in milliseconds (default: 10000) */
  connectTimeout?: number;
  /** Request timeout in milliseconds (default: 5000) */
  requestTimeout?: number;
  /** Stream timeout in milliseconds (default: 30000) */
  streamTimeout?: number;
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
  /** General timeout in milliseconds (deprecated - use specific timeouts) */
  timeout?: number;
  /** HTTP server specific options */
  host?: string;
  /** Enable automatic service discovery (HTTP only, default: true) */
  discovery?: boolean;
  port?: number;
  cors?: any;
  /** Enable request/response logging (HTTP only, default: false) */
  logging?: boolean;
  /**
   * Maximum number of items to collect from async generators (HTTP only, default: 10000).
   * HTTP transport doesn't support true streaming, so async generators are collected into arrays.
   * This limit prevents memory exhaustion attacks from unbounded generators.
   * When exceeded, throws a TitanError with code PAYLOAD_TOO_LARGE.
   */
  maxAsyncGeneratorItems?: number;
  /**
   * URL path prefix for all Netron endpoints (HTTP/WebSocket only).
   * Useful when running behind a reverse proxy that routes based on path.
   *
   * @example
   * // Server running at /api/v1
   * pathPrefix: 'api/v1'
   * // Endpoints become: /api/v1/netron/invoke, /api/v1/health, etc.
   *
   * @example
   * // Client connecting through proxy
   * pathPrefix: 'services/rpc'
   * // Client requests: /services/rpc/netron/invoke
   *
   * @note The pathPrefix should NOT have leading or trailing slashes.
   *       The code normalizes any format, but the canonical form is without slashes.
   */
  pathPrefix?: string;

  /**
   * Wraps each service method invocation.
   * Use for AsyncLocalStorage contexts (e.g., RLS, tracing, auth context).
   *
   * The wrapper receives the middleware metadata (which includes authContext
   * after JWT validation) and a function to execute the actual handler.
   *
   * @example
   * ```typescript
   * // Wrap every invocation in RLS context
   * invocationWrapper: async (metadata, fn) => {
   *   const authContext = metadata.get('authContext');
   *   if (authContext) {
   *     return withAuthRLSContext(authContext, fn);
   *   }
   *   return fn();
   * }
   * ```
   */
  invocationWrapper?: (metadata: Map<string, unknown>, fn: () => Promise<unknown>) => Promise<unknown>;

  /**
   * Maximum request size (HTTP only).
   * Accepts human-readable strings like '10mb', '1gb'.
   */
  maxRequestSize?: string;

  /**
   * Keep-alive timeout in milliseconds (HTTP only).
   */
  keepAliveTimeout?: number;

  /**
   * Headers timeout in milliseconds (HTTP only).
   */
  headersTimeout?: number;

  /**
   * Custom HTTP routes handled before Netron RPC routing (HTTP only).
   * Each handler receives the raw Request and returns a Response, or null to skip.
   *
   * @example
   * ```typescript
   * customRoutes: [
   *   async (request) => {
   *     const url = new URL(request.url);
   *     if (url.pathname.startsWith('/object/')) {
   *       return new Response(body, { headers: { 'Content-Type': 'image/png' } });
   *     }
   *     return null; // not handled, continue to next route
   *   }
   * ]
   * ```
   */
  customRoutes?: Array<(request: Request) => Promise<Response | null>>;
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
  ERROR = 'error',
}

/**
 * Connection events
 */
export interface ConnectionEvents {
  connect: () => void;
  disconnect: (reason?: string) => void;
  error: (error: Error) => void;
  data: (data: Buffer | ArrayBuffer) => void;
  packet: (packet: Packet) => void;
  state: (state: ConnectionState) => void;
  reconnect: (attempt: number) => void;
  reconnect_failed: () => void;
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

  /** Ping the connection and return round-trip time in milliseconds */
  ping(): Promise<number>;

  /** Get connection metrics */
  getMetrics?(): ConnectionMetrics;
}

/**
 * Server events
 */
export interface ServerEvents {
  connection: (connection: ITransportConnection) => void;
  error: (error: Error) => void;
  listening: () => void;
  close: () => void;
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

/**
 * Rate limiting configuration for HTTP server
 */
export interface RateLimitConfig {
  /** Enable rate limiting (default: false) */
  enabled?: boolean;
  /** Time window in milliseconds (default: 60000 = 1 minute) */
  windowMs?: number;
  /** Maximum requests per client per window (default: 100) */
  maxRequests?: number;
  /** Maximum global requests per window across all clients (default: 10000) */
  globalMaxRequests?: number;
  /** Custom key generator function to identify clients (default: uses X-Forwarded-For or remote IP) */
  keyGenerator?: (request: Request) => string;
  /** Skip rate limiting for successful requests (default: false) */
  skipSuccessfulRequests?: boolean;
  /** Skip rate limiting for failed requests (default: false) */
  skipFailedRequests?: boolean;
  /** Custom message for rate limit responses */
  message?: string;
  /** List of IPs or patterns to skip rate limiting (e.g., ['127.0.0.1', '::1']) */
  whitelist?: string[];
  /** Headers to use for client identification (default: ['X-Forwarded-For', 'X-Real-IP']) */
  trustProxy?: boolean;
}
