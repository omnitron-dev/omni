/**
 * Type definitions for Netron Browser Client
 */

/**
 * Netron protocol version
 */
export const NETRON_VERSION = '2.0';

/**
 * Transport type
 */
export type TransportType = 'http' | 'websocket';

/**
 * Client configuration options
 */
export interface NetronClientOptions {
  /**
   * Base URL for the Netron server
   */
  url: string;

  /**
   * Transport type (http or websocket)
   * @default 'http'
   */
  transport?: TransportType;

  /**
   * Request timeout in milliseconds
   * @default 30000
   */
  timeout?: number;

  /**
   * Custom headers to include in requests
   */
  headers?: Record<string, string>;

  /**
   * WebSocket-specific options
   */
  websocket?: {
    /**
     * WebSocket protocols
     */
    protocols?: string | string[];

    /**
     * Enable automatic reconnection
     * @default true
     */
    reconnect?: boolean;

    /**
     * Reconnection interval in milliseconds
     * @default 1000
     */
    reconnectInterval?: number;

    /**
     * Maximum reconnection attempts
     * @default Infinity
     */
    maxReconnectAttempts?: number;
  };

  /**
   * HTTP-specific options
   */
  http?: {
    /**
     * Enable request batching
     * @default false
     */
    batching?: boolean;

    /**
     * Enable request caching
     * @default false
     */
    caching?: boolean;

    /**
     * Cache TTL in milliseconds
     * @default 60000
     */
    cacheTTL?: number;

    /**
     * Enable retry mechanism
     * @default false
     */
    retry?: boolean;

    /**
     * Maximum retry attempts
     * @default 3
     */
    maxRetries?: number;
  };
}

/**
 * Request context for HTTP requests
 */
export interface RequestContext {
  /**
   * User ID or identifier
   */
  userId?: string;

  /**
   * Session ID
   */
  sessionId?: string;

  /**
   * Request ID for tracing
   */
  requestId?: string;

  /**
   * Request headers
   */
  headers?: Record<string, string>;

  /**
   * Custom metadata
   */
  metadata?: Record<string, any>;
}

/**
 * Request hints for optimization
 */
export interface RequestHints {
  /**
   * Request timeout override
   */
  timeout?: number;

  /**
   * Enable caching for this request
   */
  cacheable?: boolean;

  /**
   * Request priority (higher = more important)
   */
  priority?: number;

  /**
   * Enable batching for this request
   */
  batchable?: boolean;
}

/**
 * HTTP request message
 */
export interface HttpRequestMessage {
  /**
   * Message ID
   */
  id: string;

  /**
   * Protocol version
   */
  version: string;

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Service name
   */
  service: string;

  /**
   * Method name
   */
  method: string;

  /**
   * Method input (can be any value - the server expects an array)
   */
  input: any;

  /**
   * Request context
   */
  context?: RequestContext;

  /**
   * Request hints
   */
  hints?: RequestHints;
}

/**
 * HTTP response message
 */
export interface HttpResponseMessage {
  /**
   * Message ID (matches request ID)
   */
  id: string;

  /**
   * Protocol version
   */
  version: string;

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Success flag
   */
  success: boolean;

  /**
   * Response data (if successful)
   */
  data?: any;

  /**
   * Error information (if failed)
   */
  error?: {
    /**
     * Error code
     */
    code: string;

    /**
     * Error message
     */
    message: string;

    /**
     * Error details
     */
    details?: any;

    /**
     * Stack trace (development only)
     */
    stack?: string;
  };
}

/**
 * WebSocket packet types
 */
export enum PacketType {
  REQUEST = 1,
  RESPONSE = 2,
  ERROR = 3,
  PING = 4,
  PONG = 5,
  STREAM_DATA = 6,
  STREAM_END = 7,
  STREAM_ERROR = 8,
}

/**
 * WebSocket packet
 */
export interface Packet {
  /**
   * Packet type
   */
  type: PacketType;

  /**
   * Packet ID
   */
  id: string;

  /**
   * Packet payload
   */
  payload?: any;
}

/**
 * Connection state
 */
export enum ConnectionState {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  RECONNECTING = 'reconnecting',
  FAILED = 'failed',
}

/**
 * Connection metrics
 */
export interface ConnectionMetrics {
  /**
   * Connection ID
   */
  id: string;

  /**
   * Base URL
   */
  url: string;

  /**
   * Connection state
   */
  state: ConnectionState;

  /**
   * Transport type
   */
  transport: TransportType;

  /**
   * Connected timestamp
   */
  connectedAt?: number;

  /**
   * Disconnected timestamp
   */
  disconnectedAt?: number;

  /**
   * Total requests sent
   */
  requestsSent: number;

  /**
   * Total responses received
   */
  responsesReceived: number;

  /**
   * Total errors
   */
  errors: number;

  /**
   * Average latency in milliseconds
   */
  avgLatency?: number;
}

/**
 * Service method descriptor
 */
export interface MethodDescriptor {
  /**
   * Method name
   */
  name: string;

  /**
   * Method parameters
   */
  parameters: ParameterDescriptor[];

  /**
   * Return type
   */
  returnType: string;

  /**
   * Whether method is async
   */
  isAsync: boolean;

  /**
   * Whether method is a stream
   */
  isStream: boolean;
}

/**
 * Parameter descriptor
 */
export interface ParameterDescriptor {
  /**
   * Parameter name
   */
  name: string;

  /**
   * Parameter type
   */
  type: string;

  /**
   * Whether parameter is optional
   */
  optional: boolean;
}

/**
 * Service descriptor
 */
export interface ServiceDescriptor {
  /**
   * Service name
   */
  name: string;

  /**
   * Service version
   */
  version: string;

  /**
   * Service methods
   */
  methods: Record<string, MethodDescriptor>;
}
