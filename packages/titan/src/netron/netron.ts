import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from '@omnitron-dev/eventemitter';

import { NetronOptions } from './types.js';
import { LocalPeer } from './local-peer.js';
import { RemotePeer } from './remote-peer.js';
import { HttpRemotePeer } from './http-remote-peer.js';
import { getPeerEventName } from './utils.js';
import { ServiceStub } from './service-stub.js';
import { Task, TaskManager } from './task-manager.js';
import type { ILogger } from '../modules/logger/logger.types.js';
// import { ServiceInfo, ServiceDiscovery } from './service-discovery/index.js';
import { CONNECT_TIMEOUT, NETRON_EVENT_PEER_CONNECT, NETRON_EVENT_PEER_DISCONNECT } from './constants.js';
import { ensureStreamReferenceRegistered } from './packet/serializer.js';

// Import transport layer
import { TransportRegistry } from './transport/transport-registry.js';
import { TransportConnectionFactory } from './transport/transport-adapter.js';
import { WebSocketTransport } from './transport/websocket-transport.js';
import type { ITransport, ITransportServer, ITransportConnection, TransportFactory } from './transport/types.js';

// Import core tasks
import { abilities } from './core-tasks/abilities.js';
import { emit } from './core-tasks/emit.js';
import { expose_service } from './core-tasks/expose-service.js';
import { subscribe } from './core-tasks/subscribe.js';
import { unsubscribe } from './core-tasks/unsubscribe.js';
import { unexpose_service } from './core-tasks/unexpose-service.js';
import { unref_service } from './core-tasks/unref-service.js';

/**
 * The main Netron class that manages WebSocket connections, services, and peer communication.
 * This class serves as the central hub for creating and managing distributed system components.
 * It extends EventEmitter to provide asynchronous event handling capabilities.
 *
 * @class Netron
 * @extends EventEmitter
 * @description Core class for managing distributed system components and peer-to-peer communication
 * @example
 * // Create a new Netron instance
 * const netron = new Netron(logger, {
 *   listenHost: 'localhost',
 *   listenPort: 8080,
 *   discoveryEnabled: true,
 *   discoveryRedisUrl: 'redis://localhost:6379'
 * });
 */
export class Netron extends EventEmitter {
  /**
   * Unique identifier for this Netron instance.
   * Generated automatically using randomUUID() if not provided in options.
   * Used for peer identification and connection management.
   *
   * @type {string}
   * @public
   * @example
   * console.log(netron.id); // '550e8400-e29b-41d4-a716-446655440000'
   */
  public id: string;

  /**
   * Transport server instance for handling incoming connections.
   * Only initialized when running in server mode (when listenHost and listenPort are provided).
   *
   * @type {ITransportServer | undefined}
   * @private
   * @description Manages transport connections and handles the protocol
   */
  private server?: ITransportServer;

  /**
   * Get the transport server instance
   * Used by LocalPeer to register services with HTTP server
   * @returns The transport server if available
   */
  get transportServer(): ITransportServer | undefined {
    return this.server;
  }

  /**
   * Map of special events that need to be processed sequentially.
   * Used to ensure ordered processing of related events and prevent race conditions.
   * Key: event ID, Value: array of {name, data} pairs
   *
   * @type {Map<string, { name: string; data: any }[]>}
   * @private
   * @description Maintains event queue for ordered processing and prevents race conditions
   */
  private ownEvents: Map<string, { name: string; data: any }[]> = new Map();

  /**
   * The local peer instance representing this Netron instance.
   * Used for exposing local services and handling local operations.
   *
   * @type {LocalPeer}
   * @public
   * @description Represents the local node in the distributed network
   */
  public peer: LocalPeer;

  /**
   * Map of connected remote peers.
   * Key: peer ID, Value: RemotePeer instance
   * Used to track and manage all active peer connections.
   *
   * @type {Map<string, RemotePeer>}
   * @public
   * @description Registry of all active peer connections in the network
   */
  public peers: Map<string, RemotePeer> = new Map();

  /**
   * Task manager instance for handling remote task execution.
   * Manages task registration, execution, and timeout handling.
   *
   * @type {TaskManager}
   * @public
   * @description Orchestrates distributed task execution across the network
   */
  public taskManager: TaskManager;

  /**
   * Flag indicating whether the Netron instance has been started.
   * Used to prevent multiple start attempts and ensure proper initialization.
   *
   * @type {boolean}
   * @private
   * @description Prevents multiple initialization attempts and tracks instance state
   */
  private isStarted: boolean = false;

  /**
   * Map of exposed services.
   * Key: qualified service name (name:version), Value: ServiceStub instance
   * Used to track and manage all available services.
   *
   * @type {Map<string, ServiceStub>}
   * @public
   * @description Registry of all available services in the network
   */
  public services = new Map<string, ServiceStub>();

  /**
   * Configuration options for this Netron instance.
   * Contains settings for timeouts, reconnection, and other behaviors.
   *
   * @type {NetronOptions}
   * @public
   * @description Configuration parameters for the Netron instance
   */
  public options: NetronOptions;

  // /**
  //  * Service discovery instance for managing service registration and discovery.
  //  * Only initialized when discovery is enabled in options.
  //  *
  //  * @type {ServiceDiscovery | undefined}
  //  * @public
  //  * @description Manages service discovery and registration in the distributed network
  //  */
  // public discovery?: ServiceDiscovery;

  /**
   * Redis client instance for service discovery.
   * Only initialized when discovery is enabled in options.
   *
   * @type {Redis | undefined}
   * @private
   * @description Redis client for service discovery coordination
   */
  private discoveryRedis?: Redis;

  public logger: ILogger;

  /**
   * Transport registry for managing different transport types.
   * Default transport is WebSocket for backward compatibility.
   *
   * @type {TransportRegistry}
   * @private
   */
  private transportRegistry: TransportRegistry;

  /**
   * Default transport to use for connections.
   *
   * @type {ITransport}
   * @private
   */
  private defaultTransport: ITransport;

  /**
   * Creates a new Netron instance.
   * Initializes the task manager and local peer.
   *
   * @constructor
   * @param {ILogger} logger - Logger instance for Netron
   * @param {NetronOptions} [options] - Configuration options for the Netron instance
   * @throws {Error} If required options are missing or invalid
   * @example
   * const netron = new Netron(logger, {
   *   listenHost: 'localhost',
   *   listenPort: 8080
   * });
   */
  constructor(logger: ILogger, options: NetronOptions = {}) {
    super();

    this.options = options;
    this.id = options.id ?? randomUUID();

    // Store base logger as private field
    (this as any).baseLogger = logger;

    // Create child logger for Netron with context
    this.logger = logger.child({
      module: 'netron',
      netronId: this.id,
      ...(options.loggerContext || {})
    });

    this.taskManager = new TaskManager({
      timeout: options?.taskTimeout,
      overwriteStrategy: options?.taskOverwriteStrategy,
    });

    this.peer = new LocalPeer(this);

    // Initialize transport registry with default WebSocket transport
    this.transportRegistry = new TransportRegistry();
    const wsTransport = new WebSocketTransport();

    // Register transports only if not already registered
    if (!this.transportRegistry.has('ws')) {
      this.transportRegistry.register('ws', () => wsTransport);
    }
    if (!this.transportRegistry.has('wss')) {
      this.transportRegistry.register('wss', () => wsTransport);
    }

    this.defaultTransport = wsTransport;
  }

  /**
   * Register a transport factory
   * @param name - Transport name (e.g., 'http', 'tcp', 'unix')
   * @param factory - Factory function that creates transport instances
   * @param setAsDefault - Whether to set this transport as the default
   */
  registerTransport(name: string, factory: TransportFactory, setAsDefault = false): void {
    this.transportRegistry.register(name, factory);

    if (setAsDefault) {
      const transport = this.transportRegistry.get(name);
      if (transport) {
        this.defaultTransport = transport;
      }
    }
  }

  /**
   * Set the default transport for server operations
   * @param name - Transport name
   */
  setDefaultTransport(name: string): void {
    const transport = this.transportRegistry.get(name);
    if (!transport) {
      throw new Error(`Transport ${name} not registered`);
    }
    this.defaultTransport = transport;
  }

  /**
   * Starts the Netron instance, initializing the WebSocket server and loading tasks.
   * Loads core tasks from the specified directory and sets up the WebSocket server if configured.
   *
   * @method start
   * @async
   * @throws {Error} If Netron is already started
   * @returns {Promise<void>} Resolves when initialization is complete
   * @example
   * await netron.start();
   * console.log('Netron instance started successfully');
   */
  async start() {
    if (this.isStarted) {
      this.logger.warn('Netron instance already started');
      throw new Error('Netron already started');
    }

    this.logger.info('Starting Netron instance');

    // Ensure StreamReference is registered with serializer
    await ensureStreamReferenceRegistered();

    // Register core tasks directly
    this.registerCoreTasks();

    if (!this.options?.listenHost || !this.options?.listenPort) {
      this.logger.info('Netron started in client-only mode');

      // if (this.options.discoveryEnabled && this.options.discoveryRedisUrl) {
      //   this.logger.info('Initializing service discovery in client mode');
      //   await this.initServiceDiscovery(true);
      // }

      this.isStarted = true;
      return Promise.resolve();
    }

    // Create and start transport server
    return this.defaultTransport.createServer!({
      host: this.options?.listenHost,
      port: this.options?.listenPort,
      headers: { 'x-netron-id': this.id }
    } as any).then(async (server) => {
      this.server = server;

      // If this is an HTTP server, set the peer for service invocation
      if (server && typeof (server as any).setPeer === 'function') {
        (server as any).setPeer(this.peer);
      }

      // Register existing services with the transport server
      if (server && typeof (server as any).registerService === 'function') {
        for (const [serviceName, stub] of this.services) {
          const meta = stub.definition.meta;
          const contract = (meta as any).contract || (stub.instance?.constructor as any)?.contract;
          (server as any).registerService(meta.name, stub.definition, contract);
        }
      }

      this.server.on('connection', async (connection: ITransportConnection) => {
        // Extract peer ID from connection or generate new one
        const url = connection.remoteAddress || '';
        const peerId = this.extractPeerIdFromConnection(url) || randomUUID();

        this.logger.info({ peerId, address: connection.remoteAddress }, 'New peer connection');

        // Create RemotePeer with transport adapter for backward compatibility
        const adapter = TransportConnectionFactory.fromConnection(connection);
        const peer = new RemotePeer(adapter as any, this, peerId);
        this.peers.set(peer.id, peer);

        // Send our ID to peer through the adapter (with small delay to ensure client is ready)
        setTimeout(() => {
          adapter.send(Buffer.from(JSON.stringify({ type: 'id', id: this.id })));
        }, 10);

        // Listen for client ID
        adapter.once('message', async (data: Buffer | ArrayBuffer, isBinary?: boolean) => {
          if (!isBinary) {
            try {
              const str = Buffer.isBuffer(data) ? data.toString() : Buffer.from(data).toString();
              const message = JSON.parse(str) as { type: string; id: string };
              if (message.type === 'client-id') {
                // Update peer with actual client ID
                this.peers.delete(peer.id);
                peer.id = message.id;
                this.peers.set(peer.id, peer);
                this.logger.info({ clientId: message.id }, 'Client ID received');

                // Emit connect event after we have the actual client ID
                this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId: peer.id });
              }
            } catch (error) {
              this.logger.error({ error }, 'Error parsing client ID message');
            }
          }
        });

        connection.on('disconnect', () => {
          this.logger.info({ peerId: peer.id }, 'Peer disconnected');
          this.peers.delete(peer.id);
          this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peer.id), { peerId: peer.id });
        });

        await peer.init(false, this.options);
      });

      this.server.on('error', (error: Error) => {
        this.logger.error({ error }, 'Transport server error');
      });

      await this.server.listen();
      this.logger.info(`Netron server started at ${this.options.listenHost}:${this.options.listenPort}`);
      this.isStarted = true;
    });
  }

  // private async initServiceDiscovery(clientMode: boolean): Promise<void> {
  //   this.logger.info('Initializing service discovery');
  //   this.discoveryRedis = new Redis(this.options.discoveryRedisUrl!);
  //   this.discovery = new ServiceDiscovery(
  //     this.discoveryRedis,
  //     this,
  //     clientMode ? '' : `${this.options.listenHost}:${this.options.listenPort}`,
  //     clientMode ? [] : this.getExposedServices(),
  //     {
  //       heartbeatInterval: this.options.discoveryHeartbeatInterval,
  //       heartbeatTTL: this.options.discoveryHeartbeatTTL,
  //       pubSubEnabled: this.options.discoveryPubSubEnabled ?? true,
  //       clientMode,
  //     }
  //   );
  //   this.discovery.startHeartbeat();
  //   await this.discovery.subscribeToEvents((event) => {
  //     this.logger.debug({ event }, 'Service discovery event received');
  //     this.emit('discovery:event', event);
  //   });

  //   this.logger.info(`Service discovery initialized successfully (${clientMode ? 'client mode' : 'server mode'})`);
  // }

  /**
   * Stops the Netron instance, closing the WebSocket server and cleaning up resources.
   * Properly shuts down all connections and services.
   *
   * @method stop
   * @async
   * @returns {Promise<void>} Resolves when shutdown is complete
   * @example
   * await netron.stop();
   */
  async stop() {
    this.logger.info('Stopping Netron instance');

    // Close all peer connections
    for (const peer of this.peers.values()) {
      await peer.close();
    }
    this.peers.clear();

    // Stop transport server
    if (this.server) {
      this.logger.info('Closing transport server');
      await this.server.close();
      this.server = undefined;
    }

    // if (this.discovery) {
    //   this.logger.info('Shutting down service discovery');
    //   await this.discovery.shutdown();
    //   await this.discoveryRedis!.quit();
    //   this.discovery = undefined;
    //   this.discoveryRedis = undefined;
    // }

    this.isStarted = false;
    this.logger.info('Netron instance stopped');
  }

  /**
   * Establishes a WebSocket connection to a remote peer with robust error handling and automatic reconnection.
   * This method implements a sophisticated connection protocol that includes:
   * - Initial connection establishment with timeout protection
   * - Handshake protocol validation
   * - Automatic reconnection with exponential backoff
   * - Connection state tracking and cleanup
   * - Event emission for connection lifecycle events
   *
   * The reconnection mechanism uses an exponential backoff strategy starting at 1 second,
   * doubling each attempt up to a maximum of 30 seconds. The maximum number of attempts
   * can be configured through the Netron options.
   *
   * @method connect
   * @async
   * @param {string} address - The WebSocket URL of the remote peer to connect to
   * @param {boolean} [reconnect=true] - Enables automatic reconnection on connection loss
   * @returns {Promise<RemotePeer>} A promise that resolves to the established RemotePeer instance
   * @throws {Error} When connection fails, times out, or handshake validation fails
   * @example
   * const peer = await netron.connect('ws://example.com:8080');
   */
  async connect(address: string, reconnect = true): Promise<RemotePeer | HttpRemotePeer> {
    this.logger.info({ address, reconnect }, 'Connecting to remote peer');

    // Check if this is an HTTP connection
    const isHttp = address.startsWith('http://') || address.startsWith('https://');

    if (isHttp) {
      // Use optimized HTTP-specific connection flow
      return this.connectHttp(address);
    }

    // Use existing WebSocket/TCP connection flow for other transports
    const baseDelay = 1000;
    let reconnectAttempts = 0;
    let manuallyDisconnected = false;

    const connectPeer = (): Promise<RemotePeer> =>
      new Promise<RemotePeer>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.logger.error({ address }, 'Connection timeout');
          reject(new Error('Connection timeout'));
        }, this.options?.connectTimeout ?? CONNECT_TIMEOUT);

        // Wrap async logic in an IIFE
        (async () => {
          try {
            // Parse address to determine transport type
            const transport = this.getTransportForAddress(address);
            if (!transport) {
              throw new Error(`No suitable transport found for address: ${address}`);
            }

            // Connect using transport
            const connection = await transport.connect(`${address}?id=${this.id}`, {
            ...this.options,
            connectTimeout: this.options?.connectTimeout ?? CONNECT_TIMEOUT,
            headers: { 'x-netron-id': this.id }
          });

          // Create RemotePeer with transport adapter
          const adapter = TransportConnectionFactory.fromConnection(connection);
          const peer = new RemotePeer(adapter as any, this, address);

          let resolved = false;

          // Wait for connection to be established
          connection.once('connect', () => {
            this.logger.debug({ address }, 'Connection established');
            clearTimeout(timeoutId);
          });

          // Handle first message (handshake)
          adapter.once('message', async (data: Buffer | ArrayBuffer, isBinary?: boolean) => {
            try {
              const str = Buffer.isBuffer(data) ? data.toString() : Buffer.from(data).toString();
              const message = JSON.parse(str) as { type: 'id'; id: string };
              if (message.type === 'id') {
                peer.id = message.id;
                this.peers.set(peer.id, peer);

                // Send our ID back to the server
                connection.send(Buffer.from(JSON.stringify({ type: 'client-id', id: this.id })));

                await peer.init(true, this.options);

                peer.once('manual-disconnect', () => {
                  this.logger.info({ peerId: peer.id }, 'Manual disconnect requested');
                  manuallyDisconnected = true;
                });

                connection.once('disconnect', () => {
                  this.logger.info({ peerId: peer.id }, 'Connection closed');
                  this.peers.delete(peer.id);
                  this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peer.id), { peerId: peer.id });

                  if (reconnect && !manuallyDisconnected) {
                    attemptReconnect();
                  }
                });

                resolved = true;
                reconnectAttempts = 0;
                this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId: peer.id });
                this.logger.info({ peerId: peer.id }, 'Peer connection established');
                resolve(peer);
              } else {
                this.logger.warn({ type: message.type }, 'Invalid handshake message type');
                await connection.close();
                reject(new Error('Invalid handshake'));
              }
            } catch (error) {
              this.logger.error({ error }, 'Error parsing handshake message');
              await connection.close();
              reject(error);
            }
          });

          connection.on('error', (err: Error) => {
            this.logger.error({ error: err }, 'Connection error');
            clearTimeout(timeoutId);
            if (!resolved) {
              reject(err);
            }
          });
          } catch (error) {
            clearTimeout(timeoutId);
            reject(error);
          }
        })(); // Execute the async IIFE
      });

    /**
     * Implements the reconnection logic with exponential backoff.
     * This function will attempt to reconnect to the peer with increasing delays
     * between attempts, up to the configured maximum number of attempts.
     */
    const attemptReconnect = () => {
      if (this.options.maxReconnectAttempts && reconnectAttempts >= this.options.maxReconnectAttempts) {
        this.logger.error(`Reconnect attempts exceeded (${this.options.maxReconnectAttempts}). Giving up.`);
        return;
      }

      const delay = Math.min(baseDelay * 2 ** reconnectAttempts, 30000);
      this.logger.info(
        `Reconnecting to ${address} in ${delay} ms (attempt ${reconnectAttempts + 1}/${this.options.maxReconnectAttempts ?? 'unlimited'})...`
      );

      setTimeout(async () => {
        reconnectAttempts++;
        try {
          await connectPeer();
          this.logger.info(`Successfully reconnected to ${address}.`);
        } catch {
          this.logger.warn(
            `Reconnect failed (${reconnectAttempts}/${this.options.maxReconnectAttempts ?? 'unlimited'}):`
          );
          attemptReconnect();
        }
      }, delay);
    };

    return connectPeer();
  }

  /**
   * Connect to an HTTP server (optimized for stateless connections)
   * This method bypasses the WebSocket handshake and creates a stateless HTTP peer.
   *
   * @param address The HTTP/HTTPS URL to connect to
   * @returns HttpRemotePeer configured for stateless operation
   */
  private async connectHttp(address: string): Promise<HttpRemotePeer> {
    this.logger.info({ address }, 'Connecting to HTTP server (stateless mode)');

    try {
      // Get HTTP transport
      const transport = this.getTransportForAddress(address);
      if (!transport) {
        throw new Error(`No HTTP transport registered for address: ${address}`);
      }

      // Connect using HTTP transport - this creates an HttpClientConnection
      const connection = await transport.connect(address, {
        ...this.options,
        headers: { 'x-netron-id': this.id }
      });

      // Create HTTP-specific peer (no handshake needed)
      const peer = new HttpRemotePeer(connection, this, address);

      // Register the peer
      this.peers.set(peer.id, peer as any);

      // Initialize the peer (no-op for HTTP)
      await peer.init(true, this.options);

      // Emit connection event
      this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId: peer.id });
      this.logger.info({ peerId: peer.id, address }, 'HTTP peer connected (stateless)');

      return peer;
    } catch (error) {
      this.logger.error({ error, address }, 'Failed to connect to HTTP server');
      throw error;
    }
  }

  /**
   * Gracefully disconnects a remote peer from the Netron network.
   * This method performs a clean disconnection by:
   * 1. Finding the peer in the active peers map
   * 2. Initiating the disconnect sequence
   * 3. Removing the peer from the active peers registry
   * 4. Emitting a disconnect event to notify other components
   *
   * @param {string} peerId - The unique identifier of the peer to disconnect
   * @returns {void}
   * @throws {Error} If the peer cannot be found or if the disconnect process fails
   * @example
   * netron.disconnect('peer-123');
   */
  disconnect(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.disconnect();
      this.peers.delete(peerId);
      this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peerId), { peerId });
    }
  }

  /**
   * Retrieves a list of all service names currently registered in the Netron network.
   * This method provides a snapshot of all available services at the time of invocation.
   * The returned array is a shallow copy to prevent external modifications to the internal service registry.
   *
   * @returns {string[]} An array containing the qualified names of all registered services
   * @example
   * const services = netron.getServiceNames();
   * console.log('Available services:', services);
   */
  getServiceNames() {
    return [...this.services.keys()];
  }

  /**
   * Registers a new task with the Netron task manager.
   * This method allows for the addition of custom tasks that can be executed
   * across the network. The task function should be designed to be serializable
   * and should handle its own error cases appropriately.
   *
   * @param {Task} fn - The task function to be registered
   * @returns {string} The unique identifier assigned to the newly registered task
   * @throws {Error} If the task registration fails or if the task function is invalid
   * @example
   * const taskId = netron.addTask(async (data) => {
   *   // Task implementation
   *   return processedData;
   * });
   */
  addTask(fn: Task) {
    return this.taskManager.addTask(fn);
  }

  /**
   * Executes a task on a specified remote peer.
   * This method handles the orchestration of remote task execution, including:
   * - Task serialization and transmission
   * - Result collection and deserialization
   * - Error handling and propagation
   *
   * @param {RemotePeer} peer - The remote peer instance where the task should be executed
   * @param {string} name - The name of the task to execute
   * @param {...any} args - Variable number of arguments to be passed to the task
   * @returns {Promise<any>} A promise that resolves with the task execution result
   * @throws {Error} If the task execution fails or if the peer is unavailable
   * @example
   * const result = await netron.runTask(peer, 'processData', data);
   */
  async runTask(peer: RemotePeer, name: string, ...args: any[]) {
    return await this.taskManager.runTask(name, peer, ...args);
  }

  /**
   * Registers core Netron tasks that handle essential functionality.
   * This includes service discovery, event handling, and stream management.
   *
   * @private
   */
  private registerCoreTasks(): void {
    this.logger.debug('Registering core tasks');

    // Register each core task
    this.taskManager.addTask(abilities as Task);
    this.taskManager.addTask(emit as Task);
    this.taskManager.addTask(expose_service as Task);
    this.taskManager.addTask(subscribe as Task);
    this.taskManager.addTask(unsubscribe as Task);
    this.taskManager.addTask(unexpose_service as Task);
    this.taskManager.addTask(unref_service as Task);

    this.logger.debug('Core tasks registered successfully');
  }

  /**
   * Helper method to get the appropriate transport for a given address.
   * @private
   * @param {string} address - The address to connect to
   * @returns {ITransport | undefined} The transport instance or undefined
   */
  private getTransportForAddress(address: string): ITransport {
    // Parse protocol from address
    const protocolMatch = address.match(/^(\w+):\/\//);
    if (!protocolMatch) {
      return this.defaultTransport;
    }

    const protocol = protocolMatch[1]!; // Protocol is guaranteed to exist if regex matches
    const transport = this.transportRegistry.getByProtocol(protocol);
    return transport ?? this.defaultTransport;
  }

  /**
   * Helper method to extract peer ID from connection URL.
   * @private
   * @param {string} url - The connection URL
   * @returns {string | undefined} The peer ID or undefined
   */
  private extractPeerIdFromConnection(url: string): string | undefined {
    if (!url) return undefined;

    try {
      const urlObj = new URL(url, 'ws://localhost');
      return urlObj.searchParams.get('id') || undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * Removes special events associated with a specific ID from the event queue.
   * This method is used to clean up event queues when they are no longer needed
   * or when the associated operation has been completed or cancelled.
   *
   * @param {string} id - The unique identifier of the events to be removed
   * @returns {void}
   * @example
   * netron.deleteSpecialEvents('operation-123');
   */
  deleteSpecialEvents(id: string) {
    this.ownEvents.delete(id);
  }

  /**
   * Emits a special event with guaranteed sequential processing.
   * This method implements a sophisticated event emission system that:
   * 1. Queues events for sequential processing
   * 2. Implements a timeout mechanism for event processing
   * 3. Handles error cases gracefully
   * 4. Ensures proper cleanup of event queues
   *
   * The method maintains event order and prevents race conditions by processing
   * events in a first-in-first-out manner with a maximum processing time of 5 seconds.
   *
   * @param {string} event - The name of the event to emit
   * @param {string} id - The unique identifier for this event sequence
   * @param {any} data - The data payload to be emitted with the event
   * @returns {Promise<void>} A promise that resolves when event processing is complete
   * @throws {Error} If event processing times out or fails
   */
  async emitSpecial(event: string, id: string, data: any) {
    const events = this.ownEvents.get(id) || [];
    events.push({ name: event, data });
    this.ownEvents.set(id, events);

    if (events.length > 1) {
      return;
    }

    while (events.length > 0) {
      const eventData = events.shift();
      if (eventData === void 0) {
        break;
      }
      try {
        const timeoutPromise = new Promise((_, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error(`Emit timeout for event: ${eventData.name}`));
          }, 5000);
          this.emitParallel(eventData.name, eventData.data)
            .finally(() => clearTimeout(timeoutId))
            .catch(reject);
        });

        await timeoutPromise;
      } catch (err: any) {
        this.logger.error(`Event emit error: ${err.message}`);
      }
    }

    this.ownEvents.delete(id);
  }

  /**
   * Creates and initializes a new Netron instance.
   * This factory method provides a convenient way to create and start a Netron
   * instance in a single operation. It handles the complete initialization
   * sequence, including:
   * - Instance creation with provided options
   * - Network initialization
   * - Service registration
   * - Event system setup
   *
   * @param {NetronOptions} [options] - Optional configuration parameters for the Netron instance
   * @returns {Promise<Netron>} A promise that resolves with the initialized Netron instance
   * @throws {Error} If initialization fails or if required resources are unavailable
   */
  /**
   * Creates and starts a new Netron instance.
   * This is a convenience method for standalone usage outside of DI container.
   *
   * @param options - Configuration options
   * @param logger - Logger instance (required for standalone usage)
   * @returns Promise<Netron> - Started Netron instance
   */
  static async create(logger: ILogger, options?: NetronOptions) {
    // Create Netron with provided logger
    const netron = new Netron(logger, options || {});
    await netron.start();
    return netron;
  }

  // /**
  //  * Retrieves a list of all services currently exposed by this Netron instance.
  //  * This method provides a standardized way to access service metadata for discovery
  //  * and registration purposes. The returned information includes both service names
  //  * and versions, which are essential for service matching and version compatibility.
  //  *
  //  * @method getExposedServices
  //  * @public
  //  * @returns {ServiceInfo[]} An array of ServiceInfo objects containing:
  //  *                         - name: The unique identifier of the service
  //  *                         - version: The semantic version of the service
  //  *
  //  * @example
  //  * // Get all exposed services
  //  * const services = netron.getExposedServices();
  //  * // Result: [{ name: 'auth', version: '1.0.0' }, { name: 'storage', version: '2.1.0' }]
  //  *
  //  * @remarks
  //  * This method is primarily used by the service discovery system to:
  //  * 1. Register services with the discovery mechanism
  //  * 2. Provide service information to connecting peers
  //  * 3. Enable service version compatibility checking
  //  *
  //  * The returned array is derived from the internal services Map, ensuring that
  //  * the information is always up-to-date with the current service registry.
  //  */
  // public getExposedServices(): ServiceInfo[] {
  //   return Array.from(this.services.values()).map((stub) => ({
  //     name: stub.definition.meta.name,
  //     version: stub.definition.meta.version,
  //   }));
  // }
}
