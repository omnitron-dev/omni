/**
 * HTTP-specific RemotePeer implementation for stateless connections
 * This class provides optimized handling for HTTP transport without
 * maintaining persistent state or requiring handshakes.
 */

import { EventEmitter } from 'events';
import { AbstractPeer } from './abstract-peer.js';
import type { Netron } from './netron.js';
import type { ITransportConnection } from './transport/types.js';
import type { ILogger } from '../modules/logger/logger.types.js';
import { Definition } from './definition.js';
import type {
  Abilities,
  NetronOptions,
  EventSubscriber,
} from './types.js';


import {
  Packet,
  TYPE_CALL,
  TYPE_TASK,
  TYPE_GET,
  TYPE_SET,
  createPacket,
  encodePacket,
  decodePacket,
} from './packet/index.js';

/**
 * HTTP Remote Peer - A stateless implementation for HTTP transport
 *
 * This peer implementation is optimized for HTTP's stateless nature:
 * - No handshake required
 * - No persistent connection state
 * - Direct service queries via HTTP endpoints
 * - Efficient resource usage for stateless operations
 */
export class HttpRemotePeer extends AbstractPeer {
  public logger: ILogger;

  /** HTTP connection (stateless) */
  private connection: ITransportConnection;

  /** Address of the remote HTTP server */
  public address: string;

  /** Service definitions cached from discovery */
  public services = new Map<string, Definition>();

  /** Definition cache */
  private definitions = new Map<string, Definition>();

  /** Cached abilities from the remote peer */
  private cachedAbilities: Abilities | null = null;

  /** Event emitter for internal events */
  private events = new EventEmitter();

  /** Service names exposed */
  private serviceNames = new Set<string>();

  constructor(connection: ITransportConnection, netron: Netron, address: string) {
    // For HTTP, we use a deterministic ID based on the address
    const id = `http-peer-${new URL(address).host}`;
    super(netron, id);
    this.connection = connection;
    this.address = address;
    this.logger = netron.logger.child({ component: 'HttpRemotePeer', address });
  }

  /**
   * Initialize the HTTP peer (no-op for stateless connections)
   * HTTP doesn't require initialization handshakes
   */
  async init(isClient: boolean, options?: NetronOptions): Promise<void> {
    this.logger.debug('HTTP peer initialized (stateless mode)');
    // No initialization required for HTTP
    // Services are discovered on-demand
  }

  /**
   * Set a property value on the remote peer
   * @param defId Definition ID
   * @param name Property name
   * @param value Property value
   */
  override async set(defId: string, name: string, value: any): Promise<void> {
    const packet = createPacket(Date.now(), 1, TYPE_SET, { defId, name, value });
    await this.sendRequestPacket(packet);
  }

  /**
   * Get a property value from the remote peer
   * @param defId Definition ID
   * @param name Property name
   */
  override async get(defId: string, name: string): Promise<any> {
    const packet = createPacket(Date.now(), 1, TYPE_GET, { defId, name });
    const response = await this.sendRequestPacket(packet);
    return response.data;
  }

  /**
   * Call a method on the remote peer
   * @param defId Definition ID
   * @param method Method name
   * @param args Method arguments
   */
  override async call(defId: string, method: string, args: any[]): Promise<any> {
    const packet = createPacket(Date.now(), 1, TYPE_CALL, { defId, method, args });
    const response = await this.sendRequestPacket(packet);
    return response.data;
  }

  /**
   * Subscribe to events (not supported for stateless HTTP)
   * @param eventName Event name
   * @param handler Event handler
   */
  override async subscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    this.logger.warn({ eventName }, 'Event subscription not supported over HTTP transport');
    // HTTP doesn't support real-time event subscriptions
    // Could be implemented with polling or SSE in the future
  }

  /**
   * Unsubscribe from events (no-op for HTTP)
   * @param eventName Event name
   * @param handler Event handler
   */
  override async unsubscribe(eventName: string, handler: EventSubscriber): Promise<void> {
    // No-op for HTTP
  }

  /**
   * Expose a service (not supported for HTTP client)
   * @param instance Service instance
   */
  override async exposeService(instance: any): Promise<Definition> {
    throw new Error('Service exposure not supported from HTTP client');
  }

  /**
   * Unexpose a service (not supported for HTTP client)
   * @param ctxId Context ID
   * @param releaseOriginated Whether to release originated services
   */
  override async unexposeService(ctxId: string, releaseOriginated?: boolean): Promise<void> {
    // No-op for HTTP client
  }

  /**
   * Get service names
   */
  override getServiceNames(): string[] {
    return Array.from(this.serviceNames);
  }

  /**
   * Override queryInterface to work with HTTP discovery
   */
  override async queryInterface<T>(qualifiedName: string): Promise<T> {
    let name: string;
    let version: string | undefined;

    if (qualifiedName.includes('@')) {
      [name, version] = qualifiedName.split('@') as [string, string | undefined];
    } else {
      name = qualifiedName;
      version = '*';
    }

    // Check if interface already exists
    const interfaceEntry = this.interfaces.get(name);
    if (interfaceEntry) {
      interfaceEntry.refCount++;
      return interfaceEntry.instance as T;
    }

    try {
      // For HTTP connections, we directly get a proxy object from the connection
      // The HttpClientConnection handles all the HTTP-specific logic
      const proxy = await (this.connection as any).queryInterface(name);

      if (proxy) {
        // For HTTP, we return the proxy directly since it already handles all method calls
        // We still track it for reference counting
        this.interfaces.set(name, { instance: proxy as any, refCount: 1 });
        return proxy as T;
      }
    } catch (error) {
      this.logger.error({ error, serviceName: name }, 'Failed to query interface');
    }

    throw new Error(`Service ${qualifiedName} not found`);
  }

  /**
   * Query abilities from the remote peer (cached for efficiency)
   */
  async queryAbilities(): Promise<Abilities> {
    if (this.cachedAbilities) {
      return this.cachedAbilities;
    }

    try {
      // Send abilities query task
      const packet = createPacket(Date.now(), 1, TYPE_TASK, {
        task: 'abilities',
        payload: {}
      });

      const response = await this.sendRequestPacket(packet);
      this.cachedAbilities = response.data as Abilities;
      return this.cachedAbilities;
    } catch (error) {
      this.logger.error({ error }, 'Failed to query abilities');
      // Return default abilities on error
      return {
        services: new Map<string, Definition>(),
        allowServiceEvents: false
      };
    }
  }

  /**
   * Execute a task on the remote peer
   */
  async executeTask<T = any>(task: string, payload: any): Promise<T> {
    const packet = createPacket(Date.now(), 1, TYPE_TASK, { task, payload });
    const response = await this.sendRequestPacket(packet);
    return response.data as T;
  }

  /**
   * Send a packet and wait for response (HTTP request-response pattern)
   */
  private async sendRequestPacket(packet: Packet): Promise<Packet> {
    return new Promise((resolve, reject) => {
      // For HTTP, the connection handles the request-response pattern internally
      const encodedPacket = encodePacket(packet);

      // Create a one-time response handler
      const responseHandler = (data: ArrayBuffer | Buffer) => {
        try {
          const responsePacket = decodePacket(data as Buffer);
          resolve(responsePacket);
        } catch (error) {
          reject(error);
        }
      };

      // Send the packet and listen for response
      this.connection.once('message', responseHandler);
      this.connection.send(encodedPacket);

      // Set timeout for the request
      const timeout = this.netron.options?.requestTimeout ?? 30000;
      setTimeout(() => {
        this.connection.off('message', responseHandler);
        reject(new Error('Request timeout'));
      }, timeout);
    });
  }

  /**
   * Emit event to the peer's event emitter
   */
  emit(event: string | symbol, ...args: any[]): boolean {
    return this.events.emit(event, ...args);
  }

  /**
   * Close the peer connection (cleanup only for HTTP)
   */
  async close(): Promise<void> {
    this.logger.debug('Closing HTTP peer connection');

    // Clear caches
    this.interfaces.clear();
    this.services.clear();
    this.definitions.clear();
    this.cachedAbilities = null;

    // Close the underlying connection
    if (this.connection && typeof this.connection.close === 'function') {
      await this.connection.close();
    }

    this.emit('disconnect');
  }

  /**
   * Check if peer is connected (always true for HTTP during lifecycle)
   */
  get isConnected(): boolean {
    // HTTP connections are considered "connected" as long as the peer exists
    // Each request establishes its own connection if needed
    return true;
  }

  /**
   * Release interface internal (required by AbstractPeer)
   */
  protected async releaseInterfaceInternal(iInstance: any): Promise<void> {
    // No-op for HTTP - interfaces are stateless and don't need cleanup
  }

  /**
   * Get definition by ID (required by AbstractPeer)
   */
  protected getDefinitionById(defId: string): Definition {
    const def = this.definitions.get(defId);
    if (!def) {
      throw new Error(`Definition ${defId} not found`);
    }
    return def;
  }

  /**
   * Get definition by service name (required by AbstractPeer)
   */
  protected getDefinitionByServiceName(name: string): Definition {
    const def = this.services.get(name);
    if (!def) {
      throw new Error(`Service ${name} not found`);
    }
    return def;
  }
}