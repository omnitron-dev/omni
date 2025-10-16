/**
 * Sync Protocol Interface and Types
 * Defines the protocol for synchronizing environment state across nodes
 */

import { VectorClock } from '../crdt/vector-clock.js';

export interface SyncMessage {
  type: 'sync-request' | 'sync-response' | 'change-notification' | 'heartbeat';
  from: string;
  to?: string;
  timestamp: number;
  payload: unknown;
}

export interface SyncRequest {
  requestId: string;
  since?: VectorClock;
  keys?: string[];
}

export interface SyncResponse {
  requestId: string;
  changes: ChangeSet[];
  clock: VectorClock;
}

export interface ChangeSet {
  key: string;
  value: unknown;
  operation: 'set' | 'delete';
  timestamp: number;
  clock: VectorClock;
}

export interface ChangeNotification {
  changes: ChangeSet[];
  clock: VectorClock;
}

export interface NodeInfo {
  id: string;
  address: string;
  lastSeen: number;
  status: 'active' | 'inactive' | 'suspected';
  clock: VectorClock;
}

export interface SyncOptions {
  nodeId: string;
  heartbeatInterval?: number;
  syncInterval?: number;
  suspectTimeout?: number;
  maxRetries?: number;
}

export interface ISyncProtocol {
  /**
   * Start the sync protocol
   */
  start(): Promise<void>;

  /**
   * Stop the sync protocol
   */
  stop(): Promise<void>;

  /**
   * Send a sync request to a peer
   */
  requestSync(peerId: string, since?: VectorClock): Promise<SyncResponse>;

  /**
   * Handle incoming sync message
   */
  handleMessage(message: SyncMessage): Promise<void>;

  /**
   * Broadcast changes to all peers
   */
  broadcastChanges(changes: ChangeSet[]): Promise<void>;

  /**
   * Get list of active peers
   */
  getPeers(): NodeInfo[];
}

export class SyncProtocol implements ISyncProtocol {
  private readonly nodeId: string;
  private readonly options: Required<SyncOptions>;
  private peers: Map<string, NodeInfo>;
  private running: boolean;
  private heartbeatTimer?: NodeJS.Timeout;
  private syncTimer?: NodeJS.Timeout;
  private messageHandlers: Map<string, (message: SyncMessage) => Promise<void>>;

  constructor(options: SyncOptions) {
    this.nodeId = options.nodeId;
    this.options = {
      nodeId: options.nodeId,
      heartbeatInterval: options.heartbeatInterval ?? 5000,
      syncInterval: options.syncInterval ?? 10000,
      suspectTimeout: options.suspectTimeout ?? 15000,
      maxRetries: options.maxRetries ?? 3,
    };
    this.peers = new Map();
    this.running = false;
    this.messageHandlers = new Map();
  }

  async start(): Promise<void> {
    if (this.running) return;

    this.running = true;

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, this.options.heartbeatInterval);

    // Start periodic sync check
    this.syncTimer = setInterval(() => {
      this.checkPeerStatus();
    }, this.options.syncInterval);
  }

  async stop(): Promise<void> {
    if (!this.running) return;

    this.running = false;

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = undefined;
    }

    this.peers.clear();
  }

  async requestSync(_peerId: string, since?: VectorClock): Promise<SyncResponse> {
    const request: SyncRequest = {
      requestId: `${this.nodeId}-${Date.now()}`,
      since,
    };

    // In a real implementation, this would send over network
    // For now, we'll simulate with a promise
    return new Promise((resolve) => {
      // Simulate network delay
      setTimeout(() => {
        resolve({
          requestId: request.requestId,
          changes: [],
          clock: {},
        });
      }, 10);
    });
  }

  async handleMessage(message: SyncMessage): Promise<void> {
    // Update peer info
    this.updatePeerInfo(message.from);

    const handler = this.messageHandlers.get(message.type);
    if (handler) {
      await handler(message);
    }

    switch (message.type) {
      case 'heartbeat':
        // Already updated peer info above
        break;

      case 'sync-request':
        await this.handleSyncRequest(message);
        break;

      case 'sync-response':
        await this.handleSyncResponse(message);
        break;

      case 'change-notification':
        await this.handleChangeNotification(message);
        break;
    }
  }

  async broadcastChanges(_changes: ChangeSet[]): Promise<void> {
    // In a real implementation, this would broadcast to all active peers
    // For now, just iterate through peers to maintain the interface
    for (const _peer of this.peers.values()) {
      if (_peer.status === 'active') {
        // Send notification to peer over network
      }
    }
  }

  getPeers(): NodeInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * Register a custom message handler
   */
  onMessage(type: string, handler: (message: SyncMessage) => Promise<void>): void {
    this.messageHandlers.set(type, handler);
  }

  private async sendHeartbeats(): Promise<void> {
    // In a real implementation, send heartbeat to all peers
    for (const _peer of this.peers.values()) {
      // Send heartbeat message over network
    }
  }

  private checkPeerStatus(): void {
    const now = Date.now();
    const timeout = this.options.suspectTimeout;

    for (const [_peerId, info] of this.peers) {
      if (now - info.lastSeen > timeout) {
        if (info.status === 'active') {
          info.status = 'suspected';
        } else if (info.status === 'suspected') {
          info.status = 'inactive';
        }
      }
    }
  }

  private updatePeerInfo(peerId: string): void {
    const existing = this.peers.get(peerId);
    if (existing) {
      existing.lastSeen = Date.now();
      existing.status = 'active';
    } else {
      this.peers.set(peerId, {
        id: peerId,
        address: '', // Would be filled from network layer
        lastSeen: Date.now(),
        status: 'active',
        clock: {},
      });
    }
  }

  private async handleSyncRequest(_message: SyncMessage): Promise<void> {
    // In a real implementation, gather changes and send response
  }

  private async handleSyncResponse(_message: SyncMessage): Promise<void> {
    // In a real implementation, apply changes from response
  }

  private async handleChangeNotification(_message: SyncMessage): Promise<void> {
    // In a real implementation, apply changes
  }
}
