import semver from 'semver';

import type { INetron, IPeer } from './types.js';
import { Interface } from './interface.js';
import { Definition } from './definition.js';
import { EventSubscriber } from './types.js';
import { NetronErrors, Errors } from '../errors/index.js';

/**
 * Abstract base class representing a peer in the Netron network.
 * Provides core functionality for service discovery, interface management,
 * and communication between peers.
 *
 * @abstract
 */
export abstract class AbstractPeer implements IPeer {
  /**
   * Internal map storing interface instances and their reference counts.
   * Key is the definition ID, value contains the interface instance and its reference count.
   * Used for managing interface lifecycle and preventing memory leaks.
   */
  protected interfaces = new Map<string, { instance: Interface; refCount: number }>();

  /**
   * Cache of service definitions indexed by qualified service name (name@version).
   * This cache reduces network overhead by storing previously fetched definitions.
   * The cache can be manually invalidated using invalidateDefinitionCache().
   */
  protected definitionCache = new Map<string, Definition>();

  /**
   * Constructs a new AbstractPeer instance.
   *
   * @param {INetron} netron - The Netron instance this peer belongs to
   * @param {string} id - Unique identifier for this peer
   */
  constructor(
    public netron: INetron,
    public id: string
  ) {}

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
   * Queries the remote peer for a service definition.
   * This method must be implemented by subclasses to handle the actual
   * communication with the remote peer (e.g., via WebSocket task or HTTP request).
   *
   * @param {string} qualifiedName - Service name with version (name@version)
   * @returns {Promise<Definition>} Resolves with the service definition
   * @abstract
   * @protected
   */
  protected abstract queryInterfaceRemote(qualifiedName: string): Promise<Definition>;

  /**
   * Queries and retrieves an interface for a specified service.
   * Handles version resolution, caching, and interface creation.
   *
   * Flow:
   * 1. Parse service name and version
   * 2. Check definition cache
   * 3. If not cached, query remote peer via queryInterfaceRemote()
   * 4. Cache the definition
   * 5. Create and return interface
   *
   * @template T - Type of the interface to return
   * @param {string} qualifiedName - Service name with optional version (name@version)
   * @returns {Promise<T>} Resolves with the requested interface instance
   */
  async queryInterface<T>(qualifiedName: string): Promise<T> {
    let name: string;
    let version: string | undefined;

    // Parse service name and version
    if (qualifiedName.includes('@')) {
      [name, version] = qualifiedName.split('@') as [string, string | undefined];
    } else {
      name = qualifiedName;
      version = '*';
    }

    // Normalize the qualified name for caching
    const normalizedName = version === '*' || !version ? name : `${name}@${version}`;

    // Check definition cache first
    let def = this.definitionCache.get(normalizedName);

    // Verify cached definition still exists (could be deleted after releaseInterface)
    if (def) {
      try {
        this.getDefinitionById(def.id);
      } catch {
        // Definition was deleted, invalidate cache entry
        this.definitionCache.delete(normalizedName);
        def = undefined;
      }
    }

    if (!def) {
      // Not in cache or invalidated, query remote peer
      if (version === '*' || !version) {
        // For wildcard version, find latest locally or query remote
        try {
          def = this.findLatestServiceVersion(name);
        } catch {
          // If not found locally, query remote
          def = await this.queryInterfaceRemote(name);
        }
      } else {
        // For specific version, try local first then remote
        const exactKey = `${name}@${version}`;
        try {
          def = this.getDefinitionByServiceName(exactKey);
        } catch {
          // If not found locally, query remote
          def = await this.queryInterfaceRemote(exactKey);
        }
      }

      // Cache the definition
      this.definitionCache.set(normalizedName, def);
    }

    // Create and return interface
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
    // Duck-type check: any object with $def property is considered an interface
    // This supports both Interface and HttpInterface instances
    const hasDefProperty = iInstance && typeof iInstance === 'object' && '$def' in iInstance;
    if (!hasDefProperty || !(iInstance as any).$def) {
      throw Errors.badRequest('Invalid interface');
    }

    const defId = (iInstance as any).$def.id;
    if (released.has(defId)) return;
    released.add(defId);

    const iInfo = this.interfaces.get(defId);
    if (!iInfo) {
      throw Errors.badRequest('Invalid interface');
    }

    iInfo.refCount--;
    if (iInfo.refCount === 0) {
      this.interfaces.delete(defId);

      for (const i of this.interfaces.values()) {
        if ((i.instance as any).$def?.parentId === defId) {
          this.releaseInterface(i.instance);
        }
      }

      await this.releaseInterfaceInternal(iInstance);
      (iInstance as any).$def = undefined;
      (iInstance as any).$peer = undefined;
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
      throw NetronErrors.serviceNotFound(serviceName);
    }

    // Return the definition for the highest version found
    return this.getDefinitionByServiceName(candidates[0]!.key);
  }

  /**
   * Invalidates cached definitions matching the given pattern.
   * Supports wildcard patterns using * for matching multiple services.
   *
   * @param {string} [pattern] - Optional pattern to match service names.
   *                            If not provided, all cached definitions are invalidated.
   *                            Supports wildcard (*) for pattern matching.
   * @returns {number} The number of cache entries invalidated
   *
   * @example
   * // Invalidate specific service
   * peer.invalidateDefinitionCache('userService@1.0.0');
   *
   * @example
   * // Invalidate all services starting with "user"
   * peer.invalidateDefinitionCache('user*');
   *
   * @example
   * // Invalidate all cached definitions
   * peer.invalidateDefinitionCache();
   */
  invalidateDefinitionCache(pattern?: string): number {
    let invalidatedCount = 0;

    // If no pattern, clear entire cache
    if (pattern === undefined) {
      invalidatedCount = this.definitionCache.size;
      this.definitionCache.clear();
      return invalidatedCount;
    }

    // Pattern matching
    const keysToDelete: string[] = [];

    for (const key of this.definitionCache.keys()) {
      if (this.matchesPattern(key, pattern)) {
        keysToDelete.push(key);
      }
    }

    // Delete matched keys
    for (const key of keysToDelete) {
      this.definitionCache.delete(key);
      invalidatedCount++;
    }

    return invalidatedCount;
  }

  /**
   * Clears all cached service definitions.
   * This is equivalent to calling invalidateDefinitionCache() with no arguments.
   *
   * @returns {number} The number of cache entries cleared
   */
  clearDefinitionCache(): number {
    const count = this.definitionCache.size;
    this.definitionCache.clear();
    return count;
  }

  /**
   * Checks if a service name matches a pattern with wildcard support.
   *
   * @param {string} serviceName - The service name to check
   * @param {string} pattern - The pattern to match against (supports * wildcard)
   * @returns {boolean} True if the service name matches the pattern
   * @private
   */
  private matchesPattern(serviceName: string, pattern: string): boolean {
    // Exact match
    if (serviceName === pattern) {
      return true;
    }

    // No wildcards - no match
    if (!pattern.includes('*')) {
      return false;
    }

    // Convert pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars
      .replace(/\*/g, '.*'); // Replace * with .*

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(serviceName);
  }
}

/**
 * Checks if the given object is an instance of the AbstractPeer class.
 * This predicate is fundamental for peer type validation in the Netron
 * peer-to-peer communication system.
 *
 * @param {any} obj - The object to be checked for AbstractPeer instance membership
 * @returns {boolean} Returns true if the object is an AbstractPeer instance, false otherwise
 * @see AbstractPeer
 */
export const isNetronPeer = (obj: any): obj is AbstractPeer => obj instanceof AbstractPeer;
