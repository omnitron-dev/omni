import path from 'node:path';
import cuid from '@bugsnag/cuid';
import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { AsyncEventEmitter } from '@devgrid/async-emitter';

import { LocalPeer } from './local-peer';
import { RemotePeer } from './remote-peer';
import { ServiceStub } from './service-stub';
import { Task, TaskManager } from './task-manager';
import { Abilities, NetronOptions } from './types';
import { CONNECT_TIMEOUT, getPeerEventName, NETRON_EVENT_PEER_CONNECT, NETRON_EVENT_PEER_DISCONNECT } from './common';

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

  /**
   * Constructor for the Netron class.
   * @param {NetronOptions} [options] - Optional configuration options.
   */
  constructor(public options?: NetronOptions) {
    super();

    this.id = options?.id ?? cuid();

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

        peer.init(false, this.options?.abilities);
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
   * @param {Abilities} [abilities] - Optional abilities for the remote peer.
   * @returns {Promise<RemotePeer>}
   * @throws {Error} - If connection times out or encounters an error.
   */
  async connect(address: string, abilities?: Abilities): Promise<RemotePeer> {
    return new Promise<RemotePeer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timeout'));
      }, this.options?.connectTimeout ?? CONNECT_TIMEOUT);

      const ws = new WebSocket(`${address}?id=${this.id}`);
      const peer = new RemotePeer(ws, this);

      let isResolved = false;

      ws.on('open', () => {
        clearTimeout(timeout);
        const uidHandler = (message: ArrayBuffer, isBinary: boolean) => {
          if (isBinary) {
            return;
          }
          try {
            const data = JSON.parse(message.toString()) as { type: 'id'; id: string };
            if (data.type === 'id') {
              peer.id = data.id;
              this.peers.set(peer.id, peer);
              if (!isResolved) {
                isResolved = true;
                peer.init(true, abilities).then(() => {
                  this.emitSpecial(NETRON_EVENT_PEER_CONNECT, getPeerEventName(peer.id), { peerId: peer.id });
                  resolve(peer);
                });
              }
            } else {
              ws.close();
            }
          } catch (error) {
            console.error('Message error:', error);
            ws.close();
            if (!isResolved) {
              isResolved = true;
              reject(new Error('Message error'));
            }
          } finally {
            ws.removeListener('message', uidHandler);
          }
        };
        ws.on('message', uidHandler);
      });

      ws.on('error', (err) => {
        console.error(`Connection error to ${address}:`, err);
        if (!isResolved) {
          isResolved = true;
          reject(err);
        }
      });

      ws.on('close', () => {
        if (!isResolved) {
          console.warn('Connection closed prematurely.');
          reject(new Error('Connection closed prematurely'));
        }
        this.peers.delete(peer.id);
        this.emitSpecial(NETRON_EVENT_PEER_DISCONNECT, getPeerEventName(peer.id), { peerId: peer.id });
      });
    });
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
   * Runs a task on a remote peer.
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
