import semver from 'semver';

import { Netron } from './netron.js';
import { Interface } from './interface.js';
import { Definition } from './definition.js';
import { isServiceInterface } from './predicates.js';
import { Abilities, EventSubscriber } from './types.js';

/**
 * Abstract base class representing a peer in the Netron network.
 * Provides core functionality for service discovery, interface management,
 * and communication between peers.
 *
 * @abstract
 */
export abstract class AbstractPeer {
  /**
   * Collection of abilities supported by this peer.
   * Abilities represent the capabilities and features that this peer can provide.
   */
  public abilities: Abilities = {};

  /**
   * Internal map storing interface instances and their reference counts.
   * Key is the definition ID, value contains the interface instance and its reference count.
   * Used for managing interface lifecycle and preventing memory leaks.
   */
  protected interfaces = new Map<string, { instance: Interface; refCount: number }>();

  /**
   * Constructs a new AbstractPeer instance.
   *
   * @param {Netron} netron - The Netron instance this peer belongs to
   * @param {string} id - Unique identifier for this peer
   */
  constructor(
    public netron: Netron,
    public id: string
  ) { }

  /**
   * Sets a property value or calls a method on the remote peer.
   *
   * @param {string} defId - Unique identifier of the definition context
   * @param {string} name - Name of the property or method
   * @param {any} value - Value to set or arguments for method call
   * @returns {Promise<void>} Resolves when operation completes
   * @abstract
   */
  abstract set(defId: string, name: string, value: any): Promise<void>;

  /**
   * Retrieves a property value or calls a method on the remote peer.
   *
   * @param {string} defId - Unique identifier of the definition context
   * @param {string} name - Name of the property or method
   * @returns {Promise<any>} Resolves with the property value or method result
   * @abstract
   */
  abstract get(defId: string, name: string): Promise<any>;

  /**
   * Invokes a method on the remote peer with specified arguments.
   *
   * @param {string} defId - Unique identifier of the definition context
   * @param {string} method - Name of the method to invoke
   * @param {any[]} args - Array of arguments to pass to the method
   * @returns {Promise<any>} Resolves with the method's return value
   * @abstract
   */
  abstract call(defId: string, method: string, args: any[]): Promise<any>;

  /**
   * Subscribes to an event emitted by the remote peer.
   *
   * @param {string} eventName - Name of the event to subscribe to
   * @param {EventSubscriber} handler - Function to handle event notifications
   * @returns {Promise<void> | void} Resolves when subscription is complete
   * @abstract
   */
  abstract subscribe(eventName: string, handler: EventSubscriber): Promise<void> | void;

  /**
   * Unsubscribes from a previously subscribed event.
   *
   * @param {string} eventName - Name of the event to unsubscribe from
   * @param {EventSubscriber} handler - Handler function to remove
   * @returns {Promise<void> | void} Resolves when unsubscription is complete
   * @abstract
   */
  abstract unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> | void;

  /**
   * Exposes a service instance to be accessible by other peers.
   *
   * @param {any} instance - The service instance to expose
   * @returns {Promise<Definition>} Resolves with the service definition
   * @abstract
   */
  abstract exposeService(instance: any): Promise<Definition>;

  /**
   * Removes a previously exposed service from accessibility.
   *
   * @param {string} ctxId - Context identifier of the service to unexpose
   * @param {boolean} [releaseOriginated] - Whether to release originated services
   * @returns {Promise<void>} Resolves when service is unexposed
   * @abstract
   */
  abstract unexposeService(ctxId: string, releaseOriginated?: boolean): Promise<void>;

  /**
   * Removes all services exposed by this peer.
   * Iterates through all service names and unexposes each one.
   */
  unexposeAllServices() {
    for (const ctxId of this.getServiceNames()) {
      this.unexposeService(ctxId);
    }
  }

  /**
   * Retrieves names of all services currently exposed by this peer.
   *
   * @returns {string[]} Array of service names
   * @abstract
   */
  abstract getServiceNames(): string[];

  /**
   * Queries and retrieves an interface for a specified service.
   * Handles version resolution and interface creation.
   *
   * @template T - Type of the interface to return
   * @param {string} qualifiedName - Service name with optional version (name@version)
   * @returns {Promise<T>} Resolves with the requested interface instance
   */
  async queryInterface<T>(qualifiedName: string): Promise<T> {
    let name: string;
    let version: string | undefined;

    if (qualifiedName.includes('@')) {
      [name, version] = qualifiedName.split('@') as [string, string | undefined];
    } else {
      name = qualifiedName;
      version = '*';
    }

    let def: Definition;

    if (version === '*' || !version) {
      def = this.findLatestServiceVersion(name);
    } else {
      const exactKey = `${name}@${version}`;
      def = this.getDefinitionByServiceName(exactKey);
    }

    return this.queryInterfaceByDefId(def.id, def);
  }

  /**
   * Retrieves an interface instance by its definition ID.
   * Manages interface caching and reference counting.
   *
   * @template T - Type of the interface to return
   * @param {string} defId - Definition ID of the interface
   * @param {Definition} [def] - Optional pre-fetched definition
   * @returns {T} The interface instance
   */
  queryInterfaceByDefId<T>(defId: string, def?: Definition): T {
    if (!def) {
      def = this.getDefinitionById(defId);
    }

    let iInfo = this.interfaces.get(defId);
    if (iInfo !== void 0) {
      iInfo.refCount++;
      return iInfo.instance as T;
    }

    const instance = Interface.create(def, this);
    iInfo = { instance, refCount: 1 };
    this.interfaces.set(def.id, iInfo);
    return instance as T;
  }

  /**
   * Releases a previously queried interface.
   * Handles reference counting and cleanup of dependent interfaces.
   *
   * @template T - Type of the interface to release
   * @param {T} iInstance - Interface instance to release
   * @param {Set<string>} [released] - Set of already released definition IDs
   * @returns {Promise<void>} Resolves when interface is released
   * @throws {Error} If interface is invalid or not found
   */
  async releaseInterface<T>(iInstance: T, released = new Set<string>()) {
    if (!isServiceInterface(iInstance) || !iInstance.$def) {
      throw new Error('Invalid interface');
    }

    const defId = iInstance.$def.id;
    if (released.has(defId)) return;
    released.add(defId);

    const iInfo = this.interfaces.get(defId);
    if (!iInfo) {
      throw new Error('Invalid interface');
    }

    iInfo.refCount--;
    if (iInfo.refCount === 0) {
      this.interfaces.delete(defId);

      for (const i of this.interfaces.values()) {
        if (i.instance.$def?.parentId === defId) {
          this.releaseInterface(i.instance);
        }
      }

      await this.releaseInterfaceInternal(iInstance);
      iInstance.$def = undefined;
      iInstance.$peer = undefined;
    }
  }

  /**
   * Internal method to handle interface release.
   *
   * @param {any} iInstance - Interface instance to release
   * @returns {Promise<void>} Resolves when internal release is complete
   * @abstract
   */
  protected abstract releaseInterfaceInternal(iInstance: any): Promise<void>;

  /**
   * Retrieves a definition by its unique identifier.
   *
   * @param {string} defId - Definition ID to look up
   * @returns {Definition} The definition object
   * @abstract
   */
  protected abstract getDefinitionById(defId: string): Definition;

  /**
   * Retrieves a definition by its service name.
   *
   * @param {string} name - Service name to look up
   * @returns {Definition} The definition object
   * @abstract
   */
  protected abstract getDefinitionByServiceName(name: string): Definition;

  /**
   * Finds the latest version of a service by its name.
   * This method implements a sophisticated version resolution strategy that:
   * 1. First attempts to find an exact match without version specification
   * 2. If that fails, searches for all versions of the service and returns the latest one
   *
   * @param {string} serviceName - The name of the service to find. Can be either:
   *                              - A simple name (e.g., 'auth')
   *                              - A name with version (e.g., 'auth@1.0.0')
   * @returns {Definition} The Definition object representing the latest version of the service
   * @throws {Error} If no matching service is found
   *
   * @example
   * // Returns the latest version of the 'auth' service
   * const latestAuth = findLatestServiceVersion('auth');
   *
   * @example
   * // Returns the latest version of the 'auth' service
   * const latestAuth = findLatestServiceVersion('auth@1.0.0');
   */
  protected findLatestServiceVersion(serviceName: string): Definition {
    // First, try to find an exact match without version specification
    // This handles cases where the service name is provided without a version
    if (!serviceName.includes('@')) {
      try {
        return this.getDefinitionByServiceName(serviceName);
      } catch {
        // If no exact match is found, proceed to version resolution
      }
    }

    // Create a regex pattern to match service names with versions
    // The pattern captures the version number in a group
    const regex = new RegExp(`^${serviceName}@([^@]+)$`);

    // Process all available service names to find matching versions
    const candidates = Array.from(this.getServiceNames())
      // Map each service name to a version-info object if it matches the pattern
      .map((key) => {
        const match = key.match(regex);
        if (match) return { version: match[1], key };
        return null;
      })
      // Filter out non-matching services and ensure type safety
      .filter((x): x is { version: string; key: string } => x !== null)
      // Sort versions in descending order using semver comparison
      .sort((a, b) => semver.rcompare(a.version, b.version));

    // If no matching versions were found, throw an error
    if (candidates.length === 0) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    // Return the definition for the highest version found
    return this.getDefinitionByServiceName(candidates[0]!.key);
  }
}
