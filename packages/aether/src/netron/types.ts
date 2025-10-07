/**
 * Netron types and interfaces
 * This file contains all type definitions for the Netron package
 */

import type { ILogger } from './logger.js';
import type { ITransportServer, ITransportConnection } from './transport/types.js';
import { Definition } from './definition.js';

/**
 * Transport configuration for Netron instance or service.
 * Specifies which transport(s) to use and their options.
 */
export type TransportConfig = {
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
    [key: string]: any;
  };
};

/**
 * Configuration options for creating a Netron instance.
 * These options control various aspects of the Netron instance's behavior.
 */
export type NetronOptions = {
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
   * This applies to all streams regardless of transport type.
   */
  streamTimeout?: number;

  /**
   * Optional context for the logger.
   * This can be used to add additional context to the logs.
   *
   * @type {Record<string, any>}
   */
  loggerContext?: Record<string, any>;

};

/**
 * Type definition for event subscriber functions.
 * These functions are called when events are emitted.
 */
export type EventSubscriber = (...args: any[]) => void;

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

  /**
   * Optional array of transport names that this method is available on.
   * If not specified or empty, the method is available on all transports.
   *
   * @example
   * transports: ['ws', 'tcp'] // Method only available via WebSocket and TCP
   * transports: undefined      // Method available on all transports (default)
   */
  transports?: string[];
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
 * This metadata describes the service's name, version, properties, methods, and transports.
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

  /**
   * Transports this service should be exposed on.
   * If not specified, service will be exposed on all registered transports.
   * If specified, service will only be exposed on the listed transports.
   */
  transports?: string[];
}

/**
 * Event type emitted when a service is exposed.
 * Contains information about the exposed service and the peers involved.
 */
export type ServiceExposeEvent = {
  /**
   * The name of the exposed service.
   */
  name: string;

  /**
   * The version of the exposed service.
   */
  version: string;

  /**
   * The qualified name of the service (name:version).
   */
  qualifiedName: string;

  /**
   * The ID of the peer exposing the service.
   */
  peerId: string;

  /**
   * The ID of the remote peer, if applicable.
   */
  remotePeerId?: string;

  /**
   * The service definition object.
   */
  definition: Definition;
};

/**
 * Event type emitted when a service is unexposed.
 * Contains information about the unexposed service and the peers involved.
 */
export type ServiceUnexposeEvent = {
  /**
   * The name of the unexposed service.
   */
  name: string;

  /**
   * The version of the unexposed service.
   */
  version: string;

  /**
   * The qualified name of the service (name:version).
   */
  qualifiedName: string;

  /**
   * The ID of the peer unexposing the service.
   */
  peerId: string;

  /**
   * The ID of the remote peer, if applicable.
   */
  remotePeerId?: string;

  /**
   * The ID of the service definition.
   */
  defId: string;
};

/**
 * Event type emitted when a peer connects.
 * Contains information about the connected peer.
 */
export type PeerConnectEvent = {
  /**
   * The ID of the connected peer.
   */
  peerId: string;
};

/**
 * Event type emitted when a peer disconnects.
 * Contains information about the disconnected peer.
 */
export type PeerDisconnectEvent = {
  /**
   * The ID of the disconnected peer.
   */
  peerId: string;
};

/**
 * Core Netron interface without implementation details
 * Used to break circular dependency between Netron and AbstractPeer
 */
export interface INetron {
  /** Unique identifier for this Netron instance */
  readonly uuid: string;

  /** Logger instance */
  readonly logger: ILogger;

  /** Configuration options */
  readonly options?: NetronOptions;

  /** Services map */
  services: Map<string, any>;

  /** Local peer instance */
  peer: ILocalPeer;

  /** Remote peers map */
  peers: Map<string, any>;

  /**
   * Transport servers map (one per registered transport)
   * Key: transport name, Value: transport server instance
   */
  transportServers: Map<string, ITransportServer>;

  /**
   * Legacy property for backward compatibility
   * Returns the first transport server or undefined
   * @deprecated Use transportServers map instead
   */
  transportServer?: ITransportServer;

  /** Get local peer */
  getLocalPeer(): ILocalPeer;

  /** Find peer by ID */
  findPeer(peerId: string): IPeer | undefined;

  /** Track task execution */
  trackTask(task: any): Promise<any>;

  /** Run task */
  runTask?(peer: any, name: string, ...args: any[]): Promise<any>;

  /** Emit special event */
  emitSpecial(eventId: string, eventName: string, data?: any): void;

  /** Get service names */
  getServiceNames(): string[];

  /** Emit event */
  emit(event: string | symbol, ...args: any[]): boolean;

  /** Add event listener */
  on(event: string | symbol, handler: (...args: any[]) => void): this;

  /** Remove event listener */
  off(event: string | symbol, handler: (...args: any[]) => void): this;

  /** Remove event listener (alias) */
  removeListener(event: string | symbol, handler: (...args: any[]) => void): this;

  /** Get event name for peer events */
  getPeerEventName?(peerId: string, event: string): string;
}

/**
 * Core peer interface
 */
export interface IPeer {
  /** Peer identifier */
  id: string;

  /** Associated Netron instance */
  netron: INetron;

  /** Query serivce interface by name */
  queryInterface<T = any>(name: string | T, version?: string): Promise<T>;

  /** Subscribe to events */
  subscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Unsubscribe from events */
  unsubscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Emit events */
  emit?(event: string, data?: any): Promise<void>;

  /** Close peer connection */
  close?(): Promise<void>;

  /** Set property or call method */
  set(defId: string, name: string, value: any): Promise<void>;

  /** Get property value */
  get(defId: string, name: string): Promise<any>;

  /** Call method with arguments */
  call(defId: string, name: string, args: any[]): Promise<any>;
}

/**
 * Local peer interface
 */
export interface ILocalPeer extends IPeer {
  /** Logger instance */
  logger: ILogger;

  /** Map of service stubs */
  stubs: Map<string, any>;

  /** Map of service instances */
  serviceInstances: Map<any, any>;

  /** Expose a service instance */
  expose(service: any, name?: string): Promise<void>;

  /** Unexpose a service */
  unexpose(service: any, name?: string): Promise<void>;

  /** Expose remote service - LocalPeer specific method */
  exposeRemoteService(peer: any, meta: any): any;

  /** Unexpose remote service - LocalPeer specific method */
  unexposeRemoteService(peer: any, serviceName: string): void;

  /** Reference a service */
  refService(instance: any, parentDef: any): any;

  /** Unref service */
  unrefService(defId?: string): void;

  /** Get stub by definition ID */
  getStubByDefinitionId(defId: string): any;

  /** Query interface by definition ID */
  queryInterfaceByDefId<T = any>(defId: string, def?: any): T;
}

/**
 * Remote peer interface
 */
export interface IRemotePeer extends IPeer {
  /** Connection to remote peer */
  connection?: ITransportConnection;

  /** Connect to remote peer */
  connect?(): Promise<void>;

  /** Check if connected */
  isConnected?(): boolean;
}
