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
import { Abilities, NetronOptions, EventSubscriber, ServiceMetadata, ServiceExposeEvent, ServiceUnexposeEvent } from './types';
import {
  REQUEST_TIMEOUT,
  SERVICE_ANNOTATION,
  NETRON_EVENT_SERVICE_EXPOSE,
  NETRON_EVENT_SERVICE_UNEXPOSE,
} from './constants';
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
 */
export class RemotePeer extends AbstractPeer {
  private events = new EventEmitter();

  private responseHandlers = new TimedMap<
    number,
    { successHandler: (response: Packet) => void; errorHandler?: (data: any) => void }
  >(this.netron.options?.requestTimeout ?? REQUEST_TIMEOUT, (packetId: number) => {
    const handlers = this.deleteResponseHandler(packetId);
    if (handlers?.errorHandler) {
      handlers.errorHandler(new Error('Request timeout exceeded'));
    }
  });
  public writableStreams = new Map<number, NetronWritableStream>();
  public readableStreams = new Map<number, NetronReadableStream>();
  public eventSubscribers = new Map<string, EventSubscriber[]>();
  public remoteSubscriptions = new Map<string, EventSubscriber>();
  public services = new Map<string, Definition>();
  public definitions = new Map<string, Definition>();

  /**
   * Creates an instance of RemotePeer.
   * @param {WebSocket} socket - The WebSocket connection.
   * @param {Netron} netron - The Netron instance.
   * @param {string} [id=""] - The unique identifier of the remote peer.
   */
  constructor(
    private socket: WebSocket,
    netron: Netron,
    id: string = ''
  ) {
    super(netron, id);
  }

  /**
   * Initializes the remote peer.
   * @param {boolean} [isConnector] - Indicates if the peer is a connector.
   * @param {NetronOptions} [options] - The options of the local netron.
   */
  async init(isConnector?: boolean, options?: NetronOptions) {
    this.socket.on('message', (data: ArrayBuffer, isBinary: boolean) => {
      if (isBinary) {
        try {
          this.handlePacket(decodePacket(data));
        } catch (error) {
          console.error('Packet decode error:', error);
        }
      } else {
        console.warn('Received non-binary message:', data);
      }
    });

    if (isConnector) {
      this.abilities = (await this.runTask('abilities', this.netron.peer.abilities)) as Abilities;
      if (this.abilities.services) {
        for (const [name, definition] of this.abilities.services) {
          this.definitions.set(definition.id, definition);
          this.services.set(name, definition);
        }
      }
      if (this.abilities.allowServiceEvents) {
        await this.subscribe(NETRON_EVENT_SERVICE_EXPOSE, (event: ServiceExposeEvent) => {
          this.definitions.set(event.definition.id, event.definition);
          this.services.set(event.qualifiedName, event.definition);
        });
        await this.subscribe(NETRON_EVENT_SERVICE_UNEXPOSE, (event: ServiceUnexposeEvent) => {
          this.definitions.delete(event.defId);
          this.services.delete(event.qualifiedName);
        });
      }
    }
  }

  /**
   * Exposes a service to the remote peer.
   * @param {any} instance - The service instance to expose.
   * @returns {Promise<Definition>} The service definition.
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
    // this.definitions.set(def.id, def);
    this.netron.peer.stubs.set(def.id, stub);
    this.netron.peer.serviceInstances.set(instance, stub);

    return def;
  }

  /**
   * Unexposes a service from the remote peer.
   * @param {string} serviceName - The name of the service to unexpose.
   */
  async unexposeService(serviceName: string) {
    const defId = await this.runTask('unexpose_service', serviceName);
    for (const i of this.interfaces.values()) {
      if (i.instance.$def?.parentId === defId) {
        this.releaseInterface(i.instance);
      }
    }

    const stub = this.netron.peer.stubs.get(defId);
    if (stub) {
      this.netron.peer.serviceInstances.delete(stub.instance);
      this.netron.peer.stubs.delete(defId);
    }
  }

  /**
   * Subscribes to an event.
   * @param {string} eventName - The name of the event to subscribe to.
   * @param {EventSubscriber} handler - The event handler.
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
   * @param {string} eventName - The name of the event to unsubscribe from.
   * @param {EventSubscriber} handler - The event handler.
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
   * Gets the names of all services.
   * @returns {string[]} The names of all services.
   */
  getServiceNames() {
    return [...this.services.keys()];
  }

  /**
   * Gets a value from a service definition.
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
   * @param {string} defId - The unique identifier of the service definition.
   * @param {string} name - The name of the value to set.
   * @param {any} value - The value to set.
   * @returns {Promise<void>}
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
   * Calls a method in a service definition.
   * @param {string} defId - The unique identifier of the service definition.
   * @param {string} method - The name of the method to call.
   * @param {any[]} args - The arguments to pass to the method.
   * @returns {Promise<any>} The result of the method call.
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
   * Disconnects the remote peer.
   */
  disconnect() {
    this.events.emit('manual-disconnect');

    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    } else {
      console.warn(`Attempt to close WebSocket in unexpected state: ${this.socket.readyState}`);
    }
    this.cleanup();
  }

  once(event: 'manual-disconnect' | 'stream', listener: (...args: any[]) => void) {
    this.events.once(event, listener);
  }

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
   * Runs a task on the remote peer.
   * @param {string} name - The name of the task to run.
   * @param {...any[]} args - The arguments to pass to the task.
   * @returns {Promise<any>} The result of the task.
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
   * @param {PacketType} type - The type of the packet.
   * @param {any} data - The data to send.
   * @param {(response: Packet) => void} successHandler - The success handler.
   * @param {(data: any) => void} [errorHandler] - The error handler.
   * @returns {Promise<void>}
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
   * Sends a response to the remote peer.
   * @param {Packet} packet - The packet to send.
   * @param {any} data - The data to send.
   * @returns {Promise<void>}
   */
  private sendResponse(packet: Packet, data: any) {
    packet.setImpulse(0);
    packet.data = data;
    return this.sendPacket(packet);
  }

  /**
   * Sends an error response to the remote peer.
   * @param {Packet} packet - The packet to send.
   * @param {any} error - The error to send.
   * @returns {Promise<void>}
   */
  private sendErrorResponse(packet: Packet, error: any) {
    packet.setImpulse(0);
    packet.setError(1);
    packet.data = error;
    return this.sendPacket(packet);
  }

  /**
   * Sends a packet to the remote peer.
   * @param {Packet} packet - The packet to send.
   * @returns {Promise<void>}
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
   * @param {number} streamId - The ID of the stream.
   * @param {any} chunk - The data chunk to send.
   * @param {number} index - The index of the chunk.
   * @param {StreamType} streamType - The type of the stream.
   */
  sendStreamChunk(streamId: number, chunk: any, index: number, isLast: boolean, isLive: boolean) {
    return this.sendPacket(createStreamPacket(Packet.nextId(), streamId, index, isLast, isLive, chunk));
  }

  /**
   * Handles a response packet from the remote peer.
   * @param {Packet} packet - The packet to handle.
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
   * Handles a packet from the remote peer.
   * @param {Packet} packet - The packet to handle.
   */
  async handlePacket(packet: Packet) {
    const pType = packet.getType();

    if (packet.getImpulse() === 0) {
      this.handleResponse(packet);
      return;
    }

    switch (pType) {
      case TYPE_SET: {
        const [defId, name, value] = packet.data;

        try {
          const stub = this.netron.peer.getStubByDefinitionId(defId);
          await stub.set(name, value);
          await this.sendResponse(packet, undefined);
        } catch (err: any) {
          console.error('Error setting value:', err);
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_: any) {
            console.error('Error sending error response:', err_);
          }
        }
        break;
      }
      case TYPE_GET: {
        const [defId, name] = packet.data;

        try {
          const stub = this.netron.peer.getStubByDefinitionId(defId);
          await this.sendResponse(packet, await stub.get(name));
        } catch (err: any) {
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_) {
            console.error('Error sending error response:', err_);
          }
        }
        break;
      }
      case TYPE_CALL: {
        const [defId, method, ...args] = packet.data;

        try {
          const stub = this.netron.peer.getStubByDefinitionId(defId);
          await this.sendResponse(packet, await stub.call(method, args));
        } catch (err: any) {
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_) {
            console.error('Error sending error response:', err_);
          }
        }
        break;
      }
      case TYPE_TASK: {
        const [name, ...args] = packet.data;
        try {
          await this.sendResponse(packet, await this.netron.runTask(this, name, ...args));
        } catch (err: any) {
          try {
            await this.sendErrorResponse(packet, err);
          } catch (err_) {
            console.error('Error sending error response:', err_);
          }
        }
        break;
      }
      case TYPE_STREAM: {
        if (!packet.streamId) return;

        let stream = this.readableStreams.get(packet.streamId);
        if (!stream) {
          stream = NetronReadableStream.create(this, packet.streamId, packet.isLive());
          this.events.emit('stream', stream);
        }

        stream.onPacket(packet);
        break;
      }
      case TYPE_STREAM_ERROR: {
        const { streamId, message } = packet.data;
        const stream = this.readableStreams.get(streamId);
        if (stream) {
          stream.destroy(new Error(message));
        }
        break;
      }
      default: {
        console.warn('Unknown packet type:', pType);
      }
    }
  }

  /**
   * Releases an interface instance.
   * @param {Interface} iInstance - The interface instance to release.
   */
  protected async releaseInterfaceInternal(iInstance: Interface) {
    await this.runTask('unref_service', iInstance.$def?.id);
    this.unrefService(iInstance.$def?.id);
  }

  /**
   * References a service definition.
   * @param {Definition} def - The service definition to reference.
   * @param {Definition} parentDef - The parent service definition.
   * @returns {Definition} The referenced service definition.
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
   * Unreferences a service definition.
   * @param {string} [defId] - The unique identifier of the service definition to unreference.
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
   * Processes the result of a service call.
   * @param {Definition} parentDef - The parent service definition.
   * @param {any} result - The result to process.
   * @returns {any} The processed result.
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
   * @param {Definition} ctxDef - The context service definition.
   * @param {any} args - The arguments to process.
   * @returns {any} The processed arguments.
   */
  private processArgs(ctxDef: Definition, args: any) {
    return args;
  }

  /**
   * Deletes a response handler.
   * @param {number} packetId - The unique identifier of the packet.
   * @returns {any} The deleted response handler.
   */
  private deleteResponseHandler(packetId: number) {
    const handlers = this.responseHandlers.get(packetId);
    if (handlers) {
      this.responseHandlers.delete(packetId);
    }
    return handlers;
  }

  /**
   * Gets a service definition by its unique identifier.
   * @param {string} defId - The unique identifier of the service definition.
   * @returns {Definition} The service definition.
   * @throws {Error} If the service definition is not found.
   */
  protected getDefinitionById(defId: string) {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Unknown definition: ${defId}.`);
    }
    return def;
  }

  /**
   * Gets a service definition by its name.
   * @param {string} name - The name of the service.
   * @returns {Definition} The service definition.
   * @throws {Error} If the service definition is not found.
   */
  protected getDefinitionByServiceName(name: string) {
    const def = this.services.get(name);
    if (def === void 0) {
      throw new Error(`Unknown service: ${name}.`);
    }
    return def;
  }
}
