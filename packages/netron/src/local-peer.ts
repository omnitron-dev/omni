import { Netron } from './netron';
import { Interface } from './interface';
import { Definition } from './definition';
import { RemotePeer } from './remote-peer';
import { ServiceStub } from './service-stub';
import { AbstractPeer } from './abstract-peer';
import { isServiceInterface, isServiceDefinition } from './predicates';
import { EventSubscriber, ServiceMetadata, ServiceExposeEvent } from './types';
import {
  getQualifiedName,
  getServiceMetadata,
  getServiceEventName,
} from './utils';
import {
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
} from './constants';

/**
 * LocalPeer class extends AbstractPeer and manages local services and their stubs.
 */
export class LocalPeer extends AbstractPeer {
  public stubs = new Map<string, ServiceStub>(); // map of definition id to stub
  public serviceInstances = new Map<InstanceType<any>, ServiceStub>();

  /**
   * Constructor for LocalPeer.
   * @param {Netron} netron - The Netron instance.
   */
  constructor(netron: Netron) {
    super(netron, netron.id);
    this.abilities = {
      allowServiceEvents: netron.options?.allowServiceEvents ?? false,
    };
  }

  /**
   * Exposes a local service instance.
   * @param {any} instance - The service instance to expose.
   * @returns {Promise<Definition>} - The definition of the exposed service.
   * @throws {Error} - If the service is invalid or already exposed.
   */
  async exposeService(instance: any): Promise<Definition> {
    const meta = getServiceMetadata(instance);
    if (!meta) {
      throw new Error('Invalid service');
    }

    const existingStub = this.serviceInstances.get(instance);
    if (existingStub) {
      throw new Error(`Service instance already exposed: ${meta.name}`);
    }

    const serviceKey = getQualifiedName(meta.name, meta.version);
    if (this.netron.services.has(serviceKey)) {
      throw new Error(`Service already exposed: ${serviceKey}`);
    }

    const stub = new ServiceStub(this, instance, meta);
    const def = stub.definition;

    this.stubs.set(def.id, stub);
    this.netron.services.set(serviceKey, stub);
    this.serviceInstances.set(instance, stub);

    this.netron.emitSpecial(NETRON_EVENT_SERVICE_EXPOSE, getServiceEventName(serviceKey), {
      name: def.meta.name,
      version: def.meta.version,
      qualifiedName: serviceKey,
      peerId: this.id,
      definition: def,
    } as ServiceExposeEvent);
    return def;
  }

  /**
   * Exposes a remote service.
   * @param {RemotePeer} peer - The remote peer.
   * @param {ServiceMetadata} meta - The metadata of the service.
   * @returns {Definition} - The definition of the exposed remote service.
   */
  exposeRemoteService(peer: RemotePeer, meta: ServiceMetadata) {
    const def = new Definition(Definition.nextId(), peer.id, meta);
    const iInstance = Interface.create(def, peer);
    const stub = new ServiceStub(this, iInstance, def);

    this.stubs.set(def.id, stub);
    this.netron.services.set(meta.name, stub);
    this.serviceInstances.set(iInstance, stub);
    peer.definitions.set(def.id, def);

    this.netron.emitSpecial(NETRON_EVENT_SERVICE_EXPOSE, getServiceEventName(def.meta.name), {
      name: def.meta.name,
      version: def.meta.version,
      qualifiedName: getQualifiedName(def.meta.name, def.meta.version),
      peerId: this.id,
      remotePeerId: peer.id,
      definition: def,
    } as ServiceExposeEvent);
    return def;
  }

  /**
   * Unexposes a local service by its name.
   * @param {string} serviceName - The name of the service to unexpose.
   * @returns {Promise<void>}
   */
  async unexposeService(serviceName: string) {
    const def = this.getDefinitionByServiceName(serviceName);
    const defId = def.id;
    for (const i of this.interfaces.values()) {
      if (i.instance.$def?.parentId === defId) {
        this.releaseInterface(i.instance);
      }
    }
    this.netron.services.delete(serviceName);
    const stub = this.stubs.get(defId);
    if (stub) {
      this.serviceInstances.delete(stub.instance);
      this.stubs.delete(defId);
    }

    this.netron.emitSpecial(NETRON_EVENT_SERVICE_UNEXPOSE, getServiceEventName(serviceName), {
      name: def.meta.name,
      version: def.meta.version,
      qualifiedName: serviceName,
      peerId: this.id,
      defId,
    });
  }

  /**
   * Unexposes a remote service by its name.
   * @param {RemotePeer} peer - The remote peer.
   * @param {string} serviceName - The name of the service to unexpose.
   * @returns {string} - The id of the unexposed service definition.
   */
  unexposeRemoteService(peer: RemotePeer, serviceName: string) {
    const def = this.getDefinitionByServiceName(serviceName);
    const defId = def.id;
    for (const i of this.interfaces.values()) {
      if (i.instance.$def?.parentId === defId) {
        this.releaseInterface(i.instance);
      }
    }
    peer.definitions.delete(defId);
    this.netron.services.delete(serviceName);
    const stub = this.stubs.get(defId);
    if (stub) {
      this.serviceInstances.delete(stub.instance);
      this.stubs.delete(defId);
    }

    this.netron.emitSpecial(NETRON_EVENT_SERVICE_UNEXPOSE, getServiceEventName(serviceName), {
      name: def.meta.name,
      version: def.meta.version,
      qualifiedName: serviceName,
      peerId: this.id,
      remotePeerId: peer.id,
      defId,
    });

    return def.id;
  }

  /**
   * Releases an interface internally.
   * @param {Interface} iInstance - The interface instance to release.
   * @returns {Promise<void>}
   */
  protected async releaseInterfaceInternal(iInstance: Interface): Promise<void> {
    this.unrefService(iInstance.$def?.id);
  }

  /**
   * References a service instance.
   * @param {any} instance - The service instance.
   * @param {Definition} parentDef - The parent definition.
   * @returns {Definition} - The definition of the referenced service.
   */
  refService(instance: any, parentDef: Definition) {
    const existingStub = this.serviceInstances.get(instance);
    if (existingStub) {
      return existingStub.definition;
    }

    const meta = isServiceInterface(instance) ? instance.$def!.meta : getServiceMetadata(instance);
    const stub = new ServiceStub(this, instance, meta);
    stub.definition.parentId = parentDef.id;
    this.serviceInstances.set(instance, stub);
    this.stubs.set(stub.definition.id, stub);
    return stub.definition;
  }

  /**
   * Unreferences a service by its definition id.
   * @param {string} [defId] - The definition id of the service to unreference.
   */
  unrefService(defId?: string) {
    if (defId) {
      const stub = this.stubs.get(defId);
      if (stub) {
        this.serviceInstances.delete(stub.instance);

        if (!this.netron.services.has(getQualifiedName(stub.definition.meta.name, stub.definition.meta.version))) {
          this.stubs.delete(stub.definition.id);
        }
      }
    }
  }

  /**
   * Subscribes to an event.
   * @param {string} eventName - The name of the event.
   * @param {EventSubscriber} handler - The event handler.
   */
  subscribe(eventName: string, handler: EventSubscriber) {
    this.netron.on(eventName, handler);
  }

  /**
   * Unsubscribes from an event.
   * @param {string} eventName - The name of the event.
   * @param {EventSubscriber} handler - The event handler.
   */
  unsubscribe(eventName: string, handler: EventSubscriber) {
    this.netron.removeListener(eventName, handler);
  }

  /**
   * Sets a value on a service stub.
   * @param {string} defId - The definition id of the service.
   * @param {string} name - The name of the property.
   * @param {any} value - The value to set.
   * @returns {Promise<void>}
   */
  async set(defId: string, name: string, value: any) {
    return this.getStubByDefinitionId(defId).set(name, value);
  }

  /**
   * Gets a value from a service stub.
   * @param {string} defId - The definition id of the service.
   * @param {string} name - The name of the property.
   * @returns {Promise<any>}
   */
  async get(defId: string, name: string) {
    return this.processResult(await this.getStubByDefinitionId(defId).get(name));
  }

  /**
   * Calls a method on a service stub.
   * @param {string} defId - The definition id of the service.
   * @param {string} method - The name of the method.
   * @param {any[]} args - The arguments to pass to the method.
   * @returns {Promise<any>}
   */
  async call(defId: string, method: string, args: any[]) {
    return this.processResult(await this.getStubByDefinitionId(defId).call(method, args));
  }

  /**
   * Checks if a stub exists for a given definition id.
   * @param {string} defId - The definition id.
   * @returns {boolean} - True if the stub exists, false otherwise.
   */
  hasStub(defId: string) {
    return this.stubs.has(defId);
  }

  /**
   * Gets the names of all services.
   * @returns {string[]} - An array of service names.
   */
  getServiceNames() {
    return this.netron.getServiceNames();
  }

  /**
   * Gets a stub by its definition id.
   * @param {string} defId - The definition id.
   * @returns {ServiceStub} - The service stub.
   * @throws {Error} - If the definition is unknown.
   */
  getStubByDefinitionId(defId: string) {
    const stub = this.stubs.get(defId);
    if (stub === void 0) {
      throw new Error(`Unknown definition: ${defId}.`);
    }
    return stub;
  }

  /**
   * Gets a definition by its id.
   * @param {string} defId - The definition id.
   * @returns {Definition} - The definition.
   * @throws {Error} - If the definition is unknown.
   */
  protected getDefinitionById(defId: string): Definition {
    const stub = this.stubs.get(defId);
    if (stub === void 0) {
      throw new Error(`Unknown definition: ${defId}.`);
    }
    return stub.definition;
  }

  /**
   * Gets a definition by the service name.
   * @param {string} name - The service name.
   * @returns {Definition} - The definition.
   * @throws {Error} - If the service is unknown.
   */
  protected getDefinitionByServiceName(name: string): Definition {
    const stub = this.netron.services.get(name);
    if (stub === void 0) {
      throw new Error(`Unknown service: ${name}.`);
    }
    return stub.definition;
  }

  /**
   * Processes the result of a service call.
   * @param {any} result - The result to process.
   * @returns {any} - The processed result.
   */
  private processResult(result: any) {
    if (isServiceDefinition(result)) {
      return this.queryInterfaceByDefId(result.id, result);
    }
    return result;
  }
}
