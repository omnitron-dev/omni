import type { ILogger } from '../modules/logger/logger.types.js';
/**
 * Imports required dependencies for the RemotePeer class implementation.
 * @module remote-peer
 */
import { EventEmitter } from '@omnitron-dev/eventemitter';
import { TimedMap } from '@omnitron-dev/common';

import { Netron } from './netron.js';
import { Interface } from './interface.js';
import { Definition } from './definition.js';
import { getQualifiedName } from './utils.js';
import { ServiceStub } from './service-stub.js';
import { AbstractPeer } from './abstract-peer.js';
import { StreamReference } from './stream-reference.js';
import { NetronReadableStream } from './readable-stream.js';
import { NetronWritableStream } from './writable-stream.js';
import { isServiceDefinition, isNetronStreamReference } from './predicates.js';
import { NetronErrors, Errors } from '../errors/index.js';
import {
  REQUEST_TIMEOUT,
} from './constants.js';
import {
  NetronOptions,
  EventSubscriber,
} from './types.js';
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
  TYPE_STREAM_CLOSE,
  createStreamPacket,
} from './packet/index.js';

import { SERVICE_ANNOTATION } from '../decorators/core.js';
import type { ExtendedServiceMetadata } from '../decorators/core.js';
import type { ITransport } from './transport/types.js';
import type { AuthContext } from './auth/types.js';

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

  public logger: ILogger;

  /**
   * Map of response handlers for pending requests with timeout functionality.
   * Each handler contains success and error callbacks.
   * Initialized in constructor after requestTimeout is set.
   */
  private responseHandlers!: TimedMap<
    number,
    { successHandler: (response: Packet) => void; errorHandler?: (data: any) => void }
  >;

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

  /** Map of transports associated with each service */
  private serviceTransports = new Map<string, ITransport[]>();

  /** Authentication context for this peer */
  private authContext?: AuthContext;

  /**
   * Creates a new instance of RemotePeer.
   * The socket can be either a WebSocket or a TransportAdapter that mimics the WebSocket API.
   *
   * @constructor
   * @param {any} socket - The socket connection to the remote peer (WebSocket or TransportAdapter)
   * @param {Netron} netron - The Netron instance this peer belongs to
   * @param {string} [id=""] - Optional unique identifier for the remote peer
   * @param {number} [requestTimeout] - Request timeout in milliseconds (overrides default)
   */
  constructor(
    private socket: any, // Can be WebSocket or TransportAdapter
    netron: Netron,
    id: string = '',
    private requestTimeout?: number
  ) {
    super(netron, id);

    this.logger = netron.logger.child({ peerId: this.id, remotePeer: true });

    // Initialize responseHandlers AFTER requestTimeout is set
    this.responseHandlers = new TimedMap<
      number,
      { successHandler: (response: Packet) => void; errorHandler?: (data: any) => void }
    >(this.requestTimeout ?? REQUEST_TIMEOUT, (packetId: number) => {
      const handlers = this.deleteResponseHandler(packetId);
      if (handlers?.errorHandler) {
        handlers.errorHandler(Errors.timeout('RPC request', this.requestTimeout ?? REQUEST_TIMEOUT));
      }
    });
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
      this.logger.info('Initializing as connector - using auth-aware on-demand service discovery');
      this.logger.debug(
        'Services will be discovered on-demand via queryInterface() with authorization checks. ' +
        'Use authenticate() core-task to establish user authentication.'
      );
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
    const meta = Reflect.getMetadata(SERVICE_ANNOTATION, instance.constructor) as ExtendedServiceMetadata;
    if (!meta) {
      throw Errors.badRequest('Invalid service');
    }

    if (this.services.has(meta.name)) {
      throw Errors.conflict(`Service already exposed: ${meta.name}`);
    }

    // If the service has transports configured, store them for later use
    // Note: The application should decide when and how to use these transports
    // We don't automatically start them here to avoid conflicts and allow flexibility
    if (meta.transports && meta.transports.length > 0) {
      this.logger.info(
        {
          serviceName: meta.name,
          transportCount: meta.transports.length,
          transports: meta.transports
        },
        'Service configured with transports'
      );
    }

    const def = await this.runTask('expose_service', meta);

    const stub = new ServiceStub(this.netron.peer, instance, meta);
    this.netron.peer.stubs.set(def.id, stub);
    this.netron.peer.serviceInstances.set(instance, stub);

    // Store transport associations for this service (use _transports if available)
    const extendedMeta = meta as any;
    if (extendedMeta._transports) {
      this.serviceTransports.set(meta.name, extendedMeta._transports);
    }

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

    // Clean up transport associations for this service
    const transports = this.serviceTransports.get(serviceName);
    if (transports) {
      this.logger.info(
        {
          serviceName,
          transportCount: transports.length
        },
        'Cleaning up transport associations for service'
      );
      this.serviceTransports.delete(serviceName);
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
      throw Errors.notFound('Definition', defId);
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
      throw Errors.notFound('Definition', defId);
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
      throw Errors.notFound('Definition', defId);
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
  async disconnect() {
    this.logger.info('Disconnecting remote peer');
    this.events.emit('manual-disconnect');

    // Check if socket is open or connecting (works for both WebSocket and TransportAdapter)
    const readyState = this.socket.readyState;
    if (readyState === 1 || readyState === 'OPEN' ||
      readyState === 0 || readyState === 'CONNECTING') {
      // Use async close if available (TransportAdapter), otherwise sync close (WebSocket)
      if (typeof this.socket.close === 'function') {
        const closeResult = this.socket.close();
        if (closeResult && typeof closeResult.then === 'function') {
          await closeResult; // TransportAdapter returns a Promise
        }
      }
    } else {
      this.logger.warn(`Attempt to close socket in unexpected state: ${readyState}`);
    }
    this.cleanup();
  }

  /**
   * Closes the connection (alias for disconnect).
   * This method is provided for compatibility with Netron's stop method.
   *
   * @async
   * @returns {Promise<void>}
   */
  async close(): Promise<void> {
    return this.disconnect();
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
      // Check if socket is open (works for both WebSocket and TransportAdapter)
      if (this.socket.readyState === 1 || this.socket.readyState === 'OPEN') { // 1 is WebSocket.OPEN
        // For stream packets, don't wait for callback - just resolve immediately
        if (packet.getType() === TYPE_STREAM) {
          this.socket.send(encodePacket(packet), { binary: true });
          resolve();
        } else {
          this.socket.send(encodePacket(packet), { binary: true }, (err?: Error) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        }
      } else {
        reject(NetronErrors.connectionClosed(this.socket.constructor?.name ?? 'unknown', 'Socket closed during RPC'));
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
          if (!this.netron.runTask) {
            throw Errors.notImplemented('runTask not available');
          }
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
          stream.destroy(NetronErrors.streamError(streamId, new Error(message)));
        }
        break;
      }
      case TYPE_STREAM_CLOSE: {
        const { streamId, reason } = packet.data;
        this.logger.info({ streamId, reason }, 'Stream close received');
        const stream = this.readableStreams.get(streamId);
        if (stream) {
          // Immediately close the stream with the provided reason
          stream.forceClose(reason);
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
      throw NetronErrors.serviceNotFound(defId);
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
      throw NetronErrors.serviceNotFound(name);
    }
    return def;
  }

  /**
   * Invalidates cached definitions matching the given pattern.
   * Overrides AbstractPeer to also clear RemotePeer-specific storage (services and definitions Maps).
   *
   * @param {string} [pattern] - Optional pattern to match service names
   * @returns {number} The number of cache entries invalidated
   */
  override invalidateDefinitionCache(pattern?: string): number {
    // Call parent implementation to invalidate definition cache
    const parentCount = super.invalidateDefinitionCache(pattern);

    if (!pattern) {
      // Clear all services and definitions
      const totalCount = this.services.size + this.definitions.size;
      this.services.clear();
      this.definitions.clear();
      return parentCount + totalCount;
    }

    // Pattern matching - remove matching services and definitions
    const servicesToDelete: string[] = [];
    const definitionsToDelete: string[] = [];

    // Find matching services
    for (const key of this.services.keys()) {
      if (this.matchesPatternInternal(key, pattern)) {
        servicesToDelete.push(key);
        const def = this.services.get(key);
        if (def) {
          definitionsToDelete.push(def.id);
        }
      }
    }

    // Delete matched services
    for (const key of servicesToDelete) {
      this.services.delete(key);
    }

    // Delete matched definitions
    for (const id of definitionsToDelete) {
      this.definitions.delete(id);
    }

    // Return total count of invalidated items
    return parentCount + servicesToDelete.length + definitionsToDelete.length;
  }

  /**
   * Internal pattern matching helper
   * @private
   */
  private matchesPatternInternal(serviceName: string, pattern: string): boolean {
    if (serviceName === pattern) return true;
    if (!pattern.includes('*')) return false;

    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(serviceName);
  }

  /**
   * Override queryInterface to skip caching when authorization is present.
   * When auth is configured, each user gets a filtered definition based on their permissions,
   * so we cannot use a shared cache.
   *
   * @template T - Type of the interface to return
   * @param {string} qualifiedName - Service name with optional version (name@version)
   * @returns {Promise<T>} Resolves with the requested interface instance
   */
  override async queryInterface<T>(qualifiedName: string): Promise<T> {
    // Check if authorization manager is configured
    const authzManager = (this.netron as any).authorizationManager;

    // If no auth manager, use default caching behavior from parent
    if (!authzManager) {
      return super.queryInterface<T>(qualifiedName);
    }

    // With auth, skip all caching and always query fresh to get user-specific filtered definition
    this.logger.debug(
      { serviceName: qualifiedName, isAuthenticated: this.isAuthenticated() },
      'Querying interface with authorization (skipping all caches)'
    );

    const definition = await this.queryInterfaceRemote(qualifiedName);

    // Create interface directly without caching in interfaces Map
    // This ensures each user gets an interface bound to their filtered definition
    const instance = Interface.create(definition, this);
    return instance as T;
  }

  /**
   * Queries the remote peer for a service definition using the query_interface core-task.
   * This method executes the query_interface task on the remote peer with authorization checks.
   *
   * NOTE: Definitions are NOT cached when authorization is configured, as each user may
   * receive a different filtered definition based on their permissions.
   *
   * @param {string} qualifiedName - Service name with version (name@version)
   * @returns {Promise<Definition>} Resolves with the service definition
   * @throws {Error} If the service is not found or access is denied
   * @protected
   */
  protected async queryInterfaceRemote(qualifiedName: string): Promise<Definition> {
    this.logger.debug({ serviceName: qualifiedName }, 'Querying remote interface');

    // Execute query_interface task on remote peer
    // This will apply authorization filtering based on the peer's auth context
    const definition = await this.runTask('query_interface', qualifiedName);

    if (!definition) {
      throw NetronErrors.serviceNotFound(qualifiedName);
    }

    // Store the definition in local maps for future reference
    this.definitions.set(definition.id, definition);
    const serviceKey = `${definition.meta.name}@${definition.meta.version}`;
    this.services.set(serviceKey, definition);

    this.logger.info(
      {
        serviceName: qualifiedName,
        definitionId: definition.id,
        methodCount: Object.keys(definition.meta.methods || {}).length,
        isAuthenticated: this.isAuthenticated(),
      },
      'Remote interface queried successfully',
    );

    return definition;
  }

  /**
   * Get the authentication context for this peer
   * @returns {AuthContext | undefined} The authentication context if authenticated
   */
  getAuthContext(): AuthContext | undefined {
    return this.authContext;
  }

  /**
   * Set the authentication context for this peer
   * @param {AuthContext} context - The authentication context to set
   */
  setAuthContext(context: AuthContext): void {
    this.authContext = context;
    this.logger.info(
      { userId: context.userId, roles: context.roles },
      'Authentication context set for peer',
    );
  }

  /**
   * Clear the authentication context for this peer
   */
  clearAuthContext(): void {
    this.authContext = undefined;
    this.logger.info('Authentication context cleared for peer');
  }

  /**
   * Check if this peer is authenticated
   * @returns {boolean} True if the peer has an authentication context
   */
  isAuthenticated(): boolean {
    return this.authContext !== undefined;
  }
}
