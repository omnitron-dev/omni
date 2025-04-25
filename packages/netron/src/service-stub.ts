import { LocalPeer } from './local-peer';
import { Definition } from './definition';
import { ServiceMetadata } from './types';
import { StreamReference } from './stream-reference';
import { isNetronStream, isNetronService, isServiceReference, isServiceInterface, isServiceDefinition, isNetronStreamReference } from './predicates';

/**
 * The ServiceStub class acts as a proxy for a service instance, allowing
 * interaction with the service's properties and methods while managing
 * the underlying service definition.
 */
export class ServiceStub {
  public definition: Definition;

  /**
   * Constructs a ServiceStub instance.
   * @param {LocalPeer} peer - The local peer associated with this service stub.
   * @param {any} instance - The actual service instance this stub represents.
   * @param {ServiceMetadata | Definition} metaOrDefinition - Metadata or a definition object for the service.
   */
  constructor(
    public peer: LocalPeer,
    public instance: any,
    metaOrDefinition: ServiceMetadata | Definition
  ) {
    // Determine if the provided metaOrDefinition is a service definition.
    if (isServiceDefinition(metaOrDefinition)) {
      this.definition = metaOrDefinition;
    } else {
      // Create a new Definition if metaOrDefinition is not a service definition.
      this.definition = new Definition(Definition.nextId(), peer.id, metaOrDefinition);
    }
  }

  /**
   * Sets a property on the service instance.
   * @param {string} prop - The name of the property to set.
   * @param {any} value - The value to set the property to.
   */
  set(prop: string, value: any) {
    Reflect.set(this.instance, prop, this.processValue(value));
  }

  /**
   * Gets a property from the service instance.
   * @param {string} prop - The name of the property to get.
   * @returns {any} The processed result of the property.
   */
  get(prop: string) {
    return this.processResult(this.instance[prop]);
  }

  /**
   * Calls a method on the service instance.
   * @param {string} method - The name of the method to call.
   * @param {any[]} args - The arguments to pass to the method.
   * @returns {Promise<any>} The processed result of the method call.
   */
  async call(method: string, args: any[]) {
    const processedArgs = this.processArgs(args);
    let result = this.instance[method](...processedArgs);
    if (result instanceof Promise) {
      result = await result;
    }
    return this.processResult(result);
  }

  /**
   * Processes the result of a service interaction.
   * @param {any} result - The result to process.
   * @returns {any} The processed result, potentially a service reference.
   */
  private processResult(result: any) {
    if (isNetronService(result) || isServiceInterface(result)) {
      return this.peer.refService(result, this.definition);
    } else if (isNetronStream(result)) {
      return StreamReference.from(result);
    }
    return result;
  }

  /**
   * Processes an array of arguments, transforming each as necessary.
   * @param {any[]} args - The arguments to process.
   * @returns {any[]} The processed arguments.
   */
  private processArgs(args: any[]) {
    return args.map((arg: any) => this.processValue(arg));
  }

  /**
   * Processes a single value, transforming it if it is a service reference.
   * @param {any} obj - The value to process.
   * @returns {any} The processed value.
   */
  private processValue(obj: any) {
    if (isServiceReference(obj)) {
      return this.peer.queryInterfaceByDefId(obj.defId);
    } else if (isNetronStreamReference(obj)) {
      return StreamReference.to(obj, this.peer.netron.peers.get(obj.peerId)!);
    }
    return obj;
  }
}
