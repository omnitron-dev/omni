/**
 * Discovery Service Implementation for Titan Framework
 *
 * Provides distributed service discovery capabilities using Redis as a coordination backend.
 * Features include:
 * - Automatic node registration and heartbeat management
 * - Service discovery and lookup across the network
 * - Event-driven notifications for node state changes
 * - Automatic cleanup of inactive nodes
 */

import { Redis } from 'ioredis';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Injectable, Inject, Optional } from '../../decorators/index.js';
import type { ILogger } from '../logger/logger.types.js';
import {
  type NodeInfo,
  type ServiceInfo,
  type DiscoveryEvent,
  type DiscoveryOptions,
  type IDiscoveryService,
  REDIS_TOKEN,
  LOGGER_TOKEN,
  DISCOVERY_OPTIONS_TOKEN
} from './types.js';

// Default configuration values
const DEFAULT_HEARTBEAT_INTERVAL = 5000;
const DEFAULT_HEARTBEAT_TTL = 15000;
const DEFAULT_REDIS_PREFIX = 'titan:discovery';
const DEFAULT_PUBSUB_CHANNEL = 'titan:discovery:events';

// Load Lua script for atomic heartbeat registration
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REGISTER_HEARTBEAT_SCRIPT = readFileSync(
  join(__dirname, '..', '..', '..', 'lua', 'discovery', 'register-heartbeat.lua'),
  'utf-8'
);

/**
 * Service Discovery implementation for Titan framework.
 * Manages node registration, heartbeat, and service discovery in a distributed environment.
 */
@Injectable()
export class DiscoveryService implements IDiscoveryService {
  private redis: Redis;
  private logger: ILogger;
  private nodeId: string;
  private address: string;
  private services: ServiceInfo[];
  private heartbeatTimer?: NodeJS.Timeout;
  private options: Required<DiscoveryOptions>;
  private subscriber?: Redis;
  private eventEmitter = new EventEmitter();
  private stopped = false;
  private registered = false;
  private shutdownPromise?: Promise<void>;

  constructor(
    @Inject(REDIS_TOKEN) redis: Redis,
    @Inject(LOGGER_TOKEN) logger: ILogger,
    @Optional() @Inject(DISCOVERY_OPTIONS_TOKEN) options?: DiscoveryOptions
  ) {
    if (!redis) {
      throw new Error('Redis instance must be provided for DiscoveryService');
    }

    this.redis = redis;
    this.logger = logger;

    // Generate unique node ID
    this.nodeId = this.generateNodeId();
    this.address = this.detectAddress();
    this.services = [];

    // Merge with default options
    this.options = {
      heartbeatInterval: options?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      heartbeatTTL: options?.heartbeatTTL ?? DEFAULT_HEARTBEAT_TTL,
      pubSubEnabled: options?.pubSubEnabled ?? false,
      pubSubChannel: options?.pubSubChannel ?? DEFAULT_PUBSUB_CHANNEL,
      clientMode: options?.clientMode ?? false,
      redisPrefix: options?.redisPrefix ?? DEFAULT_REDIS_PREFIX,
      maxRetries: options?.maxRetries ?? 3,
      retryDelay: options?.retryDelay ?? 1000,
    };

    if (this.options.clientMode) {
      this.logger.info('DiscoveryService started in client mode (no heartbeat or node registration)');
    } else {
      this.logger.info({
        nodeId: this.nodeId,
        address: this.address,
        services: this.services,
      }, 'DiscoveryService initialized');
    }
  }

  /**
   * Start the discovery service
   */
  async start(): Promise<void> {
    if (this.stopped) {
      throw new Error('Cannot start a stopped DiscoveryService');
    }

    // Set up PubSub if enabled
    if (this.options.pubSubEnabled) {
      await this.setupPubSub();
    }

    // Start heartbeat if not in client mode
    if (!this.options.clientMode) {
      await this.startHeartbeat();
      this.logger.info('DiscoveryService started');
    }
  }

  /**
   * Stop the discovery service
   */
  async stop(): Promise<void> {
    if (this.stopped) {
      return this.shutdownPromise;
    }

    this.stopped = true;

    this.shutdownPromise = (async () => {
      this.logger.info(`Initiating graceful shutdown for node '${this.nodeId}'`);

      // Stop heartbeat timer
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        this.logger.debug('Heartbeat timer stopped');
      }

      // Deregister node
      try {
        if (this.registered && !this.options.clientMode) {
          await this.deregisterNode(this.nodeId);
          this.registered = false;
          this.logger.info(`Node '${this.nodeId}' deregistered successfully`);
        }
      } catch (error) {
        this.logger.error({ error }, `Error deregistering node '${this.nodeId}'`);
      }

      // Unsubscribe from PubSub
      try {
        if (this.subscriber) {
          await this.unsubscribeFromEvents();
        }
      } catch (error) {
        this.logger.error({ error }, 'Error during PubSub unsubscribe');
      }

      this.logger.info('DiscoveryService shutdown completed');
    })();

    return this.shutdownPromise;
  }

  /**
   * Register a node with given services
   */
  async registerNode(nodeId: string, address: string, services: ServiceInfo[]): Promise<void> {
    this.nodeId = nodeId || this.nodeId;
    this.address = address || this.address;
    this.services = services || this.services;

    if (!this.options.clientMode) {
      await this.publishHeartbeat();
    }
  }

  /**
   * Deregister a node
   */
  async deregisterNode(nodeId: string): Promise<void> {
    const prefix = this.options.redisPrefix;
    const nodeKey = `${prefix}:nodes:${nodeId}`;
    const heartbeatKey = `${prefix}:heartbeat:${nodeId}`;
    const nodesIndexKey = `${prefix}:index:nodes`;

    const pipeline = this.redis.pipeline();
    pipeline.del(nodeKey);
    pipeline.del(heartbeatKey);
    pipeline.srem(nodesIndexKey, nodeId);

    await pipeline.exec();

    // Publish deregistration event
    if (this.options.pubSubEnabled) {
      await this.publishEvent('NODE_DEREGISTERED', nodeId);
    }
  }

  /**
   * Get all active nodes
   */
  async getActiveNodes(): Promise<NodeInfo[]> {
    try {
      const prefix = this.options.redisPrefix;
      const nodesIndexKey = `${prefix}:index:nodes`;
      const nodeIds = await this.redis.smembers(nodesIndexKey);

      if (!nodeIds.length) return [];

      const pipeline = this.redis.pipeline();

      nodeIds.forEach((id) => {
        pipeline.hgetall(`${prefix}:nodes:${id}`);
        pipeline.exists(`${prefix}:heartbeat:${id}`);
      });

      const results = await pipeline.exec();

      const activeNodes: NodeInfo[] = [];
      const nodesToDeregister: string[] = [];

      if (!results) return activeNodes;

      for (let i = 0; i < nodeIds.length; i++) {
        const nodeId = nodeIds[i];
        if (!nodeId) continue;

        const nodeDataResult = results[i * 2];
        const heartbeatResult = results[i * 2 + 1];

        if (!nodeDataResult || !heartbeatResult) {
          nodesToDeregister.push(nodeId);
          continue;
        }

        const [nodeDataErr, nodeData] = nodeDataResult;
        const [heartbeatErr, heartbeatExists] = heartbeatResult;

        if (nodeDataErr || heartbeatErr || !heartbeatExists || !nodeData || typeof nodeData !== 'object') {
          nodesToDeregister.push(nodeId);
          continue;
        }

        // Type assertion for Redis hash result
        const nodeDataTyped = nodeData as Record<string, unknown>;
        const address = typeof nodeDataTyped['address'] === 'string' ? nodeDataTyped['address'] : null;
        const servicesRaw = typeof nodeDataTyped['services'] === 'string' ? nodeDataTyped['services'] : null;
        const timestampRaw = typeof nodeDataTyped['timestamp'] === 'string' ? nodeDataTyped['timestamp'] : null;

        if (!address || !servicesRaw || !timestampRaw) {
          nodesToDeregister.push(nodeId);
          continue;
        }

        let services: ServiceInfo[];
        try {
          services = JSON.parse(servicesRaw);
        } catch {
          nodesToDeregister.push(nodeId);
          continue;
        }

        activeNodes.push({
          nodeId,
          address,
          services,
          timestamp: Number(timestampRaw),
        });
      }

      // Clean up inactive nodes
      if (nodesToDeregister.length > 0) {
        await this.cleanupInactiveNodes(nodesToDeregister);
      }

      return activeNodes;
    } catch (error) {
      this.logger.error({ error }, 'Error fetching active nodes');
      throw error;
    }
  }

  /**
   * Find nodes by service name
   */
  async findNodesByService(serviceName: string, version?: string): Promise<NodeInfo[]> {
    try {
      const activeNodes = await this.getActiveNodes();

      return activeNodes.filter((node) =>
        node.services.some(
          (service) =>
            service.name === serviceName && (!version || service.version === version)
        )
      );
    } catch (error) {
      this.logger.error({ error, serviceName, version }, 'Error finding nodes by service');
      throw error;
    }
  }

  /**
   * Check if a node is active
   */
  async isNodeActive(nodeId: string): Promise<boolean> {
    const prefix = this.options.redisPrefix;
    const heartbeatKey = `${prefix}:heartbeat:${nodeId}`;
    const exists = await this.redis.exists(heartbeatKey);
    return exists === 1;
  }

  /**
   * Update node address
   */
  async updateNodeAddress(nodeId: string, address: string): Promise<void> {
    if (nodeId === this.nodeId) {
      this.address = address;
    }

    const prefix = this.options.redisPrefix;
    const nodeKey = `${prefix}:nodes:${nodeId}`;

    await this.redis.hset(nodeKey, 'address', address);

    if (this.options.pubSubEnabled) {
      await this.publishEvent('NODE_UPDATED', nodeId);
    }
  }

  /**
   * Update node services
   */
  async updateNodeServices(nodeId: string, services: ServiceInfo[]): Promise<void> {
    if (nodeId === this.nodeId) {
      this.services = services;
    }

    const prefix = this.options.redisPrefix;
    const nodeKey = `${prefix}:nodes:${nodeId}`;

    await this.redis.hset(nodeKey, 'services', JSON.stringify(services));

    if (this.options.pubSubEnabled) {
      await this.publishEvent('NODE_UPDATED', nodeId);
    }
  }

  /**
   * Subscribe to discovery events
   */
  onEvent(handler: (event: DiscoveryEvent) => void): void {
    this.eventEmitter.on('discovery:event', handler);
  }

  /**
   * Unsubscribe from discovery events
   */
  offEvent(handler: (event: DiscoveryEvent) => void): void {
    this.eventEmitter.off('discovery:event', handler);
  }

  /**
   * Start periodic heartbeat
   */
  private async startHeartbeat(): Promise<void> {
    if (this.options.clientMode) {
      this.logger.debug('Heartbeat disabled in client mode');
      return;
    }

    // Publish initial heartbeat and wait for it
    await this.publishHeartbeat();

    // Set up periodic heartbeat
    this.heartbeatTimer = setInterval(
      () => this.publishHeartbeat(),
      this.options.heartbeatInterval
    );
  }

  /**
   * Publish heartbeat to Redis
   */
  private async publishHeartbeat(): Promise<void> {
    if (this.stopped || this.options.clientMode) {
      return;
    }

    const prefix = this.options.redisPrefix;
    const nodeKey = `${prefix}:nodes:${this.nodeId}`;
    const heartbeatKey = `${prefix}:heartbeat:${this.nodeId}`;
    const nodesIndexKey = `${prefix}:index:nodes`;

    // Retry logic with exponential backoff
    const maxRetries = this.options.maxRetries;
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Execute Lua script atomically
        await this.redis.eval(
          REGISTER_HEARTBEAT_SCRIPT,
          3,
          nodeKey,
          heartbeatKey,
          nodesIndexKey,
          this.nodeId,
          this.address,
          JSON.stringify(this.services),
          Date.now().toString(),
          Math.ceil(this.options.heartbeatTTL / 1000).toString(),
          this.options.heartbeatTTL.toString()
        );

        // Determine event type
        const eventType = this.registered ? 'NODE_UPDATED' : 'NODE_REGISTERED';

        // Update registration status
        if (!this.registered) {
          this.registered = true;
        }

        // Log retry success
        if (attempt > 1) {
          this.logger.info(`Heartbeat succeeded after ${attempt} attempts`);
        }

        // Publish event
        if (this.options.pubSubEnabled) {
          await this.publishEvent(eventType);
        }

        return;
      } catch (error) {
        lastError = error as Error;
        this.logger.warn({ error, attempt }, 'Heartbeat attempt failed');

        if (attempt < maxRetries) {
          // Exponential backoff
          await new Promise((resolve) =>
            setTimeout(resolve, this.options.retryDelay * Math.pow(2, attempt - 1))
          );
        }
      }
    }

    // All retries failed
    this.logger.error({ error: lastError }, `All ${maxRetries} heartbeat attempts failed`);
  }

  /**
   * Clean up inactive nodes from Redis
   */
  private async cleanupInactiveNodes(nodeIds: string[]): Promise<void> {
    const prefix = this.options.redisPrefix;
    const pipeline = this.redis.pipeline();

    nodeIds.forEach((id) => {
      pipeline.del(`${prefix}:nodes:${id}`);
      pipeline.del(`${prefix}:heartbeat:${id}`);
      pipeline.srem(`${prefix}:index:nodes`, id);
    });

    await pipeline.exec();
    this.logger.debug({ nodeIds }, 'Cleaned up inactive nodes');
  }

  /**
   * Set up Redis PubSub for event propagation
   */
  private async setupPubSub(): Promise<void> {
    // Clone Redis connection for subscriber
    this.subscriber = this.redis.duplicate();

    // Subscribe to discovery channel
    await this.subscriber.subscribe(this.options.pubSubChannel);

    // Handle incoming messages
    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel === this.options.pubSubChannel) {
        try {
          const event = JSON.parse(message) as DiscoveryEvent;

          // Don't process our own events
          if (event.nodeId !== this.nodeId) {
            this.eventEmitter.emit('discovery:event', event);
            this.logger.debug({ event }, 'Received discovery event');
          }
        } catch (error) {
          this.logger.error({ error, message }, 'Failed to parse discovery event');
        }
      }
    });

    this.logger.debug('PubSub setup completed');
  }

  /**
   * Unsubscribe from Redis PubSub events
   */
  private async unsubscribeFromEvents(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.options.pubSubChannel);
      this.subscriber.disconnect();
      this.subscriber = undefined;
      this.logger.debug('Unsubscribed from PubSub events');
    }
  }

  /**
   * Publish an event to the PubSub channel
   */
  private async publishEvent(
    type: DiscoveryEvent['type'],
    nodeId?: string
  ): Promise<void> {
    if (!this.options.pubSubEnabled || !this.redis) {
      return;
    }

    const event: DiscoveryEvent = {
      type,
      nodeId: nodeId || this.nodeId,
      address: this.address,
      services: this.services,
      timestamp: Date.now(),
    };

    try {
      await this.redis.publish(this.options.pubSubChannel, JSON.stringify(event));
      this.logger.debug({ event }, 'Published discovery event');
    } catch (error) {
      this.logger.error({ error, event }, 'Failed to publish discovery event');
    }
  }

  /**
   * Get the current node ID
   */
  getNodeId(): string {
    return this.nodeId;
  }

  /**
   * Get the current node address
   */
  getAddress(): string {
    return this.address;
  }

  /**
   * Get the current node's services
   */
  getServices(): ServiceInfo[] {
    return [...this.services];
  }

  /**
   * Check if the service is registered
   */
  isRegistered(): boolean {
    return this.registered;
  }

  /**
   * Find all active nodes
   */
  async findNodes(): Promise<NodeInfo[]> {
    const prefix = this.options.redisPrefix;
    const nodesIndexKey = `${prefix}:index:nodes`;

    try {
      const nodeIds = await this.redis.smembers(nodesIndexKey);
      const nodes: NodeInfo[] = [];

      for (const nodeId of nodeIds) {
        const nodeKey = `${prefix}:nodes:${nodeId}`;
        const nodeData = await this.redis.hgetall(nodeKey);

        if (nodeData && nodeData['address']) {
          // Check if node is active
          const isActive = await this.isNodeActive(nodeId);

          if (isActive) {
            nodes.push({
              nodeId,
              address: nodeData['address'],
              services: JSON.parse(nodeData['services'] || '[]'),
              timestamp: parseInt(nodeData['timestamp'] || '0')
            });
          }
        }
      }

      return nodes;
    } catch (error) {
      this.logger.error({ error }, 'Failed to find nodes');
      return [];
    }
  }


  /**
   * Get all nodes (active and inactive)
   */
  async getAllNodes(): Promise<NodeInfo[]> {
    const prefix = this.options.redisPrefix;
    const nodesIndexKey = `${prefix}:index:nodes`;

    try {
      const nodeIds = await this.redis.smembers(nodesIndexKey);
      const nodes: NodeInfo[] = [];

      for (const nodeId of nodeIds) {
        const nodeKey = `${prefix}:nodes:${nodeId}`;
        const nodeData = await this.redis.hgetall(nodeKey);

        if (nodeData && nodeData['address']) {
          nodes.push({
            nodeId,
            address: nodeData['address'],
            services: JSON.parse(nodeData['services'] || '[]'),
            timestamp: parseInt(nodeData['timestamp'] || '0')
          });
        }
      }

      return nodes;
    } catch (error) {
      this.logger.error({ error }, 'Failed to get all nodes');
      return [];
    }
  }

  /**
   * Get information about a specific node
   */
  async getNodeInfo(nodeId: string): Promise<NodeInfo | null> {
    const prefix = this.options.redisPrefix;
    const nodeKey = `${prefix}:nodes:${nodeId}`;

    try {
      const nodeData = await this.redis.hgetall(nodeKey);

      if (!nodeData || !nodeData['address']) {
        return null;
      }

      return {
        nodeId,
        address: nodeData['address'],
        services: JSON.parse(nodeData['services'] || '[]'),
        timestamp: parseInt(nodeData['timestamp'] || '0')
      };
    } catch (error) {
      this.logger.error({ error, nodeId }, 'Failed to get node info');
      return null;
    }
  }

  /**
   * Check if a node exists
   */
  async nodeExists(nodeId: string): Promise<boolean> {
    const prefix = this.options.redisPrefix;
    const nodeKey = `${prefix}:nodes:${nodeId}`;

    try {
      const exists = await this.redis.exists(nodeKey);
      return exists === 1;
    } catch (error) {
      this.logger.error({ error, nodeId }, 'Failed to check node existence');
      return false;
    }
  }

  /**
   * Register a service
   */
  async registerService(service: ServiceInfo): Promise<void> {
    // Check if service already exists
    const exists = this.services.some(
      s => s.name === service.name && s.version === service.version
    );

    if (!exists) {
      this.services.push(service);

      // Trigger immediate heartbeat to update Redis
      if (this.registered && !this.options.clientMode) {
        await this.publishHeartbeat();
      }
    }
  }

  /**
   * Unregister a service by name
   */
  async unregisterService(serviceName: string): Promise<void> {
    this.services = this.services.filter(s => s.name !== serviceName);

    // Trigger immediate heartbeat to update Redis
    if (this.registered && !this.options.clientMode) {
      await this.publishHeartbeat();
    }
  }

  /**
   * Update services (replace all)
   */
  async updateServices(services: ServiceInfo[]): Promise<void> {
    this.services = [...services];

    // Trigger immediate heartbeat to update Redis
    if (this.registered && !this.options.clientMode) {
      await this.publishHeartbeat();
    }
  }

  /**
   * Update the node's address
   */
  async updateAddress(address: string): Promise<void> {
    this.address = address;

    // Trigger immediate heartbeat to update Redis
    if (this.registered && !this.options.clientMode) {
      await this.publishHeartbeat();
    }
  }

  /**
   * Generate a unique node ID
   */
  private generateNodeId(): string {
    return `titan-${process.pid}-${Date.now()}-${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Detect the node's address automatically
   */
  private detectAddress(): string {
    // This is a placeholder - in production, you'd detect the actual network address
    return `${process.env['HOST'] || 'localhost'}:${process.env['PORT'] || '3000'}`;
  }
}
