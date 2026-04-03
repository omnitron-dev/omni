/**
 * Core type definitions for Netron framework.
 * This file contains pure type definitions with NO class imports to prevent circular dependencies.
 *
 * @internal
 * @since 0.5.0
 */

import type { ILogger } from '../../types/logger.js';

// ============================================================================
// Service Metadata Types (Pure types, no class dependencies)
// ============================================================================

/**
 * Interface representing information about a method argument.
 * This metadata is used for type checking and documentation.
 */
export interface ArgumentInfo {
  /**
   * The zero-based index of the argument in the method signature.
   */
  index: number;

  /**
   * The type of the argument as a string.
   * This can be a primitive type, class name, or interface name.
   */
  type: string;
}

/**
 * Interface representing information about a method.
 * This metadata describes the method's return type and arguments.
 */
export interface MethodInfo {
  /**
   * The return type of the method as a string.
   * This can be a primitive type, class name, or interface name.
   */
  type: string;

  /**
   * Array of argument information objects.
   * Each object describes an argument's position and type.
   */
  arguments: ArgumentInfo[];
}

/**
 * Interface representing information about a property.
 * This metadata describes the property's type and mutability.
 */
export interface PropertyInfo {
  /**
   * The type of the property as a string.
   * This can be a primitive type, class name, or interface name.
   */
  type: string;

  /**
   * Whether the property is read-only.
   * If true, attempts to modify the property will result in an error.
   */
  readonly: boolean;
}

/**
 * Interface representing metadata for a service.
 * This metadata describes the service's name, version, properties, and methods.
 */
export interface ServiceMetadata {
  /**
   * The name of the service.
   * Must be a valid identifier containing only alphanumeric characters and dots.
   */
  name: string;

  /**
   * The version of the service.
   * Must follow semantic versioning (semver) format if specified.
   */
  version: string;

  /**
   * Map of property names to their metadata.
   * Only public properties are included in this map.
   */
  properties: Record<string, PropertyInfo>;

  /**
   * Map of method names to their metadata.
   * Only public methods are included in this map.
   */
  methods: Record<string, MethodInfo>;
}

/**
 * Service contract type for validation.
 * Represents the expected interface of a service.
 */
export type ServiceContract = Record<string, unknown>;

/**
 * Extended metadata type that includes the service contract.
 * Used internally by service stubs.
 */
export interface ServiceMetadataWithContract extends ServiceMetadata {
  contract?: ServiceContract;
}

/**
 * Extended metadata type that includes transport configuration.
 * Used internally when services have transport associations.
 * @internal
 */
export interface ServiceMetadataExtended extends ServiceMetadataWithContract {
  transports?: string[];
  /** Internal transport storage */
  _transports?: string[];
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Type definition for event subscriber functions.
 * These functions are called when events are emitted.
 */
export type EventSubscriber = (...args: unknown[]) => void;

// ============================================================================
// Definition Interface (Pure interface, no class import)
// ============================================================================

/**
 * Interface representing a service definition.
 * This is a pure type interface to break circular dependencies.
 */
export interface IDefinition {
  /**
   * The identifier of the parent service definition, if this service is part of a hierarchy.
   */
  parentId: string;

  /**
   * Unique identifier for this service definition.
   */
  id: string;

  /**
   * The identifier of the peer that owns or provides this service.
   */
  peerId: string;

  /**
   * Detailed metadata describing the service's capabilities.
   */
  meta: ServiceMetadata;
}

// ============================================================================
// Transport Interfaces (Pure types)
// ============================================================================

/**
 * Interface for transport server instances.
 */
export interface ITransportServer {
  /** Listen for incoming connections */
  listen(): Promise<void>;
  /** Close the server */
  close(): Promise<void>;
  /** Add event listener */
  on(event: string, handler: (...args: unknown[]) => void): void;
  /** Remove event listener */
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

/**
 * Interface for transport connections.
 */
export interface ITransportConnection {
  /** Remote address of the connection */
  remoteAddress?: string;
  /** Send data through the connection */
  send(
    data: Buffer | ArrayBuffer | Uint8Array | string,
    options?: { binary?: boolean },
    callback?: (err?: Error) => void
  ): void;
  /** Close the connection */
  close(code?: number, reason?: string): Promise<void> | void;
  /** Add event listener */
  on(event: string, handler: (...args: unknown[]) => void): void;
  /** Add one-time event listener */
  once(event: string, handler: (...args: unknown[]) => void): void;
  /** Remove event listener */
  off?(event: string, handler: (...args: unknown[]) => void): void;
}

// ============================================================================
// Auth Context Interface (Forward declaration)
// ============================================================================

/**
 * Authentication context for a peer.
 * Forward declaration to avoid importing from auth module.
 */
export interface IAuthContext {
  /** User ID */
  userId: string;
  /** User roles */
  roles?: string[];
  /** User permissions */
  permissions?: string[];
  /** Additional claims */
  claims?: Record<string, unknown>;
}

// ============================================================================
// Authorization Manager Interface
// ============================================================================

/**
 * Interface for Authorization Manager used in INetron.
 * Defines the methods called by the netron core for access control.
 * @internal
 */
export interface IAuthorizationManager {
  /** Check if user can access a service */
  canAccessService(serviceName: string, auth?: IAuthContext): boolean;
  /** Filter a service definition based on user permissions */
  filterDefinition(serviceName: string, definition: ServiceMetadata, auth?: IAuthContext): ServiceMetadata | null;
}

// ============================================================================
// Peer Interfaces (Pure types, no class dependencies)
// ============================================================================

/**
 * Core peer interface.
 */
export interface IPeer {
  /** Peer identifier */
  id: string;

  /** Associated Netron instance */
  netron: INetron;

  /** Query service interface by name */
  queryInterface<T = unknown>(name: string | T, version?: string): Promise<T>;

  /** Subscribe to events */
  subscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Unsubscribe from events */
  unsubscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Emit events */
  emit?(event: string, data?: unknown): Promise<void>;

  /** Close peer connection */
  close?(): Promise<void>;

  /** Set property or call method */
  set(defId: string, name: string, value: unknown): Promise<void>;

  /** Get property value */
  get(defId: string, name: string): Promise<unknown>;

  /** Call method with arguments */
  call(defId: string, name: string, args: unknown[]): Promise<unknown>;
}

/**
 * Local peer interface.
 */
export interface ILocalPeer extends IPeer {
  /** Logger instance */
  logger: ILogger;

  /** Map of service stubs */
  stubs: Map<string, unknown>;

  /** Map of service instances */
  serviceInstances: Map<unknown, unknown>;

  /** Expose a service instance */
  expose(service: unknown, name?: string): Promise<void>;

  /** Unexpose a service */
  unexpose(service: unknown, name?: string): Promise<void>;

  /** Expose remote service - LocalPeer specific method */
  exposeRemoteService(peer: unknown, meta: unknown): unknown;

  /** Unexpose remote service - LocalPeer specific method */
  unexposeRemoteService(peer: unknown, serviceName: string): void;

  /** Reference a service */
  refService(instance: unknown, parentDef: unknown): unknown;

  /** Unref service */
  unrefService(defId?: string): void;

  /** Get stub by definition ID */
  getStubByDefinitionId(defId: string): unknown;

  /** Query interface by definition ID */
  queryInterfaceByDefId<T = unknown>(defId: string, def?: unknown): T;
}

/**
 * Remote peer interface.
 */
export interface IRemotePeer extends IPeer {
  /** Connection to remote peer */
  connection?: ITransportConnection;

  /** Connect to remote peer */
  connect?(): Promise<void>;

  /** Check if connected */
  isConnected?(): boolean;
}

// ============================================================================
// Netron Interface (Core interface)
// ============================================================================

/**
 * Core Netron interface without implementation details.
 * Used to break circular dependency between Netron and AbstractPeer.
 */
export interface INetron {
  /** Unique identifier for this Netron instance */
  readonly uuid: string;

  /** Logger instance */
  readonly logger: ILogger;

  /** Configuration options */
  readonly options?: INetronOptions;

  /** Services map */
  services: Map<string, unknown>;

  /** Local peer instance */
  peer: ILocalPeer;

  /** Remote peers map */
  peers: Map<string, unknown>;

  /**
   * Transport servers map (one per registered transport)
   * Key: transport name, Value: transport server instance
   */
  transportServers: Map<string, ITransportServer>;

  /**
   * Authorization manager for method-level access control.
   * Optional - only present when authorization is configured.
   * @internal
   */
  authorizationManager?: IAuthorizationManager;

  /** Get local peer */
  getLocalPeer(): ILocalPeer;

  /** Find peer by ID */
  findPeer(peerId: string): IPeer | undefined;

  /** Track task execution */
  trackTask(task: unknown): Promise<unknown>;

  /** Run task */
  runTask?(peer: unknown, name: string, ...args: unknown[]): Promise<unknown>;

  /** Emit special event */
  emitSpecial(eventId: string, eventName: string, data?: unknown): void;

  /** Get service names */
  getServiceNames(): string[];

  /** Emit event */
  emit(event: string | symbol, ...args: unknown[]): boolean;

  /** Add event listener */
  on(event: string | symbol, handler: (...args: unknown[]) => void): this;

  /** Remove event listener */
  off(event: string | symbol, handler: (...args: unknown[]) => void): this;

  /** Remove event listener (alias) */
  removeListener(event: string | symbol, handler: (...args: unknown[]) => void): this;

  /** Get event name for peer events */
  getPeerEventName?(peerId: string, event: string): string;
}

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Transport configuration for Netron instance or service.
 * Specifies which transport(s) to use and their options.
 */
export interface TransportConfig {
  /**
   * Transport name (e.g., 'ws', 'http', 'tcp', 'unix')
   */
  name: string;

  /**
   * Transport-specific options (host, port, path, etc.)
   */
  options?: {
    /** Host address to listen on */
    host?: string;
    /** Port number to listen on */
    port?: number;
    /** Unix socket path */
    path?: string;
    /** Additional transport-specific options */
    [key: string]: unknown;
  };
}

/**
 * Configuration options for creating a Netron instance.
 * These options control various aspects of the Netron instance's behavior.
 */
export interface INetronOptions {
  /**
   * Unique identifier for the Netron instance.
   * If not provided, a random UUID will be generated.
   */
  id?: string;

  /**
   * Timeout in milliseconds for task execution.
   * Defaults to 5000ms if not specified.
   */
  taskTimeout?: number;

  /**
   * Strategy for handling duplicate tasks.
   * - 'replace': Replace existing task with new one
   * - 'skip': Keep existing task and skip new one
   * - 'throw': Throw an error if task already exists
   */
  taskOverwriteStrategy?: 'replace' | 'skip' | 'throw';

  /**
   * Whether to enable service events.
   * When true, events will be emitted when services are exposed or unexposed.
   */
  allowServiceEvents?: boolean;

  /**
   * Stream inactivity timeout in milliseconds.
   * Streams that are inactive for this duration will be closed.
   * Defaults to 60000ms (60 seconds) if not specified.
   */
  streamTimeout?: number;

  /**
   * Optional context for the logger.
   */
  loggerContext?: Record<string, unknown>;

  // --- Connection Management Options ---

  /** Maximum connections allowed per peer. Default: 10 */
  maxConnectionsPerPeer?: number;

  /** Global maximum connections across all peers. Default: 100 */
  maxTotalConnections?: number;

  /** Default connection pool size per peer for reuse. Default: 3 */
  connectionPoolSize?: number;

  /** Idle connection timeout in milliseconds. Default: 30000 */
  idleConnectionTimeout?: number;

  /** Health check interval in milliseconds. Default: 15000 */
  healthCheckInterval?: number;

  /** Maximum missed heartbeats before marking connection unhealthy. Default: 3 */
  maxMissedHeartbeats?: number;

  /** Heartbeat timeout in milliseconds. Default: 5000 */
  heartbeatTimeout?: number;

  /** Reconnection configuration */
  reconnect?: {
    /** Enable automatic reconnection. Default: true */
    enabled?: boolean;
    /** Base delay for reconnection in milliseconds. Default: 1000 */
    baseDelay?: number;
    /** Maximum delay for reconnection in milliseconds. Default: 30000 */
    maxDelay?: number;
    /** Maximum reconnection attempts. 0 = unlimited. Default: 10 */
    maxAttempts?: number;
    /** Jitter factor for reconnection delays (0-1). Default: 0.3 */
    jitterFactor?: number;
  };

  /** Enable connection metrics collection. Default: true */
  enableConnectionMetrics?: boolean;

  /** Cleanup interval for expired/idle connections in milliseconds. Default: 10000 */
  connectionCleanupInterval?: number;
}

// ============================================================================
// Event Types
// ============================================================================

/**
 * Event type emitted when a service is exposed.
 * Contains information about the exposed service and the peers involved.
 */
export interface ServiceExposeEvent {
  /** The name of the exposed service. */
  name: string;
  /** The version of the exposed service. */
  version: string;
  /** The qualified name of the service (name:version). */
  qualifiedName: string;
  /** The ID of the peer exposing the service. */
  peerId: string;
  /** The ID of the remote peer, if applicable. */
  remotePeerId?: string;
  /** The service definition object. */
  definition: IDefinition;
}

/**
 * Event type emitted when a service is unexposed.
 * Contains information about the unexposed service and the peers involved.
 */
export interface ServiceUnexposeEvent {
  /** The name of the unexposed service. */
  name: string;
  /** The version of the unexposed service. */
  version: string;
  /** The qualified name of the service (name:version). */
  qualifiedName: string;
  /** The ID of the peer unexposing the service. */
  peerId: string;
  /** The ID of the remote peer, if applicable. */
  remotePeerId?: string;
  /** The ID of the service definition. */
  defId: string;
}

/**
 * Event type emitted when a peer connects.
 */
export interface PeerConnectEvent {
  /** The ID of the connected peer. */
  peerId: string;
}

/**
 * Event type emitted when a peer disconnects.
 */
export interface PeerDisconnectEvent {
  /** The ID of the disconnected peer. */
  peerId: string;
}

// ============================================================================
// Socket Interface
// ============================================================================

/**
 * Socket-like interface for RemotePeer.
 * Can be a WebSocket or a TransportConnectionAdapter.
 * This type documents the required interface for RemotePeer's socket parameter.
 */
export interface RemotePeerSocket {
  /** Current ready state of the socket (0=CONNECTING, 1=OPEN, 2=CLOSING, 3=CLOSED or string equivalents) */
  readyState: number | string;
  /** Constructor name for debugging */
  constructor?: { name?: string };
  /** Send data through the socket */
  send(
    data: Buffer | ArrayBuffer | Uint8Array | string,
    options?: { binary?: boolean },
    callback?: (err?: Error) => void
  ): void;
  /** Close the socket connection */
  close?(code?: number, reason?: string): void | Promise<void>;
  /** Add event listener */
  on(event: string, listener: (...args: any[]) => void): void;
  /** Add one-time event listener */
  once(event: string, listener: (...args: any[]) => void): void;
  /** Remove event listener */
  off?(event: string, listener: (...args: any[]) => void): void;
  /** Remove event listener (alias) */
  removeListener?(event: string, listener: (...args: any[]) => void): void;
}

// ============================================================================
// Extended Types
// ============================================================================

/**
 * Extended transport server interface with optional service registration capabilities.
 * Used by HTTP and other transports that support direct service registration.
 */
export interface ITransportServerWithServices extends ITransportServer {
  /**
   * Set the local peer for service invocation.
   * Called when the server is started to enable service method execution.
   */
  setPeer?(peer: ILocalPeer): void;

  /**
   * Register a service with the transport server.
   * @param name - Service name
   * @param definition - Service definition
   * @param contract - Optional service contract for validation
   */
  registerService?(name: string, definition: IDefinition, contract?: ServiceContract): void;

  /**
   * Unregister a service from the transport server.
   * @param serviceName - Service name to unregister
   */
  unregisterService?(serviceName: string): void;
}

/**
 * Extended NetronOptions with experimental HTTP direct mode flag.
 * @internal
 */
export interface NetronOptionsExtended extends INetronOptions {
  /**
   * Use direct HTTP implementation instead of WebSocket wrapper.
   * @experimental
   */
  useDirectHttp?: boolean;
}

// ============================================================================
// Stream Peer Interface (for breaking stream -> peer circular dependency)
// ============================================================================

/**
 * Interface for peer objects used by streams.
 * This minimal interface breaks the circular dependency between streams and peers.
 * @internal
 */
export interface IStreamPeer {
  /** Peer identifier */
  id: string;

  /** Logger instance */
  logger: {
    info(msg: Record<string, unknown> | string, ...args: unknown[]): void;
    warn(msg: Record<string, unknown> | string, ...args: unknown[]): void;
    error(msg: Record<string, unknown> | string, ...args: unknown[]): void;
    debug(msg: Record<string, unknown> | string, ...args: unknown[]): void;
  };

  /** Associated Netron instance */
  netron: {
    options?: {
      streamTimeout?: number;
    };
  };

  /** Map of readable streams */
  readableStreams: Map<number, unknown>;

  /** Map of writable streams */
  writableStreams: Map<number, unknown>;

  /** Send a stream chunk to the peer */
  sendStreamChunk(streamId: number, chunk: unknown, index: number, isLast: boolean, isLive: boolean): Promise<void>;

  /** Send a packet to the peer */
  sendPacket(packet: unknown): Promise<void>;
}
