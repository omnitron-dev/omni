/**
 * Node Registry
 * Manages node registration and discovery
 */

import { EventEmitter } from 'events';
import { VectorClock } from '../crdt/vector-clock.js';

export interface NodeMetadata {
  id: string;
  address: string;
  port?: number;
  region?: string;
  datacenter?: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegisteredNode extends NodeMetadata {
  registeredAt: number;
  lastHeartbeat: number;
  status: 'online' | 'offline' | 'suspected';
  clock: VectorClock;
}

export interface NodeRegistryOptions {
  heartbeatInterval?: number;
  timeoutThreshold?: number;
  cleanupInterval?: number;
}

export class NodeRegistry extends EventEmitter {
  private nodes: Map<string, RegisteredNode>;
  private readonly options: Required<NodeRegistryOptions>;
  private heartbeatTimer?: NodeJS.Timeout;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: NodeRegistryOptions = {}) {
    super();
    this.nodes = new Map();
    this.options = {
      heartbeatInterval: options.heartbeatInterval ?? 5000,
      timeoutThreshold: options.timeoutThreshold ?? 15000,
      cleanupInterval: options.cleanupInterval ?? 30000,
    };
  }

  /**
   * Start the registry
   */
  start(): void {
    // Start heartbeat monitoring
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeats();
    }, this.options.heartbeatInterval);

    // Start cleanup
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.options.cleanupInterval);
  }

  /**
   * Stop the registry
   */
  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }

    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Register a node
   */
  register(metadata: NodeMetadata): RegisteredNode {
    const existing = this.nodes.get(metadata.id);

    const node: RegisteredNode = {
      ...metadata,
      registeredAt: existing?.registeredAt ?? Date.now(),
      lastHeartbeat: Date.now(),
      status: 'online',
      clock: existing?.clock ?? {},
    };

    this.nodes.set(metadata.id, node);

    if (!existing) {
      this.emit('node:registered', node);
    } else {
      this.emit('node:updated', node);
    }

    return node;
  }

  /**
   * Unregister a node
   */
  unregister(nodeId: string): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }

    this.nodes.delete(nodeId);
    this.emit('node:unregistered', node);
    return true;
  }

  /**
   * Update heartbeat for a node
   */
  heartbeat(nodeId: string, clock?: VectorClock): boolean {
    const node = this.nodes.get(nodeId);
    if (!node) {
      return false;
    }

    node.lastHeartbeat = Date.now();
    if (clock) {
      node.clock = clock;
    }

    if (node.status !== 'online') {
      node.status = 'online';
      this.emit('node:online', node);
    }

    return true;
  }

  /**
   * Get a node by ID
   */
  getNode(nodeId: string): RegisteredNode | undefined {
    return this.nodes.get(nodeId);
  }

  /**
   * Get all nodes
   */
  getAllNodes(): RegisteredNode[] {
    return Array.from(this.nodes.values());
  }

  /**
   * Get online nodes
   */
  getOnlineNodes(): RegisteredNode[] {
    return this.getAllNodes().filter((node) => node.status === 'online');
  }

  /**
   * Get offline nodes
   */
  getOfflineNodes(): RegisteredNode[] {
    return this.getAllNodes().filter((node) => node.status === 'offline');
  }

  /**
   * Find nodes by criteria
   */
  findNodes(
    criteria: Partial<NodeMetadata> & { status?: RegisteredNode['status'] },
  ): RegisteredNode[] {
    return this.getAllNodes().filter((node) => {
      if (criteria.region && node.region !== criteria.region) return false;
      if (criteria.datacenter && node.datacenter !== criteria.datacenter)
        return false;
      if (criteria.status && node.status !== criteria.status) return false;
      if (
        criteria.capabilities &&
        !criteria.capabilities.every((cap) => node.capabilities?.includes(cap))
      ) {
        return false;
      }
      return true;
    });
  }

  /**
   * Get node count
   */
  getNodeCount(): number {
    return this.nodes.size;
  }

  /**
   * Check if node exists
   */
  hasNode(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }

  /**
   * Clear all nodes
   */
  clear(): void {
    this.nodes.clear();
    this.emit('registry:cleared');
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    const threshold = this.options.timeoutThreshold;

    for (const node of this.nodes.values()) {
      const timeSinceHeartbeat = now - node.lastHeartbeat;

      if (node.status === 'online' && timeSinceHeartbeat > threshold) {
        node.status = 'suspected';
        this.emit('node:suspected', node);
      } else if (node.status === 'suspected' && timeSinceHeartbeat > threshold * 2) {
        node.status = 'offline';
        this.emit('node:offline', node);
      }
    }
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = this.options.timeoutThreshold * 4; // Remove after 4x timeout

    for (const [id, node] of this.nodes) {
      if (node.status === 'offline' && now - node.lastHeartbeat > maxAge) {
        this.nodes.delete(id);
        this.emit('node:removed', node);
      }
    }
  }
}
