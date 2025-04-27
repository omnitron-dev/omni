import { Logger } from 'pino';

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
 * LocalPeer is a concrete implementation of AbstractPeer that manages local service instances
 * and their corresponding stubs within the Netron network. It handles service exposure,
 * unexposure, and provides methods for service interaction and event management.
 * 
 * @extends AbstractPeer
 */
export class LocalPeer extends AbstractPeer {
  public logger: Logger;

  /**
   * A mapping of service definition IDs to their corresponding ServiceStub instances.
   * This map maintains the relationship between service definitions and their stubs.
   */
  public stubs = new Map<string, ServiceStub>();

  /**
   * A mapping of service instances to their corresponding ServiceStub instances.
   * This map tracks all active service instances and their associated stubs.
   */
  public serviceInstances = new Map<InstanceType<any>, ServiceStub>();

  /**
   * Constructs a new LocalPeer instance.
   * 
   * @param {Netron} netron - The Netron network instance this peer belongs to.
   * @throws {Error} If the provided Netron instance is invalid.
   */
  constructor(netron: Netron) {
    super(netron, netron.id);
    this.logger = netron.logger;
    this.abilities = {
      allowServiceEvents: netron.options?.allowServiceEvents ?? false,
    };
  }

  /**
   * Exposes a local service instance to the network, making it available for remote access.
   * This method performs several validations and creates necessary service artifacts.
   * 
   * @param {any} instance - The service instance to expose.
   * @returns {Promise<Definition>} The definition of the newly exposed service.
   * @throws {Error} If the service is invalid, already exposed, or if the service name is already in use.
   * @throws {Error} If the service metadata cannot be retrieved.
   */
  async exposeService(instance: any): Promise<Definition> {
    const meta = getServiceMetadata(instance);
    if (!meta) {
      throw new Error('Invalid service: Service metadata could not be retrieved');
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

    await this.netron.discovery?.updateServices(this.netron.getExposedServices());

    return def;
  }

  /**
   * Exposes a remote service from another peer, creating necessary local artifacts
   * to interact with the remote service.
   * 
   * @param {RemotePeer} peer - The remote peer providing the service.
   * @param {ServiceMetadata} meta - The metadata describing the remote service.
   * @returns {Definition} The definition of the exposed remote service.
   * @throws {Error} If the remote peer is invalid or the service metadata is incomplete.
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
   * Unexposes a local service, removing it from the network and cleaning up associated resources.
   * 
   * @param {string} serviceName - The name of the service to unexpose.
   * @returns {Promise<void>}
   * @throws {Error} If the service is not found or if there are issues during cleanup.
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

    await this.netron.discovery?.updateServices(this.netron.getExposedServices());
  }

  /**
   * Unexposes a remote service, cleaning up local resources and notifying the remote peer.
   * 
   * @param {RemotePeer} peer - The remote peer providing the service.
   * @param {string} serviceName - The name of the service to unexpose.
   * @returns {string} The ID of the unexposed service definition.
   * @throws {Error} If the service is not found or if there are issues during cleanup.
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
   * Internal method to release an interface and clean up associated resources.
   * 
   * @param {Interface} iInstance - The interface instance to release.
   * @returns {Promise<void>}
   * @protected
   */
  protected async releaseInterfaceInternal(iInstance: Interface): Promise<void> {
    this.unrefService(iInstance.$def?.id);
  }

  /**
   * Creates a reference to a service instance, establishing necessary relationships
   * between the instance and its definition.
   * 
   * @param {any} instance - The service instance to reference.
   * @param {Definition} parentDef - The parent definition this service belongs to.
   * @returns {Definition} The definition of the referenced service.
   * @throws {Error} If the service instance is invalid or if metadata cannot be retrieved.
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
   * Removes a reference to a service, cleaning up associated resources if no other
   * references exist.
   * 
   * @param {string} [defId] - The definition ID of the service to unreference.
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
   * Removes an event listener from the Netron network event system.
   * This method allows a peer to stop receiving notifications for specific events
   * by removing the previously registered event handler.
   * 
   * @param {string} eventName - The name of the event to unsubscribe from.
   *                            This should match the event name used in the corresponding subscribe() call.
   * @param {EventSubscriber} handler - The event handler function to remove.
   *                                   This must be the same function reference that was used in subscribe().
   * @returns {void}
   */
  unsubscribe(eventName: string, handler: EventSubscriber) {
    this.netron.removeListener(eventName, handler);
  }

  /**
   * Sets a property value on a service stub identified by its definition ID.
   * This method provides a way to update service properties remotely through the network.
   * 
   * @param {string} defId - The unique identifier of the service definition.
   * @param {string} name - The name of the property to set.
   * @param {any} value - The new value to assign to the property.
   * @returns {Promise<void>} A promise that resolves when the property has been set.
   * @throws {Error} If the service definition is unknown or if the property cannot be set.
   */
  async set(defId: string, name: string, value: any) {
    return this.getStubByDefinitionId(defId).set(name, value);
  }

  /**
   * Retrieves a property value from a service stub identified by its definition ID.
   * This method handles the asynchronous nature of remote property access and
   * processes the result appropriately.
   * 
   * @param {string} defId - The unique identifier of the service definition.
   * @param {string} name - The name of the property to retrieve.
   * @returns {Promise<any>} A promise that resolves with the property value.
   * @throws {Error} If the service definition is unknown or if the property cannot be accessed.
   */
  async get(defId: string, name: string) {
    return this.processResult(await this.getStubByDefinitionId(defId).get(name));
  }

  /**
   * Invokes a method on a service stub identified by its definition ID.
   * This method handles remote method calls, including parameter passing and
   * result processing.
   * 
   * @param {string} defId - The unique identifier of the service definition.
   * @param {string} method - The name of the method to invoke.
   * @param {any[]} args - An array of arguments to pass to the method.
   * @returns {Promise<any>} A promise that resolves with the method's return value.
   * @throws {Error} If the service definition is unknown or if the method call fails.
   */
  async call(defId: string, method: string, args: any[]) {
    return this.processResult(await this.getStubByDefinitionId(defId).call(method, args));
  }

  /**
   * Checks whether a service stub exists for a given definition ID.
   * This method provides a way to verify the existence of a service before
   * attempting operations on it.
   * 
   * @param {string} defId - The unique identifier of the service definition to check.
   * @returns {boolean} True if a stub exists for the given definition ID, false otherwise.
   */
  hasStub(defId: string) {
    return this.stubs.has(defId);
  }

  /**
   * Retrieves the names of all services available in the Netron network.
   * This method provides a way to discover available services in the network.
   * 
   * @returns {string[]} An array of service names available in the network.
   */
  getServiceNames() {
    return this.netron.getServiceNames();
  }

  /**
   * Retrieves a service stub by its definition ID.
   * This method is a core utility for accessing service stubs and includes
   * error handling for unknown definitions.
   * 
   * @param {string} defId - The unique identifier of the service definition.
   * @returns {ServiceStub} The service stub associated with the given definition ID.
   * @throws {Error} If no stub exists for the given definition ID.
   */
  getStubByDefinitionId(defId: string) {
    const stub = this.stubs.get(defId);
    if (stub === void 0) {
      throw new Error(`Unknown definition: ${defId}.`);
    }
    return stub;
  }

  /**
   * Retrieves a service definition by its unique identifier.
   * This protected method is used internally to access service definitions
   * and includes error handling for unknown definitions.
   * 
   * @param {string} defId - The unique identifier of the service definition.
   * @returns {Definition} The service definition associated with the given ID.
   * @throws {Error} If no definition exists for the given ID.
   */
  protected getDefinitionById(defId: string): Definition {
    const stub = this.stubs.get(defId);
    if (stub === void 0) {
      throw new Error(`Unknown definition: ${defId}.`);
    }
    return stub.definition;
  }

  /**
   * Retrieves a service definition by its service name.
   * This protected method provides a way to look up service definitions
   * using their human-readable names.
   * 
   * @param {string} name - The name of the service to look up.
   * @returns {Definition} The service definition associated with the given name.
   * @throws {Error} If no service exists with the given name.
   */
  protected getDefinitionByServiceName(name: string): Definition {
    const stub = this.netron.services.get(name);
    if (stub === void 0) {
      throw new Error(`Unknown service: ${name}.`);
    }
    return stub.definition;
  }

  /**
   * Processes the result of a service call or property access.
   * This private method handles special cases in service results, such as
   * converting service definitions into appropriate interface objects.
   * 
   * @param {any} result - The raw result to process.
   * @returns {any} The processed result, which may be transformed based on its type.
   */
  private processResult(result: any) {
    if (isServiceDefinition(result)) {
      return this.queryInterfaceByDefId(result.id, result);
    }
    return result;
  }
}
