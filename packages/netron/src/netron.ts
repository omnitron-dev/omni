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
 * The Netron class extends AsyncEventEmitter and manages the WebSocket server,
 * local and remote peers, tasks, and services.
 */
export class Netron extends AsyncEventEmitter {
  public id: string;
  private wss?: WebSocketServer;
  private ownEvents: Map<string, { name: string; data: any }[]> = new Map();
  public peer: LocalPeer;
  public peers: Map<string, RemotePeer> = new Map();
  public taskManager: TaskManager;
  private isStarted: boolean = false; // state of the start
  public services = new Map<string, ServiceStub>();
  public options: NetronOptions;

  /**
   * Constructor for the Netron class.
   * @param {NetronOptions} [options] - Optional configuration options.
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
   * @returns {Promise<void>}
   * @throws {Error} - If Netron is already started.
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
   * Stops the Netron instance, closing the WebSocket server.
   * @returns {Promise<void>}
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
   * @param {string} address - The address of the remote peer.
   * @returns {Promise<RemotePeer>}
   * @throws {Error} - If connection times out or encounters an error.
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
   * Disconnects a remote peer by its ID.
   * @param {string} peerId - The ID of the peer to disconnect.
   */
  disconnect(peerId: string) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.disconnect();
      this.peers.delete(peerId); // Ensure the peer is removed from the peers map
      this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peerId), { peerId });
    }
  }

  /**
   * Retrieves the names of all registered services.
   * @returns {string[]} - An array of service names.
   */
  getServiceNames() {
    return [...this.services.keys()];
  }

  /**
   * Adds a task to the task manager.
   * @param {Task} fn - The task function to add.
   * @returns {string} - The ID of the added task.
   */
  addTask(fn: Task) {
    return this.taskManager.addTask(fn);
  }

  /**
   * Runs a task on a remote netron.
   * @param {RemotePeer} peer - The remote peer to run the task on.
   * @param {string} name - The name of the task to run.
   * @param {...any[]} args - The arguments to pass to the task.
   * @returns {Promise<any>} - The result of the task.
   */
  async runTask(peer: RemotePeer, name: string, ...args: any[]) {
    return await this.taskManager.runTask(name, peer, ...args);
  }

  /**
   * Deletes special events by their ID.
   * @param {string} id - The ID of the events to delete.
   */
  deleteSpecialEvents(id: string) {
    this.ownEvents.delete(id);
  }

  /**
   * Emits a special event, ensuring it is processed sequentially.
   * @param {string} event - The name of the event.
   * @param {string} id - The ID of the event.
   * @param {any} data - The data associated with the event.
   * @returns {Promise<void>}
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
   * Factory method to create and start a Netron instance.
   * @param {NetronOptions} [options] - Optional configuration options.
   * @returns {Promise<Netron>} - A new instance of Netron.
   */
  static async create(options?: NetronOptions) {
    const netron = new Netron(options);
    await netron.start();
    return netron;
  }
}
