import { LoggerOptions, DestinationStream } from 'pino';

import { Definition } from './definition';

/**
 * Represents the capabilities and configuration of a remote peer.
 * This type defines what services and features are available on a remote peer.
 */
export type Abilities = {
  /**
   * Map of service names to their definitions that are exposed by the remote peer.
   * The key is the qualified service name (name:version) and the value is the service definition.
   */
  services?: Map<string, Definition>;

  /**
   * Indicates whether the remote peer should subscribe to service events.
   * When true, the peer will receive notifications about service exposure and unexposure.
   */
  allowServiceEvents?: boolean;
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
   * Host address to listen on for incoming connections (server only).
   * Defaults to 'localhost' if not specified.
   */
  listenHost?: string;

  /**
   * Port number to listen on for incoming connections (server only).
   * Required for server mode.
   */
  listenPort?: number;

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
   * Timeout in milliseconds for establishing connections.
   * Defaults to 5000ms if not specified.
   */
  connectTimeout?: number;

  /**
   * Timeout in milliseconds for request operations.
   * Defaults to 5000ms if not specified.
   */
  requestTimeout?: number;

  /**
   * Timeout in milliseconds for stream operations.
   * Defaults to 5000ms if not specified.
   */
  streamTimeout?: number;

  /**
   * Whether to enable service events.
   * When true, events will be emitted when services are exposed or unexposed.
   */
  allowServiceEvents?: boolean;

  /**
   * Maximum number of reconnection attempts.
   * If not set, unlimited reconnection attempts will be made.
   */
  maxReconnectAttempts?: number;

  /**
   * Enable service discovery via Redis
   */
  discoveryEnabled?: boolean;

  /**
   * Redis connection string for service discovery
   */
  discoveryRedisUrl?: string;

  /**
   * Interval (ms) between heartbeats for service discovery
   */
  discoveryHeartbeatInterval?: number;

  /**
   * TTL (ms) for heartbeat keys in Redis
   */
  discoveryHeartbeatTTL?: number;

  /**
   * Enables or disables Redis Pub/Sub functionality for service discovery events.
   * When enabled, the system will publish real-time notifications about:
   * - Node registration events
   * - Service availability changes
   * - Node health status updates
   * - Network topology changes
   * 
   * This feature is particularly useful for:
   * - Building reactive systems that need immediate awareness of service changes
   * - Implementing dynamic load balancing
   * - Creating real-time monitoring dashboards
   * - Enabling automatic failover mechanisms
   * 
   * @default true
   * @type {boolean}
   * @see DiscoveryOptions
   * @see ServiceDiscovery
   */
  discoveryPubSubEnabled?: boolean;

  /**
   * Optional logger configuration based on Pino LoggerOptions.
   * Allows customizing the logging behavior of the Netron instance.
   * 
   * @type {LoggerOptions}
   * @description Configuration options for the Pino logger instance.
   * This includes settings such as:
   * - Log level (debug, info, warn, error)
   * - Custom formatters for log messages
   * - Redaction of sensitive information
   * - Custom serializers for objects
   * - Timestamp formatting
   * - Additional context fields
   * 
   * @see https://getpino.io/#/docs/api?id=options
   * @example
   * {
   *   level: 'info',
   *   formatters: {
   *     level: (label) => ({ level: label })
   *   },
   *   redact: ['password', 'token']
   * }
   */
  loggerOptions?: LoggerOptions;

  /**
   * Optional destination stream for logger output.
   * If not provided, logs will be written to stdout by default.
   * 
   * @type {DestinationStream}
   * @description A writable stream that receives log messages.
   * This can be used to:
   * - Redirect logs to a file
   * - Send logs to a remote service
   * - Implement custom log processing
   * - Integrate with monitoring systems
   * 
   * @see https://getpino.io/#/docs/api?id=destination
   * @example
   * const fileStream = fs.createWriteStream('app.log');
   * const netron = new Netron({ loggerDestination: fileStream });
   */
  loggerDestination?: DestinationStream;

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
