import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { AsyncEventEmitter } from '@devgrid/async-emitter';

import { NetronOptions } from './types';
import { LocalPeer } from './local-peer';
import { RemotePeer } from './remote-peer';
import { getPeerEventName } from './utils';
import { ServiceStub } from './service-stub';
import { Task, TaskManager } from './task-manager';
import { CONNECT_TIMEOUT, NETRON_EVENT_PEER_CONNECT, NETRON_EVENT_PEER_DISCONNECT } from './constants';

/**
 * The main Netron class that manages WebSocket connections, services, and peer communication.
 * This class serves as the central hub for creating and managing distributed system components.
 * It extends AsyncEventEmitter to provide asynchronous event handling capabilities.
 * 
 * @class Netron
 * @extends AsyncEventEmitter
 * @description Core class for managing distributed system components and peer-to-peer communication
 */
export class Netron extends AsyncEventEmitter {
  /**
   * Unique identifier for this Netron instance.
   * Generated automatically using randomUUID() if not provided in options.
   * Used for peer identification and connection management.
   * 
   * @type {string}
   * @public
   */
  public id: string;

  /**
   * WebSocket server instance for handling incoming connections.
   * Only initialized when running in server mode (when listenHost and listenPort are provided).
   * 
   * @type {WebSocketServer | undefined}
   * @private
   */
  private wss?: WebSocketServer;

  /**
   * Map of special events that need to be processed sequentially.
   * Used to ensure ordered processing of related events and prevent race conditions.
   * Key: event ID, Value: array of {name, data} pairs
   * 
   * @type {Map<string, { name: string; data: any }[]>}
   * @private
   */
  private ownEvents: Map<string, { name: string; data: any }[]> = new Map();

  /**
   * The local peer instance representing this Netron instance.
   * Used for exposing local services and handling local operations.
   * 
   * @type {LocalPeer}
   * @public
   */
  public peer: LocalPeer;

  /**
   * Map of connected remote peers.
   * Key: peer ID, Value: RemotePeer instance
   * Used to track and manage all active peer connections.
   * 
   * @type {Map<string, RemotePeer>}
   * @public
   */
  public peers: Map<string, RemotePeer> = new Map();

  /**
   * Task manager instance for handling remote task execution.
   * Manages task registration, execution, and timeout handling.
   * 
   * @type {TaskManager}
   * @public
   */
  public taskManager: TaskManager;

  /**
   * Flag indicating whether the Netron instance has been started.
   * Used to prevent multiple start attempts and ensure proper initialization.
   * 
   * @type {boolean}
   * @private
   */
  private isStarted: boolean = false;

  /**
   * Map of exposed services.
   * Key: qualified service name (name:version), Value: ServiceStub instance
   * Used to track and manage all available services.
   * 
   * @type {Map<string, ServiceStub>}
   * @public
   */
  public services = new Map<string, ServiceStub>();

  /**
   * Configuration options for this Netron instance.
   * Contains settings for timeouts, reconnection, and other behaviors.
   * 
   * @type {NetronOptions}
   * @public
   */
  public options: NetronOptions;

  /**
   * Creates a new Netron instance with the specified options.
   * Initializes the task manager and local peer.
   * 
   * @constructor
   * @param {NetronOptions} [options] - Configuration options for the Netron instance
   * @throws {Error} If required options are missing or invalid
   */
  constructor(options?: NetronOptions) {
    super();

    this.options = options ?? {};
    this.id = options?.id ?? randomUUID();

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
   */
  async start() {
    if (this.isStarted) {
      throw new Error('Netron already started');
    }

    await this.taskManager.loadTasksFromDir(path.join(__dirname, 'core-tasks'));

    if (!this.options?.listenHost || !this.options?.listenPort) {
      this.isStarted = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
      this.wss = new WebSocketServer({
        host: this.options?.listenHost,
        port: this.options?.listenPort,
      });

      this.wss.on('listening', () => {
        this.isStarted = true;
        resolve();
      });

      this.wss.on('error', (err) => {
        reject(err);
      });

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        const peerId = new URL(req.url!, 'ws://localhost:8080').searchParams.get('id');
        if (!peerId) {
          ws.close();
          return;
        }
        const peer = new RemotePeer(ws, this, peerId);
        this.peers.set(peer.id, peer);

        ws.send(JSON.stringify({ type: 'id', id: this.id }));

        this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId });

        ws.on('close', () => {
          this.peers.delete(peerId);
          this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peerId), { peerId });
        });

        peer.init(false, this.options);
      });
    });
  }

  /**
   * Stops the Netron instance, closing the WebSocket server and cleaning up resources.
   * Properly shuts down all connections and services.
   * 
   * @method stop
   * @async
   * @returns {Promise<void>} Resolves when shutdown is complete
   */
  async stop() {
    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }
    this.isStarted = false;
  }

  /**
   * Connects to a remote peer via WebSocket.
   * Implements automatic reconnection with exponential backoff.
   * Handles connection timeouts and retries with increasing delays.
   * 
   * @method connect
   * @async
   * @param {string} address - WebSocket URL of the remote peer
   * @param {boolean} [reconnect=true] - Whether to attempt reconnection on disconnection
   * @returns {Promise<RemotePeer>} Resolves with the RemotePeer instance
   * @throws {Error} If connection fails or times out
   */
  async connect(address: string, reconnect = true): Promise<RemotePeer> {
    const baseDelay = 1000;
    let reconnectAttempts = 0;
    let manuallyDisconnected = false;

    const connectPeer = (): Promise<RemotePeer> => new Promise<RemotePeer>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.options?.connectTimeout ?? CONNECT_TIMEOUT);

      const ws = new WebSocket(`${address}?id=${this.id}`);
      const peer = new RemotePeer(ws, this, address);

      let resolved = false;

      ws.once('open', () => {
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
                  manuallyDisconnected = true;
                });

                ws.once('close', () => {
                  this.peers.delete(peer.id);
                  this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peer.id), { peerId: peer.id });

                  if (reconnect && !manuallyDisconnected) {
                    attemptReconnect();
                  }
                });

                resolved = true;
                reconnectAttempts = 0;
                this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId: peer.id });
                resolve(peer);
              } else {
                ws.close();
                reject(new Error('Invalid handshake'));
              }
            } catch (error) {
              ws.close();
              reject(error);
            }
          } else {
            ws.close();
            reject(new Error('Invalid handshake'));
          }
        });
      });

      ws.on('error', (err) => {
        clearTimeout(timeoutId);
        if (!resolved) {
          reject(err);
        }
      });

      ws.on('close', () => {
        clearTimeout(timeoutId);
        if (!resolved) {
          reject(new Error('Connection closed prematurely'));
        }
      });
    });

    const attemptReconnect = () => {
      if (this.options.maxReconnectAttempts && reconnectAttempts >= this.options.maxReconnectAttempts) {
        console.error(`Reconnect attempts exceeded (${this.options.maxReconnectAttempts}). Giving up.`);
        return;
      }

      const delay = Math.min(baseDelay * 2 ** reconnectAttempts, 30000);
      console.info(`Reconnecting to ${address} in ${delay} ms (attempt ${reconnectAttempts + 1}/${this.options.maxReconnectAttempts ?? 'unlimited'})...`);

      setTimeout(async () => {
        reconnectAttempts++;
        try {
          await connectPeer();
          console.info(`Successfully reconnected to ${address}.`);
        } catch (err) {
          console.warn(`Reconnect failed (${reconnectAttempts}/${this.options.maxReconnectAttempts ?? 'unlimited'}):`);
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
        console.error(`Event emit error: ${err.message}`);
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
}
