import path from 'node:path';
import { Logger } from 'pino';
import { Redis } from 'ioredis';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { EventEmitter } from '@omnitron-dev/eventemitter';

import { NetronOptions } from './types.js';
import { LocalPeer } from './local-peer.js';
import { RemotePeer } from './remote-peer.js';
import { getPeerEventName } from './utils.js';
import { ServiceStub } from './service-stub.js';
import LoggerFactory from './logging/logger.js';
import { Task, TaskManager } from './task-manager.js';
import { ServiceInfo, ServiceDiscovery } from './service-discovery/index.js';
import { CONNECT_TIMEOUT, NETRON_EVENT_PEER_CONNECT, NETRON_EVENT_PEER_DISCONNECT } from './constants.js';
import { ensureStreamReferenceRegistered } from './packet/serializer.js';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
 * const netron = await Netron.create({
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
   * WebSocket server instance for handling incoming connections.
   * Only initialized when running in server mode (when listenHost and listenPort are provided).
   *
   * @type {WebSocketServer | undefined}
   * @private
   * @description Manages WebSocket connections and handles the WebSocket protocol
   */
  private wss?: WebSocketServer;

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

  /**
   * Service discovery instance for managing service registration and discovery.
   * Only initialized when discovery is enabled in options.
   *
   * @type {ServiceDiscovery | undefined}
   * @public
   * @description Manages service discovery and registration in the distributed network
   */
  public discovery?: ServiceDiscovery;

  /**
   * Redis client instance for service discovery.
   * Only initialized when discovery is enabled in options.
   *
   * @type {Redis | undefined}
   * @private
   * @description Redis client for service discovery coordination
   */
  private discoveryRedis?: Redis;

  public logger: Logger;

  /**
   * Creates a new Netron instance with the specified options.
   * Initializes the task manager and local peer.
   *
   * @constructor
   * @param {NetronOptions} [options] - Configuration options for the Netron instance
   * @throws {Error} If required options are missing or invalid
   * @example
   * const netron = new Netron({
   *   id: 'custom-id',
   *   taskTimeout: 5000,
   *   taskOverwriteStrategy: 'replace'
   * });
   */
  constructor(options?: NetronOptions) {
    super();

    this.options = options ?? {};
    this.id = options?.id ?? randomUUID();

    if (options?.loggerOptions || options?.loggerDestination) {
      LoggerFactory.initLogger(options.loggerOptions || {}, options.loggerDestination);
    }
    this.logger = LoggerFactory.getLogger(options?.loggerContext);

    this.taskManager = new TaskManager({
      timeout: options?.taskTimeout,
      overwriteStrategy: options?.taskOverwriteStrategy,
    });

    this.peer = new LocalPeer(this);
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

    // Try to load from dist/core-tasks first (for tests), then from __dirname/core-tasks
    let coreTasksPath = path.join(__dirname, '..', 'dist', 'core-tasks');
    try {
      await this.taskManager.loadTasksFromDir(coreTasksPath);
      this.logger.debug({ coreTasksPath }, 'Loaded core tasks from dist');
    } catch {
      // Fallback to __dirname/core-tasks
      coreTasksPath = path.join(__dirname, 'core-tasks');
      this.logger.debug({ coreTasksPath }, 'Loading core tasks from source');
      await this.taskManager.loadTasksFromDir(coreTasksPath);
    }

    if (!this.options?.listenHost || !this.options?.listenPort) {
      this.logger.info('Netron started in client-only mode');

      if (this.options.discoveryEnabled && this.options.discoveryRedisUrl) {
        this.logger.info('Initializing service discovery in client mode');
        await this.initServiceDiscovery(true);
      }

      this.isStarted = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({
        host: this.options?.listenHost,
        port: this.options?.listenPort,
      });

      this.wss.on('listening', async () => {
        this.logger.info(`Netron server started at ${this.options.listenHost}:${this.options.listenPort}`);
        this.isStarted = true;

        if (this.options.discoveryEnabled && this.options.discoveryRedisUrl) {
          await this.initServiceDiscovery(false);
        }

        resolve();
      });

      this.wss.on('error', (err) => {
        this.logger.error({ error: err }, 'WebSocket server error');
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const peerId = new URL(req.url!, 'ws://localhost').searchParams.get('id');
        if (!peerId) {
          this.logger.warn('Connection attempt without peer ID, closing');
          ws.close();
          return;
        }
        this.logger.info({ peerId }, 'New peer connection');
        const peer = new RemotePeer(ws, this, peerId);
        this.peers.set(peer.id, peer);

        ws.send(JSON.stringify({ type: 'id', id: this.id }));

        this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId });

        ws.on('close', () => {
          this.logger.info({ peerId }, 'Peer disconnected');
          this.peers.delete(peerId);
          this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peerId), { peerId });
        });

        peer.init(false, this.options);
      });
    });
  }

  private async initServiceDiscovery(clientMode: boolean): Promise<void> {
    this.logger.info('Initializing service discovery');
    this.discoveryRedis = new Redis(this.options.discoveryRedisUrl!);
    this.discovery = new ServiceDiscovery(
      this.discoveryRedis,
      this,
      clientMode ? '' : `${this.options.listenHost}:${this.options.listenPort}`,
      clientMode ? [] : this.getExposedServices(),
      {
        heartbeatInterval: this.options.discoveryHeartbeatInterval,
        heartbeatTTL: this.options.discoveryHeartbeatTTL,
        pubSubEnabled: this.options.discoveryPubSubEnabled ?? true,
        clientMode,
      }
    );
    this.discovery.startHeartbeat();
    await this.discovery.subscribeToEvents((event) => {
      this.logger.debug({ event }, 'Service discovery event received');
      this.emit('discovery:event', event);
    });

    this.logger.info(`Service discovery initialized successfully (${clientMode ? 'client mode' : 'server mode'})`);
  }

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
    if (this.wss) {
      this.logger.info('Closing WebSocket server');
      this.wss.close();
      this.wss = undefined;
    }

    if (this.discovery) {
      this.logger.info('Shutting down service discovery');
      await this.discovery.shutdown();
      await this.discoveryRedis!.quit();
      this.discovery = undefined;
      this.discoveryRedis = undefined;
    }

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
  async connect(address: string, reconnect = true): Promise<RemotePeer> {
    this.logger.info({ address, reconnect }, 'Connecting to remote peer');
    const baseDelay = 1000;
    let reconnectAttempts = 0;
    let manuallyDisconnected = false;

    const connectPeer = (): Promise<RemotePeer> =>
      new Promise<RemotePeer>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          this.logger.error({ address }, 'Connection timeout');
          reject(new Error('Connection timeout'));
        }, this.options?.connectTimeout ?? CONNECT_TIMEOUT);

        const ws = new WebSocket(`${address}?id=${this.id}`);
        const peer = new RemotePeer(ws, this, address);

        let resolved = false;

        ws.once('open', () => {
          this.logger.debug({ address }, 'WebSocket connection established');
          clearTimeout(timeoutId);
          ws.once('message', async (message: ArrayBuffer, isBinary: boolean) => {
            if (!isBinary) {
              try {
                const data = JSON.parse(message.toString()) as { type: 'id'; id: string };
                if (data.type === 'id') {
                  peer.id = data.id;
                  this.peers.set(peer.id, peer);
                  await peer.init(true, this.options);

                  peer.once('manual-disconnect', () => {
                    this.logger.info({ peerId: peer.id }, 'Manual disconnect requested');
                    manuallyDisconnected = true;
                  });

                  ws.once('close', () => {
                    this.logger.info({ peerId: peer.id }, 'WebSocket connection closed');
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
                  this.logger.warn({ type: data.type }, 'Invalid handshake message type');
                  ws.close();
                  reject(new Error('Invalid handshake'));
                }
              } catch (error) {
                this.logger.error({ error }, 'Error parsing handshake message');
                ws.close();
                reject(error);
              }
            } else {
              this.logger.warn('Received binary handshake message');
              ws.close();
              reject(new Error('Invalid handshake'));
            }
          });
        });

        ws.on('error', (err) => {
          this.logger.error({ error: err }, 'WebSocket connection error');
          clearTimeout(timeoutId);
          if (!resolved) {
            reject(err);
          }
        });

        ws.on('close', () => {
          this.logger.warn({ address }, 'WebSocket connection closed prematurely');
          clearTimeout(timeoutId);
          if (!resolved) {
            reject(new Error('Connection closed prematurely'));
          }
        });
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
  static async create(options?: NetronOptions) {
    const netron = new Netron(options);
    await netron.start();
    return netron;
  }
  /**
   * Retrieves a list of all services currently exposed by this Netron instance.
   * This method provides a standardized way to access service metadata for discovery
   * and registration purposes. The returned information includes both service names
   * and versions, which are essential for service matching and version compatibility.
   *
   * @method getExposedServices
   * @public
   * @returns {ServiceInfo[]} An array of ServiceInfo objects containing:
   *                         - name: The unique identifier of the service
   *                         - version: The semantic version of the service
   *
   * @example
   * // Get all exposed services
   * const services = netron.getExposedServices();
   * // Result: [{ name: 'auth', version: '1.0.0' }, { name: 'storage', version: '2.1.0' }]
   *
   * @remarks
   * This method is primarily used by the service discovery system to:
   * 1. Register services with the discovery mechanism
   * 2. Provide service information to connecting peers
   * 3. Enable service version compatibility checking
   *
   * The returned array is derived from the internal services Map, ensuring that
   * the information is always up-to-date with the current service registry.
   */
  public getExposedServices(): ServiceInfo[] {
    return Array.from(this.services.values()).map((stub) => ({
      name: stub.definition.meta.name,
      version: stub.definition.meta.version,
    }));
  }
}
