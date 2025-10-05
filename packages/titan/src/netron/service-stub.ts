import { isAsyncGenerator } from '@omnitron-dev/common';

import type { ILocalPeer } from './netron.types.js';
import { Definition } from './definition.js';
import { ServiceMetadata } from './types.js';
import { StreamReference } from './stream-reference.js';
import { NetronWritableStream } from './writable-stream.js';
import {
  isNetronStream,
  isNetronService,
  isServiceReference,
  isServiceDefinition,
  isNetronStreamReference,
} from './predicates.js';
import { Interface } from './interface.js';

/**
 * ServiceStub is a proxy object for a service instance in the Netron system.
 * This class provides transparent interaction with remote services,
 * handling data transformation and managing the lifecycle of service definitions.
 *
 * @class ServiceStub
 * @description Main class for working with services in the distributed Netron system
 */
export class ServiceStub {
  /** Service definition containing metadata and interface specification */
  public definition: Definition;

  /**
   * Creates a new ServiceStub instance.
   *
   * @param {LocalPeer} peer - Local peer associated with this service
   * @param {any} instance - Service instance that this stub represents
   * @param {ServiceMetadata | Definition} metaOrDefinition - Service metadata or ready-made definition
   * @throws {Error} If unable to create service definition
   */
  constructor(
    public peer: ILocalPeer,
    public instance: any,
    metaOrDefinition: ServiceMetadata | Definition
  ) {
    if (isServiceDefinition(metaOrDefinition)) {
      this.definition = metaOrDefinition;
    } else {
      this.definition = new Definition(Definition.nextId(), peer.id, metaOrDefinition);
    }
  }

  /**
   * Sets the value of a service property.
   *
   * @param {string} prop - Property name to set
   * @param {any} value - Value to set
   * @returns {void}
   * @throws {Error} If property does not exist or is not writable
   */
  set(prop: string, value: any) {
    Reflect.set(this.instance, prop, this.processValue(value));
  }

  /**
   * Gets the value of a service property.
   *
   * @param {string} prop - Property name to get
   * @returns {any} Processed property value
   * @throws {Error} If property does not exist or is not readable
   */
  get(prop: string) {
    return this.processResult(this.instance[prop]);
  }

  /**
   * Calls a service method with the given arguments.
   *
   * @param {string} method - Method name to call
   * @param {any[]} args - Arguments to pass to the method
   * @returns {Promise<any>} Processed result of the method call
   * @throws {Error} If method does not exist or call fails with an error
   */
  async call(method: string, args: any[], callerPeer?: any) {
    const processedArgs = this.processArgs(args);
    let result = this.instance[method](...processedArgs);

    // Check if result is an AsyncGenerator before awaiting Promise
    if (isAsyncGenerator(result)) {
      // If callerPeer is null, this is a local call - return the generator directly
      if (callerPeer === null) {
        // For local calls within the same process, we can return the generator directly
        return result;
      }

      // We need a RemotePeer to create a stream
      if (!callerPeer) {
        // Try to get the first connected remote peer (not LocalPeer)
        const peers = Array.from(this.peer.netron.peers.values());
        callerPeer = peers.find((p) => p.id !== this.peer.id);
        if (!callerPeer) {
          // If no remote peer, but not explicitly local call, return the generator
          return result;
        }
      }

      // Create a writable stream and pipe the generator to it
      const stream = new NetronWritableStream({
        peer: callerPeer,
        isLive: true,
      });

      // Start piping in background (don't await)
      stream.pipeFrom(result).catch((error) => {
        this.peer.logger.error({ error }, 'Failed to pipe AsyncGenerator');
        stream.destroy(error);
      });

      // Return stream reference immediately
      return StreamReference.from(stream);
    }

    if (result instanceof Promise) {
      result = await result;
    }
    return this.processResult(result);
  }

  /**
   * Processes the result of service interaction.
   * Converts special data types (services, streams) into corresponding references.
   *
   * @param {any} result - Result to process
   * @returns {any} Processed result
   * @private
   */
  private processResult(result: any) {
    if (isNetronService(result) || result instanceof Interface) {
      return this.peer.refService(result, this.definition);
    } else if (isNetronStream(result)) {
      return StreamReference.from(result);
    }
    return result;
  }

  /**
   * Processes an array of arguments for method call.
   * Converts each argument according to its type.
   *
   * @param {any[]} args - Arguments to process
   * @returns {any[]} Processed arguments
   * @private
   */
  private processArgs(args: any[]) {
    return args.map((arg: any) => this.processValue(arg));
  }

  /**
   * Processes a single value.
   * Converts service and stream references into corresponding objects.
   *
   * @param {any} obj - Value to process
   * @returns {any} Processed value
   * @private
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
