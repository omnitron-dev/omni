import Redis from 'ioredis';

import { NodeInfo, ServiceInfo, DiscoveryOptions } from './types';

/**
 * Default interval for sending heartbeat signals in milliseconds
 */
const DEFAULT_HEARTBEAT_INTERVAL = 5000;

/**
 * Default Time-To-Live (TTL) for heartbeat keys in milliseconds
 */
const DEFAULT_HEARTBEAT_TTL = 15000;

/**
 * ServiceDiscovery class provides functionality for service discovery and node management
 * using Redis as a distributed registry. It handles node registration, heartbeat monitoring,
 * and service lookup capabilities.
 */
export class ServiceDiscovery {
  /** Redis client instance for distributed coordination */
  private redis: Redis;

  /** Unique identifier for the current node */
  private nodeId: string;

  /** Network address of the current node */
  private address: string;

  /** List of services provided by the current node */
  private services: ServiceInfo[];

  /** Timer reference for periodic heartbeat */
  private heartbeatTimer?: NodeJS.Timeout;

  /** Configuration options for discovery mechanism */
  private options: Required<DiscoveryOptions>;

  /**
   * Creates a new ServiceDiscovery instance
   * 
   * @param redis - Redis client instance for distributed coordination
   * @param nodeId - Unique identifier for the current node
   * @param address - Network address of the current node
   * @param services - List of services provided by the current node
   * @param options - Optional configuration for discovery mechanism
   */
  constructor(redis: Redis, nodeId: string, address: string, services: ServiceInfo[], options?: DiscoveryOptions) {
    this.redis = redis;
    this.nodeId = nodeId;
    this.address = address;
    this.services = services;
    this.options = {
      heartbeatInterval: options?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      heartbeatTTL: options?.heartbeatTTL ?? DEFAULT_HEARTBEAT_TTL,
    };
  }

  /**
   * Initiates periodic heartbeat publication for node registration
   * 
   * @remarks
   * This method starts an immediate heartbeat and sets up a periodic timer
   * to maintain node registration in the discovery system.
   */
  public startHeartbeat(): void {
    this.publishHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.publishHeartbeat(),
      this.options.heartbeatInterval
    );
  }

  /**
   * Stops heartbeat publication and deregisters the node
   * 
   * @returns Promise that resolves when node deregistration is complete
   */
  public stopHeartbeat(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    return this.deregisterNodeById(this.nodeId);
  }

  /**
   * Publishes node heartbeat to Redis
   * 
   * @remarks
   * This method performs the following operations in a single transaction:
   * 1. Updates node information in a hash
   * 2. Sets expiration for node data
   * 3. Updates heartbeat key with TTL
   * 4. Adds node to the index set
   */
  private async publishHeartbeat(): Promise<void> {
    const nodeKey = `netron:discovery:nodes:${this.nodeId}`;
    const heartbeatKey = `netron:discovery:heartbeat:${this.nodeId}`;

    await this.redis
      .multi()
      .hmset(nodeKey, {
        address: this.address,
        services: JSON.stringify(this.services),
        timestamp: Date.now().toString(),
      })
      .expire(nodeKey, Math.ceil(this.options.heartbeatTTL / 1000))
      .set(heartbeatKey, '1', 'PX', this.options.heartbeatTTL)
      .sadd('netron:discovery:index:nodes', this.nodeId)
      .exec();
  }

  /**
   * Retrieves all currently active nodes with their services
   * 
   * @returns Promise that resolves to an array of active node information
   * 
   * @remarks
   * This method performs the following operations:
   * 1. Retrieves all node IDs from the index
   * 2. Fetches node data and heartbeat status in parallel
   * 3. Filters out inactive nodes
   * 4. Automatically deregisters inactive nodes
   */
  public async getActiveNodes(): Promise<NodeInfo[]> {
    const nodeIds = await this.redis.smembers('netron:discovery:index:nodes');
    if (!nodeIds.length) return [];

    const pipeline = this.redis.pipeline();
    nodeIds.forEach((id) => {
      pipeline.hgetall(`netron:discovery:nodes:${id}`);
      pipeline.exists(`netron:discovery:heartbeat:${id}`);
    });

    const results = await pipeline.exec();
    const activeNodes: NodeInfo[] = [];

    if (!results) return activeNodes;

    for (let i = 0; i < nodeIds.length; i++) {
      const nodeDataResult = results[i * 2];
      const heartbeatExistsResult = results[i * 2 + 1];

      const nodeData = nodeDataResult?.[1] as Record<string, string>;
      const heartbeatExists = heartbeatExistsResult?.[1];

      const address = nodeData?.['address'];
      const services = nodeData?.['services'];
      const timestamp = nodeData?.['timestamp'];

      if (heartbeatExists && address && services && timestamp) {
        activeNodes.push({
          nodeId: nodeIds[i]!,
          address,
          services: JSON.parse(services),
          timestamp: Number(timestamp),
        });
      } else {
        if (nodeIds[i]) {
          await this.deregisterNodeById(nodeIds[i]!);
        }
      }
    }

    return activeNodes;
  }

  /**
   * Finds nodes that provide a specific service
   * 
   * @param name - Name of the service to search for
   * @param version - Optional version constraint for the service
   * @returns Promise that resolves to an array of nodes providing the service
   */
  public async findNodesByService(name: string, version?: string): Promise<NodeInfo[]> {
    const activeNodes = await this.getActiveNodes();
    return activeNodes.filter(node =>
      node.services.some(svc =>
        svc.name === name && (!version || svc.version === version)
      )
    );
  }

  /**
   * Deregisters a node from the discovery system
   * 
   * @param nodeId - ID of the node to deregister
   * @remarks
   * This method removes all node-related data from Redis in a single transaction
   */
  private async deregisterNodeById(nodeId: string): Promise<void> {
    const nodeKey = `netron:discovery:nodes:${nodeId}`;
    const heartbeatKey = `netron:discovery:heartbeat:${nodeId}`;

    await this.redis
      .multi()
      .del(nodeKey, heartbeatKey)
      .srem('netron:discovery:index:nodes', nodeId)
      .exec();
  }

  /**
   * Checks if a specific node is currently active
   * 
   * @param nodeId - ID of the node to check
   * @returns Promise that resolves to true if the node is active
   */
  public async isNodeActive(nodeId: string): Promise<boolean> {
    const heartbeatKey = `netron:discovery:heartbeat:${nodeId}`;
    const exists = await this.redis.exists(heartbeatKey);
    if (!exists) {
      await this.deregisterNodeById(nodeId);
    }
    return exists === 1;
  }

  /**
   * Updates the list of services provided by the current node
   * 
   * @param services - New list of services
   * @returns Promise that resolves when the update is complete
   */
  public async updateServices(services: ServiceInfo[]): Promise<void> {
    this.services = services;
    await this.publishHeartbeat();
  }

  /**
   * Updates the network address of the current node
   * 
   * @param address - New network address
   * @returns Promise that resolves when the update is complete
   */
  public async updateAddress(address: string): Promise<void> {
    this.address = address;
    await this.publishHeartbeat();
  }
}
