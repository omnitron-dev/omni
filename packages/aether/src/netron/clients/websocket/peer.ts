/**
 * Browser Remote Peer - Client-Only Implementation
 *
 * This is a simplified, browser-compatible version of RemotePeer from Titan.
 * Contains ONLY client methods - no server-side functionality.
 */

import { EventEmitter } from '@omnitron-dev/eventemitter';
import { TimedMap } from '@omnitron-dev/common';

import { Definition } from '../../definition.js';
import { BrowserWebSocketConnection } from './client.js';
import {
  Packet,
  TYPE_GET,
  TYPE_SET,
  TYPE_CALL,
  TYPE_TASK,
  TYPE_STREAM,
  createPacket,
} from '../../packet/index.js';
import { REQUEST_TIMEOUT } from '../../constants.js';

/**
 * Simple logger interface for browser
 */
interface SimpleLogger {
  debug(...args: any[]): void;
  info(...args: any[]): void;
  warn(...args: any[]): void;
  error(...args: any[]): void;
}

/**
 * Event subscriber type
 */
export type EventSubscriber = (data: any) => void | Promise<void>;

/**
 * Browser Remote Peer - represents connection to Titan server
 */
export class WebSocketRemotePeer extends EventEmitter {
  public id: string;
  private logger: SimpleLogger;
  private connection: BrowserWebSocketConnection;

  /**
   * Map of response handlers for pending requests
   */
  private responseHandlers: TimedMap<
    number,
    { successHandler: (response: any) => void; errorHandler?: (data: any) => void }
  >;

  /** Map of service definitions indexed by definition ID */
  public definitions = new Map<string, Definition>();

  /** Map of event subscribers indexed by event name */
  public eventSubscribers = new Map<string, EventSubscriber[]>();

  /**
   * Creates a new Browser Remote Peer
   */
  constructor(
    connection: BrowserWebSocketConnection,
    id: string = '',
    logger?: SimpleLogger,
    requestTimeout?: number
  ) {
    super();
    this.connection = connection;
    this.id = id;
    this.logger = logger || console;

    // Initialize response handlers with timeout
    this.responseHandlers = new TimedMap<
      number,
      { successHandler: (response: any) => void; errorHandler?: (data: any) => void }
    >(requestTimeout ?? REQUEST_TIMEOUT, (packetId: number) => {
      const handlers = this.responseHandlers.get(packetId);
      if (handlers?.errorHandler) {
        handlers.errorHandler(new Error('Request timeout exceeded'));
      }
      this.responseHandlers.delete(packetId);
    });
  }

  /**
   * Initialize the peer connection
   */
  async init(): Promise<void> {
    this.logger.info('Initializing browser remote peer');

    // Setup packet handler
    this.connection.on('packet', (packet: Packet) => {
      this.handlePacket(packet);
    });

    // Setup disconnect handler
    this.connection.on('disconnect', () => {
      this.cleanup();
    });
  }

  /**
   * Subscribe to an event from the remote peer
   */
  async subscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    const handlers = this.eventSubscribers.get(eventName);
    if (!handlers) {
      this.eventSubscribers.set(eventName, [handler]);
      await this.runTask('subscribe', eventName);
    } else if (!handlers.includes(handler)) {
      handlers.push(handler);
    }
  }

  /**
   * Unsubscribe from an event
   */
  async unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> {
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
   * Get a value from a service definition
   */
  get(defId: string, name: string): Promise<any> {
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
   * Set a value in a service definition
   */
  set(defId: string, name: string, value: any): Promise<void> {
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
   * Call a method on a service definition
   */
  call(defId: string, method: string, args: any[]): Promise<any> {
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
   * Disconnect from the remote peer
   */
  async disconnect(): Promise<void> {
    this.logger.info('Disconnecting browser remote peer');
    await this.connection.disconnect();
    this.cleanup();
  }

  /**
   * Execute a task on the remote peer
   */
  runTask(name: string, ...args: any[]): Promise<any> {
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
   * Send a request to the remote peer
   */
  private async sendRequest(
    type: number,
    data: any,
    successHandler: (response: any) => void,
    errorHandler?: (data: any) => void
  ): Promise<void> {
    const packet = createPacket(Packet.nextId(), 1, type, data);
    this.responseHandlers.set(packet.id, {
      successHandler,
      errorHandler,
    });

    await this.sendPacket(packet);
  }

  /**
   * Send a packet to the remote peer
   */
  private async sendPacket(packet: Packet): Promise<void> {
    if (!this.connection.isConnected()) {
      throw new Error('Connection is not open');
    }

    await this.connection.sendPacket(packet);
  }

  /**
   * Handle incoming packets
   */
  private handlePacket(packet: Packet): void {
    this.logger.debug('Handling packet:', packet.getType());

    // If it's a response (impulse = 0), handle it
    if (packet.getImpulse() === 0) {
      this.handleResponse(packet);
      return;
    }

    // Client only needs to handle stream packets from server
    const pType = packet.getType();
    if (pType === TYPE_STREAM) {
      // Handle incoming stream data
      this.emit('stream', packet);
    }
  }

  /**
   * Handle a response packet
   */
  private handleResponse(packet: Packet): void {
    const id = packet.id;
    const handlers = this.responseHandlers.get(id);

    if (handlers) {
      this.responseHandlers.delete(id);
      const data = packet.data;

      if (packet.getError() === 0) {
        handlers.successHandler(data);
      } else {
        handlers.errorHandler?.(data);
      }
    }
  }

  /**
   * Process arguments before sending
   */
  private processArgs(def: Definition, args: any[]): any[] {
    // In browser, we don't need complex processing
    // Just return args as-is
    // TODO: Add stream reference processing if needed
    return args;
  }

  /**
   * Process result after receiving
   */
  private processResult(def: Definition, result: any): any {
    // In browser, we don't need complex processing
    // Just return result as-is
    // TODO: Add service definition unwrapping if needed
    return result;
  }

  /**
   * Reference a service definition
   */
  refService(def: Definition, parentDef?: Definition): Definition {
    const existingDef = this.definitions.get(def.id);
    if (existingDef) {
      return existingDef;
    }

    if (parentDef) {
      def.parentId = parentDef.id;
    }
    this.definitions.set(def.id, def);
    return def;
  }

  /**
   * Clean up resources
   */
  private cleanup(): void {
    this.responseHandlers.clear();
    this.eventSubscribers.clear();
    this.definitions.clear();
  }
}
