import { Logger } from 'pino';
/**
 * Imports required dependencies for the RemotePeer class implementation.
 * @module remote-peer
 */
import { WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { TimedMap } from '@devgrid/common';

import { Netron } from './netron';
import { Interface } from './interface';
import { Definition } from './definition';
import { getQualifiedName } from './utils';
import { ServiceStub } from './service-stub';
import { AbstractPeer } from './abstract-peer';
import { StreamReference } from './stream-reference';
import { NetronReadableStream } from './readable-stream';
import { NetronWritableStream } from './writable-stream';
import { isServiceDefinition, isNetronStreamReference } from './predicates';
import {
  REQUEST_TIMEOUT,
  SERVICE_ANNOTATION,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
} from './constants';
import {
  Abilities,
  NetronOptions,
  EventSubscriber,
  ServiceMetadata,
  ServiceExposeEvent,
  ServiceUnexposeEvent,
} from './types';
import {
  Packet,
  TYPE_GET,
  TYPE_SET,
  TYPE_CALL,
  TYPE_TASK,
  PacketType,
  TYPE_STREAM,
  createPacket,
  encodePacket,
  decodePacket,
  TYPE_STREAM_ERROR,
  createStreamPacket,
} from './packet';

/**
 * Represents a remote peer in the Netron network.
 * This class handles communication with a remote peer over WebSocket,
 * managing services, streams, and event subscriptions.
 *
 * @class RemotePeer
 * @extends AbstractPeer
 */
export class RemotePeer extends AbstractPeer {
  /** Event emitter for handling internal events */
  private events = new EventEmitter();

  public logger: Logger;

  /**
   * Map of response handlers for pending requests with timeout functionality.
   * Each handler contains success and error callbacks.
   */
  private responseHandlers = new TimedMap<
    number,
    { successHandler: (response: Packet) => void; errorHandler?: (data: any) => void }
  >(this.netron.options?.requestTimeout ?? REQUEST_TIMEOUT, (packetId: number) => {
    const handlers = this.deleteResponseHandler(packetId);
    if (handlers?.errorHandler) {
      handlers.errorHandler(new Error('Request timeout exceeded'));
    }
  });

  /** Map of writable streams indexed by stream ID */
  public writableStreams = new Map<number, NetronWritableStream>();

  /** Map of readable streams indexed by stream ID */
  public readableStreams = new Map<number, NetronReadableStream>();

  /** Map of event subscribers indexed by event name */
  public eventSubscribers = new Map<string, EventSubscriber[]>();

  /** Map of remote subscriptions indexed by event name */
  public remoteSubscriptions = new Map<string, EventSubscriber>();

  /** Map of service definitions indexed by service name */
  public services = new Map<string, Definition>();

  /** Map of all definitions indexed by definition ID */
  public definitions = new Map<string, Definition>();

  /**
   * Creates a new instance of RemotePeer.
   *
   * @constructor
   * @param {WebSocket} socket - The WebSocket connection to the remote peer
   * @param {Netron} netron - The Netron instance this peer belongs to
   * @param {string} [id=""] - Optional unique identifier for the remote peer
   */
  constructor(
    private socket: WebSocket,
    netron: Netron,
    id: string = ''
  ) {
    super(netron, id);

    this.logger = netron.logger.child({ peerId: this.id, remotePeer: true });
  }

  /**
   * Initializes the remote peer connection.
   * Sets up message handlers and initializes service discovery if acting as a connector.
   *
   * @async
   * @param {boolean} [isConnector] - Whether this peer is acting as a connector
   * @param {NetronOptions} [options] - Configuration options for the local Netron instance
   * @returns {Promise<void>}
   */
  async init(isConnector?: boolean, options?: NetronOptions) {
    this.logger.info({ isConnector }, 'Initializing remote peer');
    this.socket.on('message', (data: ArrayBuffer, isBinary: boolean) => {
      if (isBinary) {
        try {
          this.handlePacket(decodePacket(data));
        } catch (error) {
          this.logger.error({ error }, 'Packet decode error:');
        }
      } else {
        this.logger.warn({ data }, 'Received non-binary message:');
      }
    });

    if (isConnector) {
      this.logger.info('Initializing as connector');
      this.abilities = (await this.runTask('abilities', this.netron.peer.abilities)) as Abilities;

      if (this.abilities.services) {
        this.logger.info({ count: this.abilities.services.size }, 'Registering remote services');
        for (const [name, definition] of this.abilities.services) {
          this.definitions.set(definition.id, definition);
          this.services.set(name, definition);
        }
      }

      if (this.abilities.allowServiceEvents) {
        this.logger.info('Subscribing to service lifecycle events');
        await this.subscribe(NETRON_EVENT_SERVICE_EXPOSE, (event: ServiceExposeEvent) => {
          this.logger.info({ event }, 'Service exposed event received');
          this.definitions.set(event.definition.id, event.definition);
          this.services.set(event.qualifiedName, event.definition);
        });
        await this.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, (event: ServiceUnexposeEvent) => {
          this.logger.info({ event }, 'Service unexposed event received');
          this.definitions.delete(event.defId);
          this.services.delete(event.qualifiedName);
        });
      }
    }
  }

  /**
   * Exposes a service to the remote peer.
   * Validates the service metadata and creates necessary stubs.
   *
   * @async
   * @param {any} instance - The service instance to expose
   * @returns {Promise<Definition>} The service definition
   * @throws {Error} If the service is invalid or already exposed
   */
  async exposeService(instance: any) {
    const meta = Reflect.getMetadata(SERVICE_ANNOTATION, instance.constructor) as ServiceMetadata;
    if (!meta) {
      throw new Error('Invalid service');
    }

    if (this.services.has(meta.name)) {
      throw new Error(`Service already exposed: ${meta.name}`);
    }

    const def = await this.runTask('expose_service', meta);

    const stub = new ServiceStub(this.netron.peer, instance, meta);
    this.netron.peer.stubs.set(def.id, stub);
    this.netron.peer.serviceInstances.set(instance, stub);

    return def;
  }

  /**
   * Unexposes a service from the remote peer.
   * Cleans up associated interfaces and stubs.
   *
   * @async
   * @param {string} serviceName - The name of the service to unexpose
   * @returns {Promise<void>}
   */
  async unexposeService(serviceName: string) {
    const defId = await this.runTask('unexpose_service', serviceName);

    // Clean up interfaces
    for (const i of this.interfaces.values()) {
      if (i.instance.$def?.parentId === defId) {
        this.releaseInterface(i.instance);
      }
    }

    // Clean up stubs
    const stub = this.netron.peer.stubs.get(defId);
    if (stub) {
      this.netron.peer.serviceInstances.delete(stub.instance);
      this.netron.peer.stubs.delete(defId);
    }
  }

  /**
   * Subscribes to an event from the remote peer.
   *
   * @async
   * @param {string} eventName - The name of the event to subscribe to
   * @param {EventSubscriber} handler - The event handler function
   * @returns {Promise<void>}
   */
  async subscribe(eventName: string, handler: EventSubscriber) {
    const handlers = this.eventSubscribers.get(eventName);
    if (!handlers) {
      this.eventSubscribers.set(eventName, [handler]);
      await this.runTask('subscribe', eventName);
    } else if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }

  /**
   * Unsubscribes from an event.
   *
   * @async
   * @param {string} eventName - The name of the event to unsubscribe from
   * @param {EventSubscriber} handler - The event handler to remove
   * @returns {Promise<void>}
   */
  async unsubscribe(eventName: string, handler: EventSubscriber) {
    const handlers = this.eventSubscribers.get(eventName);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index >= 0) {
        handlers.splice(index, 1);
        if (handlers.length === 0) {
          this.eventSubscribers.delete(eventName);
          await this.runTask('unsubscribe', eventName);
        }
      }
    }
  }

  /**
   * Gets the names of all available services.
   *
   * @returns {string[]} Array of service names
   */
  getServiceNames() {
    return [...this.services.keys()];
  }

  /**
   * Gets a value from a service definition.
   *
   * @param {string} defId - The service definition ID
   * @param {string} defId - The unique identifier of the service definition.
   * @param {string} name - The name of the value to get.
   * @returns {Promise<any>} The value.
   */
  get(defId: string, name: string) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}`);
    }

    return new Promise<any>((resolve, reject) => {
      this.sendRequest(
        TYPE_GET,
        [defId, name],
        (result) => {
          resolve(this.processResult(def, result));
        },
        reject
      ).catch(reject);
    });
  }
  /**
   * Sets a value in a service definition.
   * This method allows setting a property value on a remote service instance.
   * It first validates that the service definition exists, then sends a request
   * to the remote peer to update the value.
   *
   * @param {string} defId - The unique identifier of the service definition to update
   * @param {string} name - The name of the property to set
   * @param {any} value - The new value to assign to the property
   * @returns {Promise<void>} A promise that resolves when the value has been set
   * @throws {Error} If the service definition is not found
   */
  set(defId: string, name: string, value: any) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}`);
    }

    return new Promise<void>((resolve, reject) => {
      this.sendRequest(
        TYPE_SET,
        [defId, name, value],
        () => {
          resolve();
        },
        reject
      ).catch(reject);
    });
  }

  /**
   * Calls a method on a service definition.
   * This method invokes a remote procedure call on a service instance.
   * It processes the arguments, sends the request, and handles the response.
   *
   * @param {string} defId - The unique identifier of the service definition
   * @param {string} method - The name of the method to invoke
   * @param {any[]} args - The arguments to pass to the method
   * @returns {Promise<any>} A promise that resolves with the method's return value
   * @throws {Error} If the service definition is not found
   */
  call(defId: string, method: string, args: any[]) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}`);
    }

    args = this.processArgs(def, args);
    return new Promise<any>((resolve, reject) => {
      this.sendRequest(
        TYPE_CALL,
        [defId, method, ...args],
        (result) => {
          resolve(this.processResult(def, result));
        },
        reject
      ).catch(reject);
    });
  }

  /**
   * Disconnects the remote peer connection.
   * This method gracefully closes the WebSocket connection and cleans up resources.
   * It emits a 'manual-disconnect' event and performs cleanup operations.
   */
  disconnect() {
    this.logger.info('Disconnecting remote peer');
    this.events.emit('manual-disconnect');

    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    } else {
      this.logger.warn(`Attempt to close WebSocket in unexpected state: ${this.socket.readyState}`);
    }
    this.cleanup();
  }

  /**
   * Registers a one-time event listener.
   * This method allows listening for specific events that will only trigger once.
   *
   * @param {'manual-disconnect' | 'stream'} event - The event name to listen for
   * @param {(...args: any[]) => void} listener - The callback function to execute
   */
  once(event: 'manual-disconnect' | 'stream', listener: (...args: any[]) => void) {
    this.events.once(event, listener);
  }

  /**
   * Cleans up internal resources and state.
   * This method clears all internal maps and collections used for managing
   * connections, streams, and service definitions.
   */
  private cleanup() {
    this.responseHandlers.clear();
    this.writableStreams.clear();
    this.readableStreams.clear();
    this.eventSubscribers.clear();
    this.remoteSubscriptions.clear();
    this.services.clear();
    this.definitions.clear();
  }

  /**
   * Executes a task on the remote peer.
   * This method sends a task request to the remote peer and handles the response.
   *
   * @param {string} name - The name of the task to execute
   * @param {...any[]} args - Variable number of arguments to pass to the task
   * @returns {Promise<any>} A promise that resolves with the task's result
   */
  runTask(name: string, ...args: any[]) {
    return new Promise<any>((resolve, reject) => {
      this.sendRequest(
        TYPE_TASK,
        [name, ...args],
        (result) => {
          resolve(result);
        },
        reject
      ).catch(reject);
    });
  }

  /**
   * Sends a request to the remote peer.
   * This method creates a new packet, registers response handlers, and sends it.
   *
   * @param {PacketType} type - The type of packet to send
   * @param {any} data - The data payload to include in the packet
   * @param {(response: Packet) => void} successHandler - Callback for successful responses
   * @param {(data: any) => void} [errorHandler] - Optional callback for error responses
   * @returns {Promise<void>} A promise that resolves when the packet is sent
   */
  private sendRequest(
    type: PacketType,
    data: any,
    successHandler: (response: Packet) => void,
    errorHandler?: (data: any) => void
  ) {
    const packet = createPacket(Packet.nextId(), 1, type, data);
    this.responseHandlers.set(packet.id, {
      successHandler,
      errorHandler,
    });

    return this.sendPacket(packet);
  }

  /**
   * Sends a response packet to the remote peer.
   * This method prepares and sends a response packet with the specified data.
   *
   * @param {Packet} packet - The original packet to respond to
   * @param {any} data - The response data to send
   * @returns {Promise<void>} A promise that resolves when the response is sent
   */
  private sendResponse(packet: Packet, data: any) {
    packet.setImpulse(0);
    packet.data = data;
    return this.sendPacket(packet);
  }

  /**
   * Sends an error response to the remote peer.
   * This method prepares and sends an error response packet.
   *
   * @param {Packet} packet - The original packet to respond to
   * @param {any} error - The error information to send
   * @returns {Promise<void>} A promise that resolves when the error response is sent
   */
  private sendErrorResponse(packet: Packet, error: any) {
    packet.setImpulse(0);
    packet.setError(1);
    packet.data = error;
    return this.sendPacket(packet);
  }

  /**
   * Sends a packet to the remote peer.
   * This method handles the actual transmission of packets over the WebSocket connection.
   *
   * @param {Packet} packet - The packet to send
   * @returns {Promise<void>} A promise that resolves when the packet is sent
   * @throws {Error} If the WebSocket connection is not open
   */
  sendPacket(packet: Packet) {
    return new Promise<void>((resolve, reject) => {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(encodePacket(packet), { binary: true }, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        reject(new Error('Socket closed'));
      }
    });
  }

  /**
   * Sends a stream chunk to the remote peer.
   * This method sends a portion of stream data to the remote peer.
   *
   * @param {number} streamId - The unique identifier of the stream
   * @param {any} chunk - The data chunk to send
   * @param {number} index - The sequence number of the chunk
   * @param {boolean} isLast - Whether this is the final chunk in the stream
   * @param {boolean} isLive - Whether this is a live streaming chunk
   * @returns {Promise<void>} A promise that resolves when the chunk is sent
   */
  sendStreamChunk(streamId: number, chunk: any, index: number, isLast: boolean, isLive: boolean) {
    return this.sendPacket(createStreamPacket(Packet.nextId(), streamId, index, isLast, isLive, chunk));
  }

  /**
   * Handles a response packet from the remote peer.
   * This method processes incoming response packets and invokes the appropriate handlers.
   *
   * @param {Packet} packet - The response packet to handle
   */
  private handleResponse(packet: Packet) {
    const id = packet.id;
    const handlers = this.deleteResponseHandler(id);
    if (handlers) {
      const data = packet.data;
      if (packet.getError() === 0) {
        handlers.successHandler(data);
      } else {
        handlers.errorHandler?.(data);
      }
    }
  }
  /**
   * Handles incoming packets from the remote peer.
   * This method serves as the central packet processing hub, routing different types of packets
   * to their appropriate handlers. It implements a robust error handling mechanism and supports
   * various packet types including SET, GET, CALL, TASK, STREAM, and STREAM_ERROR operations.
   *
   * @param {Packet} packet - The incoming packet to be processed
   * @returns {Promise<void>} Resolves when packet processing is complete
   * @throws {Error} If packet processing fails and error response cannot be sent
   */
  async handlePacket(packet: Packet) {
    this.logger.debug({ type: packet.getType() }, 'Handling packet');
    const pType = packet.getType();

    if (packet.getImpulse() === 0) {
      this.handleResponse(packet);
      return;
    }

    switch (pType) {
      case TYPE_SET: {
        const [defId, name, value] = packet.data;
        this.logger.debug({ defId, name }, 'Processing SET packet');

        try {
          const stub = this.netron.peer.getStubByDefinitionId(defId);
          await stub.set(name, value);
          await this.sendResponse(packet, undefined);
        } catch (err: any) {
          this.logger.error({ value: err }, 'Error setting value:');
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_: any) {
            this.logger.error({ value: err_ }, 'Error sending error response:');
          }
        }
        break;
      }
      case TYPE_GET: {
        const [defId, name] = packet.data;
        this.logger.debug({ defId, name }, 'Processing GET packet');

        try {
          const stub = this.netron.peer.getStubByDefinitionId(defId);
          await this.sendResponse(packet, await stub.get(name));
        } catch (err: any) {
          this.logger.error({ value: err }, 'Error getting value:');
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_) {
            this.logger.error({ value: err_ }, 'Error sending error response:');
          }
        }
        break;
      }
      case TYPE_CALL: {
        const [defId, method, ...args] = packet.data;
        this.logger.debug({ defId, method }, 'Processing CALL packet');

        try {
          const stub = this.netron.peer.getStubByDefinitionId(defId);
          await this.sendResponse(packet, await stub.call(method, args, this));
        } catch (err: any) {
          this.logger.error({ value: err }, 'Error calling method:');
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_) {
            this.logger.error({ value: err_ }, 'Error sending error response:');
          }
        }
        break;
      }
      case TYPE_TASK: {
        const [name, ...args] = packet.data;
        this.logger.debug({ name }, 'Processing TASK packet');

        try {
          await this.sendResponse(packet, await this.netron.runTask(this, name, ...args));
        } catch (err: any) {
          this.logger.error({ value: err }, 'Error running task:');
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_) {
            this.logger.error({ value: err_ }, 'Error sending error response:');
          }
        }
        break;
      }
      case TYPE_STREAM: {
        if (!packet.streamId) {
          this.logger.warn('Received STREAM packet without streamId');
          return;
        }

        let stream = this.readableStreams.get(packet.streamId);
        if (!stream) {
          this.logger.debug({ streamId: packet.streamId }, 'Creating new readable stream');
          stream = NetronReadableStream.create(this, packet.streamId, packet.isLive());
          this.events.emit('stream', stream);
        }

        stream.onPacket(packet);
        break;
      }
      case TYPE_STREAM_ERROR: {
        const { streamId, message } = packet.data;
        this.logger.error({ streamId, message }, 'Stream error received');
        const stream = this.readableStreams.get(streamId);
        if (stream) {
          stream.destroy(new Error(message));
        }
        break;
      }
      default: {
        this.logger.warn({ value: pType }, 'Unknown packet type:');
      }
    }
  }

  /**
   * Releases an interface instance and its associated resources.
   * This method performs cleanup operations by unreferencing the service
   * and removing it from the internal service registry.
   *
   * @param {Interface} iInstance - The interface instance to be released
   * @returns {Promise<void>} Resolves when the interface is fully released
   */
  protected async releaseInterfaceInternal(iInstance: Interface) {
    await this.runTask('unref_service', iInstance.$def?.id);
    this.unrefService(iInstance.$def?.id);
  }

  /**
   * References a service definition and establishes its relationship with a parent service.
   * This method manages service definition references and maintains the service hierarchy.
   *
   * @param {Definition} def - The service definition to be referenced
   * @param {Definition} parentDef - The parent service definition
   * @returns {Definition} The referenced service definition
   */
  refService(def: Definition, parentDef: Definition) {
    const existingDef = this.definitions.get(def.id);
    if (existingDef) {
      return existingDef;
    }

    def.parentId = parentDef.id;
    this.definitions.set(def.id, def);
    return def;
  }

  /**
   * Unreferences a service definition and removes it from the registry if no longer needed.
   * This method performs cleanup of unused service definitions to prevent memory leaks.
   *
   * @param {string} [defId] - The unique identifier of the service definition to unreference
   */
  unrefService(defId?: string) {
    if (defId) {
      const def = this.definitions.get(defId);
      if (def) {
        if (!this.services.has(getQualifiedName(def.meta.name, def.meta.version))) {
          this.definitions.delete(defId);
        }
      }
    }
  }

  /**
   * Processes the result of a service call, handling special types like service definitions
   * and stream references. This method ensures proper type conversion and reference management.
   *
   * @param {Definition} parentDef - The parent service definition context
   * @param {any} result - The raw result to be processed
   * @returns {any} The processed result with proper type conversion
   */
  private processResult(parentDef: Definition, result: any) {
    if (isServiceDefinition(result)) {
      const def = this.refService(result, parentDef);
      return this.queryInterfaceByDefId(def.id, def);
    } else if (isNetronStreamReference(result)) {
      return StreamReference.to(result, this);
    }
    return result;
  }

  /**
   * Processes arguments before sending them to the remote peer.
   * This method can be overridden to implement custom argument processing logic.
   *
   * @param {Definition} ctxDef - The context service definition
   * @param {any} args - The arguments to be processed
   * @returns {any} The processed arguments
   */
  private processArgs(ctxDef: Definition, args: any) {
    return args;
  }

  /**
   * Deletes a response handler for a specific packet ID.
   * This method manages the lifecycle of response handlers and cleans up resources.
   *
   * @param {number} packetId - The unique identifier of the packet
   * @returns {any} The deleted response handler, if it exists
   */
  private deleteResponseHandler(packetId: number) {
    const handlers = this.responseHandlers.get(packetId);
    if (handlers) {
      this.responseHandlers.delete(packetId);
    }
    return handlers;
  }

  /**
   * Retrieves a service definition by its unique identifier.
   * This method provides access to service definitions while ensuring they exist.
   *
   * @param {string} defId - The unique identifier of the service definition
   * @returns {Definition} The requested service definition
   * @throws {Error} If the service definition cannot be found
   */
  protected getDefinitionById(defId: string) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}.`);
    }
    return def;
  }

  /**
   * Retrieves a service definition by its qualified name.
   * This method provides access to service definitions using their service names.
   *
   * @param {string} name - The qualified name of the service
   * @returns {Definition} The requested service definition
   * @throws {Error} If the service definition cannot be found
   */
  protected getDefinitionByServiceName(name: string) {
    const def = this.services.get(name);
    if (def === void 0) {
      throw new Error(`Unknown service: ${name}.`);
    }
    return def;
  }
}
