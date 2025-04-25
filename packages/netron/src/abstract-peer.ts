import semver from 'semver';

import { Netron } from './netron';
import { Interface } from './interface';
import { Definition } from './definition';
import { isServiceInterface } from './predicates';
import { Abilities, EventSubscriber } from './types';

export abstract class AbstractPeer {
  public abilities: Abilities = {};

  // A map to store interfaces with their reference count, identified by a unique definition ID.
  protected interfaces = new Map<string, { instance: Interface; refCount: number }>();

  // Constructor to initialize the AbstractPeer with a Netron instance and a unique peer ID.
  constructor(
    public netron: Netron,
    public id: string
  ) { }

  /**
   * Abstract method to set a property value or call a method on the peer side.
   *
   * @param {string} defId - The unique definition ID associated with the context.
   * @param {string} name - The name of the property or method to be set or called.
   * @param {any} value - The value to set or the data to pass to the method.
   * @returns {Promise<void>} - A promise that resolves when the operation is complete.
   */
  abstract set(defId: string, name: string, value: any): Promise<void>;

  /**
   * Abstract method to get a property value or call a method on the peer side.
   *
   * @param {string} defId - The unique definition ID associated with the context.
   * @param {string} name - The name of the property or method to be retrieved or called.
   * @returns {Promise<any>} - A promise that resolves with the property value or method result.
   */
  abstract get(defId: string, name: string): Promise<any>;

  /**
   * Abstract method to call a method on the peer side, similar to get().
   *
   * @param {string} defId - The unique definition ID associated with the context.
   * @param {string} method - The name of the method to be called.
   * @param {any[]} args - The arguments to pass to the method.
   * @returns {Promise<any>} - A promise that resolves with the result of the method call.
   */
  abstract call(defId: string, method: string, args: any[]): Promise<any>;

  /**
   * Abstract method to subscribe to an event.
   *
   * @param {string} eventName - The name of the event to subscribe to.
   * @param {EventSubscriber} handler - The handler function to be called when the event occurs.
   * @returns {Promise<void> | void} - A promise that resolves when the subscription is complete, or void.
   */
  abstract subscribe(eventName: string, handler: EventSubscriber): Promise<void> | void;

  /**
   * Abstract method to unsubscribe from an event.
   *
   * @param {string} eventName - The name of the event to unsubscribe from.
   * @param {EventSubscriber} handler - The handler function to be removed.
   * @returns {Promise<void> | void} - A promise that resolves when the unsubscription is complete, or void.
   */
  abstract unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> | void;

  /**
   * Abstract method to expose a service to the peer.
   *
   * @param instance - The instance of the service to be exposed.
   * @returns {Promise<Definition>} - A promise that resolves with the definition of the exposed service.
   */
  abstract exposeService(instance: any): Promise<Definition>;

  /**
   * Abstract method to unexpose a previously exposed service.
   *
   * @param ctxId - The context identifier of the service to be unexposed.
   * @param releaseOriginated - Optional flag to indicate if originated services should be released.
   * @returns {Promise<void>} - A promise that resolves when the service is unexposed.
   */
  abstract unexposeService(ctxId: string, releaseOriginated?: boolean): Promise<void>;

  /**
   * Unexposes all services that have been exposed by this peer.
   */
  unexposeAllServices() {
    for (const ctxId of this.getServiceNames()) {
      this.unexposeService(ctxId);
    }
  }

  /**
   * Abstract method to get the names of all services exposed by this peer.
   *
   * @returns {string[]} - An array of service names.
   */
  abstract getServiceNames(): string[];

  /**
   * Queries an interface for a given service name.
   *
   * @param {string} qualifiedName - The name of the service to query.
   * @returns {Promise<T>} - A promise that resolves with the queried interface.
   */
  async queryInterface<T>(qualifiedName: string): Promise<T> {
    let name: string;
    let version: string | undefined;

    if (qualifiedName.includes(':')) {
      [name, version] = qualifiedName.split(':') as [string, string | undefined];
    } else {
      name = qualifiedName;
      version = '*';
    }

    let def: Definition;

    if (version === '*' || !version) {
      def = this.findLatestServiceVersion(name);
    } else {
      const exactKey = `${name}:${version}`;
      def = this.getDefinitionByServiceName(exactKey);
    }

    return this.queryInterfaceByDefId(def.id, def);
  }

  /**
   * Queries an interface by its definition ID.
   *
   * @param {string} defId - The definition ID of the interface to query.
   * @param {Definition} [def] - Optional definition object.
   * @returns {Promise<T>} - A promise that resolves with the queried interface.
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
   *
   * @param {T} iInstance - The interface instance to be released.
   * @returns {Promise<void>} - A promise that resolves when the interface is released.
   * @throws {Error} - Throws an error if the instance is not a valid service interface.
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
   * Abstract method to release an interface internally.
   *
   * @param iInstance - The interface instance to be released.
   * @returns {Promise<void>} - A promise that resolves when the internal release is complete.
   */
  protected abstract releaseInterfaceInternal(iInstance: any): Promise<void>;

  /**
   * Abstract method to get a definition by its ID.
   *
   * @param {number} defId - The ID of the definition to retrieve.
   * @returns {Definition} - The definition associated with the given ID.
   */
  protected abstract getDefinitionById(defId: string): Definition;

  /**
   * Abstract method to get a definition by its service name.
   *
   * @param {string} name - The name of the service.
   * @returns {Definition} - The definition associated with the given service name.
   */
  protected abstract getDefinitionByServiceName(name: string): Definition;

  protected findLatestServiceVersion(serviceName: string): Definition {
    // Check if the service exists without a version
    if (!serviceName.includes(':')) {
      try {
        return this.getDefinitionByServiceName(serviceName);
      } catch (_: any) {
        // If the service is not found, try to find the latest version
      }
    }

    const regex = new RegExp(`^${serviceName}:([^:]+)$`);
    const candidates = Array.from(this.getServiceNames())
      .map((key) => {
        const match = key.match(regex);
        if (match) return { version: match[1], key };
        return null;
      })
      .filter((x): x is { version: string, key: string } => x !== null)
      .sort((a, b) => semver.rcompare(a.version, b.version));

    if (candidates.length === 0) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    return this.getDefinitionByServiceName(candidates[0]!.key);
  }
}
