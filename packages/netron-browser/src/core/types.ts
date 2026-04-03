/**
 * Browser-compatible Netron types
 * Simplified version without server-specific dependencies
 */

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
 * Core peer interface for browser client
 */
export interface IPeer {
  /** Peer identifier */
  id: string;

  /** Query service interface by name */
  queryInterface<T = any>(name: string | T, version?: string): Promise<T>;

  /** Subscribe to events */
  subscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Unsubscribe from events */
  unsubscribe(event: string, handler: EventSubscriber): Promise<void> | void;

  /** Set property or call method */
  set(defId: string, name: string, value: any): Promise<void>;

  /** Get property value */
  get(defId: string, name: string): Promise<any>;

  /** Call method with arguments */
  call(defId: string, name: string, args: any[]): Promise<any>;

  /** Release interface */
  releaseInterface?<T>(iInstance: T, released?: Set<string>): Promise<void>;
}
