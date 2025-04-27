import fs from 'node:fs';
import path from 'node:path';
import { Logger } from 'pino';
import { Redis } from 'ioredis';

import { Netron } from '../netron';
import { NodeInfo, ServiceInfo, DiscoveryEvent, DiscoveryOptions } from './types';

/**
 * Default interval in milliseconds for sending periodic heartbeat signals to Redis.
 * This interval determines how frequently a node updates its presence in the discovery system.
 */
const DEFAULT_HEARTBEAT_INTERVAL = 5000;

/**
 * Default Time-To-Live (TTL) in milliseconds for heartbeat keys in Redis.
 * If a node fails to update its heartbeat within this period, it will be considered inactive
 * and automatically deregistered from the discovery system.
 */
const DEFAULT_HEARTBEAT_TTL = 15000;

/**
 * Lua script for atomic registration of node heartbeats in Redis.
 * The script is loaded from the filesystem and executed as a single transaction.
 */
const REGISTER_HEARTBEAT_SCRIPT = fs.readFileSync(path.join(__dirname, '../../lua/register-heartbeat.lua'), 'utf8');

/**
 * ServiceDiscovery class implements a distributed service discovery mechanism using Redis
 * as a coordination backend. It provides functionality for:
 * - Node registration and heartbeat management
 * - Service discovery and lookup
 * - Automatic cleanup of inactive nodes
 * - Dynamic service and address updates
 * 
 * @remarks
 * The implementation uses Redis keys with the following patterns:
 * - `netron:discovery:nodes:{nodeId}` - Hash containing node metadata
 * - `netron:discovery:heartbeat:{nodeId}` - Key indicating node liveness
 * - `netron:discovery:index:nodes` - Set containing all registered node IDs
 */
export class ServiceDiscovery {
  /** Redis client instance used for all coordination operations */
  private redis: Redis;

  /** Globally unique identifier for this node instance */
  private nodeId: string;

  /** Network address where this node can be reached */
  private address: string;

  /** Array of services provided by this node */
  private services: ServiceInfo[];

  /** Reference to the interval timer for periodic heartbeat updates */
  private heartbeatTimer?: NodeJS.Timeout;

  /** Configuration options with default values applied */
  private options: Required<DiscoveryOptions>;
  /**
   * Redis PubSub channel name used for broadcasting service discovery events.
   * This channel is used to notify other nodes about changes in the service discovery system,
   * such as node registration, deregistration, or service updates.
   * 
   * @private
   * @readonly
   */
  private readonly pubSubChannel: string;

  /**
   * Redis subscriber instance for receiving PubSub events.
   * This subscriber is used to listen for service discovery events from other nodes
   * and react to changes in the distributed system state.
   * 
   * @private
   * @optional
   */
  private subscriber?: Redis;

  /**
   * Flag indicating whether the service discovery instance has been stopped.
   * This flag is used to prevent operations after shutdown and ensure
   * proper cleanup of resources.
   * 
   * @private
   */
  private stopped = false;

  /**
   * Promise that resolves when the shutdown process is complete.
   * This promise is used to coordinate graceful shutdown operations
   * and ensure all resources are properly cleaned up before the instance
   * is considered fully stopped.
   * 
   * @private
   * @optional
   */
  private shutdownPromise?: Promise<void>;
  /**
   * Flag indicating whether the current node has been successfully registered in the service discovery system.
   * This flag is used to track the registration state of the node and prevent duplicate registrations.
   * 
   * @private
   * @type {boolean}
   * 
   * @remarks
   * The registration state is managed as follows:
   * - Set to true after successful initial registration
   * - Set to false when the node is deregistered or during shutdown
   * - Used to prevent duplicate registration attempts
   * - Helps maintain consistency in the distributed system state
   * 
   * @example
   * // Checking registration status
   * if (!this.registered) {
   *   await this.registerNode();
   * }
   */
  private registered = false;

  /**
   * Logger instance for service discovery operations.
   * 
   * @description
   * This logger is used to record and track service discovery events, errors, and operational
   * information. It is initialized as a child logger of the main Netron logger, inheriting
   * its configuration while adding specific context for service discovery operations.
   * 
   * @remarks
   * The logger is configured with the following characteristics:
   * - Inherits base configuration from the parent Netron logger
   * - Includes additional context: { serviceDiscovery: true }
   * - Used throughout the service discovery lifecycle for:
   *   - Registration and deregistration events
   *   - Heartbeat operations
   *   - Error conditions and recovery attempts
   *   - Pub/Sub message handling
   *   - Shutdown procedures
   * 
   * @example
   * // Logging a service discovery event
   * this.logger.info('Node registration successful', { nodeId: this.nodeId });
   * 
   * // Logging an error condition
   * this.logger.error('Failed to publish heartbeat', { error: err });
   */
  public logger: Logger;

  /**
   * Constructs a new ServiceDiscovery instance with the specified configuration
   * 
   * @param redis - Redis client instance for distributed coordination
   * @param nodeId - Unique identifier for this node instance
   * @param address - Network address where this node can be reached
   * @param services - Array of services provided by this node
   * @param options - Optional configuration overrides for discovery behavior
   * 
   * @remarks
   * The constructor applies default values for heartbeat interval and TTL if not specified.
   * These defaults ensure reasonable behavior while allowing customization when needed.
   */
  constructor(redis: Redis, netron: Netron, address: string, services: ServiceInfo[], options?: DiscoveryOptions) {
    if (!redis) {
      throw new Error('Redis instance must be provided');
    }

    this.redis = redis;
    this.nodeId = netron.id;
    this.logger = netron.logger.child({ serviceDiscovery: true });
    this.address = address;
    this.services = services;
    this.options = {
      heartbeatInterval: options?.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL,
      heartbeatTTL: options?.heartbeatTTL ?? DEFAULT_HEARTBEAT_TTL,
      pubSubEnabled: options?.pubSubEnabled ?? false,
      pubSubChannel: options?.pubSubChannel ?? 'netron:discovery:events',
    };

    this.pubSubChannel = this.options.pubSubChannel;
  }

  /**
   * Initiates the heartbeat mechanism for this node
   * 
   * @remarks
   * This method performs two key operations:
   * 1. Immediately publishes the initial heartbeat
   * 2. Sets up a periodic timer to maintain node registration
   * 
   * The heartbeat interval is determined by the configured options.
   */
  public startHeartbeat(): void {
    this.publishHeartbeat();
    this.heartbeatTimer = setInterval(
      () => this.publishHeartbeat(),
      this.options.heartbeatInterval
    );
  }

  /**
   * Initiates a graceful shutdown sequence for the service discovery instance.
   * This method ensures proper cleanup of all resources and deregistration from the network.
   * 
   * @returns {Promise<void>} A promise that resolves when the shutdown sequence is complete.
   *                         If shutdown was already initiated, returns the existing shutdown promise.
   * 
   * @remarks
   * The shutdown sequence is idempotent and follows a specific order:
   * 1. Checks if shutdown was already initiated to prevent duplicate operations
   * 2. Stops the heartbeat mechanism by clearing the interval timer
   * 3. Deregisters the node from the discovery system
   * 4. Unsubscribes from Redis Pub/Sub events
   * 
   * Error Handling:
   * - Each major operation is wrapped in a try-catch block
   * - Errors are logged but don't prevent the shutdown sequence from continuing
   * - The method maintains a single shutdown promise to ensure consistent state
   * 
   * State Management:
   * - Sets the 'stopped' flag to prevent further operations
   * - Resets the 'registered' state after successful deregistration
   * - Cleans up all timer and subscription resources
   * 
   * @example
   * // Initiating a graceful shutdown
   * await serviceDiscovery.shutdown();
   * 
   * @throws {Error} If the shutdown sequence encounters critical errors
   *                that prevent proper cleanup
   */
  public async shutdown(): Promise<void> {
    if (this.stopped) {
      this.logger.info(`Graceful shutdown already initiated for node '${this.nodeId}'`);
      return this.shutdownPromise;
    }

    this.stopped = true;

    this.shutdownPromise = (async () => {
      this.logger.info(`Initiating graceful shutdown for node '${this.nodeId}'`);

      // Stop the heartbeat mechanism
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = undefined;
        this.logger.info(`Heartbeat interval cleared for node '${this.nodeId}'`);
      }

      // Deregister the node from the discovery system
      try {
        await this.deregisterNodeById(this.nodeId);
        this.registered = false; // Reset registration state
        this.logger.info(`Node '${this.nodeId}' successfully deregistered`);
      } catch (error) {
        this.logger.error(`Error during deregistration of node '${this.nodeId}'`, { error });
      }

      // Clean up Redis Pub/Sub subscriptions
      try {
        await this.unsubscribeFromEvents();
        this.logger.info(`Unsubscribed from Redis events for node '${this.nodeId}'`);
      } catch (error) {
        this.logger.error(`Error during Redis Pub/Sub unsubscribe for node '${this.nodeId}'`, { error });
      }

      this.logger.info(`Graceful shutdown completed for node '${this.nodeId}'`);
    })();

    return this.shutdownPromise;
  }

  /**
   * Publishes a heartbeat signal to Redis using a Lua script to maintain node presence in the discovery system.
   * 
   * @returns {Promise<void>} A promise that resolves when the heartbeat is successfully published
   * 
   * @throws {Error} If all retry attempts fail to publish the heartbeat
   * 
   * @remarks
   * The heartbeat mechanism is crucial for maintaining node presence in the distributed system.
   * This method implements a robust retry mechanism with exponential backoff to handle transient failures.
   * 
   * The heartbeat operation is performed atomically using a Lua script that:
   * 1. Updates the node's metadata hash with current information (address, services, timestamp)
   * 2. Sets the heartbeat key with the configured TTL to indicate node liveness
   * 3. Adds the node to the global index if not already present
   * 
   * Event Publishing:
   * - On first successful heartbeat: NODE_REGISTERED event
   * - On subsequent heartbeats: NODE_UPDATED event
   * 
   * Retry Strategy:
   * - Maximum of 3 retry attempts
   * - Exponential backoff delay between attempts (500ms * attempt number)
   * - Detailed logging of retry attempts and failures
   * 
   * @example
   * // Publishing a heartbeat with automatic retries
   * await serviceDiscovery.publishHeartbeat();
   */
  public async publishHeartbeat(): Promise<void> {
    // Prevent heartbeat publishing if shutdown has been initiated
    if (this.stopped) {
      this.logger.warn(`Attempted to publish heartbeat after shutdown initiated for node '${this.nodeId}'`);
      return;
    }

    // Define Redis keys for node metadata, heartbeat, and global index
    const nodeKey = `netron:discovery:nodes:${this.nodeId}`;
    const heartbeatKey = `netron:discovery:heartbeat:${this.nodeId}`;
    const nodesIndexKey = 'netron:discovery:index:nodes';

    // Implement retry mechanism with exponential backoff
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Execute the Lua script with all required parameters
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

        // Determine event type based on registration status
        const eventType = this.registered ? 'NODE_UPDATED' : 'NODE_REGISTERED';

        // Update registration status on first successful heartbeat
        if (!this.registered) {
          this.registered = true;
        }

        // Log successful retry if applicable
        if (attempt > 1) {
          this.logger.info(`Heartbeat succeeded after ${attempt} attempts`);
        }

        // Publish the appropriate event
        await this.publishEvent(eventType);
        return;
      } catch (error) {
        // Log failure and implement retry logic
        this.logger.error(`Heartbeat attempt ${attempt} failed`, { error });

        if (attempt === maxRetries) {
          this.logger.error(`All ${maxRetries} heartbeat attempts failed.`);
          throw error;
        }

        // Implement exponential backoff delay
        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }
  }

  /**
   * Retrieves information about all currently active nodes
   * 
   * @returns Promise that resolves to an array of NodeInfo objects
   * 
   * @remarks
   * This method implements a robust node discovery process:
   * 1. Retrieves all node IDs from the global index
   * 2. Uses Redis pipeline to efficiently fetch node data and heartbeat status
   * 3. Validates and parses node information
   * 4. Automatically cleans up inactive or invalid nodes
   * 
   * The method handles various edge cases including:
   * - Missing or corrupted node data
   * - Invalid JSON in service descriptions
   * - Missing heartbeat keys
   */
  public async getActiveNodes(): Promise<NodeInfo[]> {
    try {
      const nodeIds = await this.redis.smembers('netron:discovery:index:nodes');
      if (!nodeIds.length) return [];

      const pipeline = this.redis.pipeline();

      nodeIds.forEach((id) => {
        pipeline.hgetall(`netron:discovery:nodes:${id}`);
        pipeline.exists(`netron:discovery:heartbeat:${id}`);
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

        if (
          nodeDataErr ||
          heartbeatErr ||
          !heartbeatExists ||
          !nodeData ||
          typeof nodeData !== 'object'
        ) {
          nodesToDeregister.push(nodeId);
          continue;
        }

        const address = typeof nodeData['address'] === 'string' ? nodeData['address'] : null;
        const servicesRaw = typeof nodeData['services'] === 'string' ? nodeData['services'] : null;
        const timestampRaw = typeof nodeData['timestamp'] === 'string' ? nodeData['timestamp'] : null;

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

      if (nodesToDeregister.length > 0) {
        const deregisterPipeline = this.redis.pipeline();
        nodesToDeregister.forEach((id) => {
          deregisterPipeline
            .del(`netron:discovery:nodes:${id}`)
            .del(`netron:discovery:heartbeat:${id}`)
            .srem('netron:discovery:index:nodes', id);
        });
        await deregisterPipeline.exec();
      }

      return activeNodes;
    } catch (error) {
      this.logger.error(`Error fetching active nodes`, { error });
      throw error;
    }
  }

  /**
   * Discovers nodes that provide a specific service within the distributed network.
   * This method performs a filtered search across all active nodes to find those
   * that match the specified service criteria.
   * 
   * @param {string} name - The unique identifier of the service to search for
   * @param {string} [version] - Optional version constraint to filter service providers.
   *                            If specified, only nodes providing the exact version will be returned.
   * @returns {Promise<NodeInfo[]>} A promise that resolves to an array of NodeInfo objects,
   *                               each representing a node that provides the requested service.
   *                               The array will be empty if no matching nodes are found.
   * 
   * @example
   * // Find all nodes providing the 'auth' service
   * const authNodes = await discovery.findNodesByService('auth');
   * 
   * // Find nodes providing version 1.0.0 of the 'auth' service
   * const specificAuthNodes = await discovery.findNodesByService('auth', '1.0.0');
   */
  public async findNodesByService(name: string, version?: string): Promise<NodeInfo[]> {
    try {
      const activeNodes = await this.getActiveNodes();
      return activeNodes.filter(node =>
        node.services.some(svc =>
          svc.name === name && (!version || svc.version === version)
        )
      );
    } catch (error) {
      this.logger.error(`Error finding nodes by service '${name}' (version: ${version})`, { error });
      throw error;
    }
  }

  /**
   * Subscribes to service discovery events published through Redis PubSub.
   * This method establishes a dedicated Redis subscriber connection and sets up
   * event handling for service discovery notifications.
   * 
   * @param {function} handler - Callback function that processes incoming discovery events.
   *                            The handler receives a parsed DiscoveryEvent object containing
   *                            details about node registration, updates, or deregistration.
   * @returns {Promise<void>} A promise that resolves when the subscription is established.
   * 
   * @remarks
   * The subscription process:
   * 1. Validates that PubSub is enabled and the instance hasn't been stopped
   * 2. Creates a new Redis subscriber instance with the same configuration as the main client
   * 3. Subscribes to the configured PubSub channel
   * 4. Sets up message handling with error protection and state validation
   * 
   * @throws {Error} If Redis subscription fails
   * 
   * @example
   * // Subscribing to service discovery events
   * await discovery.subscribeToEvents((event) => {
   *   switch (event.type) {
   *     case 'NODE_REGISTERED':
   *       this.logger.log(`New node registered: ${event.nodeId}`);
   *       break;
   *     case 'NODE_UPDATED':
   *       this.logger.log(`Node updated: ${event.nodeId}`);
   *       break;
   *     case 'NODE_DEREGISTERED':
   *       this.logger.log(`Node deregistered: ${event.nodeId}`);
   *       break;
   *   }
   * });
   */
  public async subscribeToEvents(handler: (event: DiscoveryEvent) => void): Promise<void> {
    // Early return if PubSub is disabled or instance is stopped
    if (!this.options.pubSubEnabled || this.stopped) return;

    // Create a new Redis subscriber instance with the same configuration
    this.subscriber = new Redis(this.redis.options);

    // Subscribe to the configured PubSub channel
    await this.subscriber.subscribe(this.pubSubChannel);

    // Set up message handling with error protection
    this.subscriber.on('message', (_, message) => {
      // Skip message processing if instance has been stopped
      if (this.stopped) return;

      try {
        // Parse and process the incoming event
        const event: DiscoveryEvent = JSON.parse(message);
        handler(event);
      } catch (error) {
        // Log parsing or handler errors without breaking the subscription
        this.logger.error('Error processing Redis event:', error);
      }
    });
  }

  /**
   * Removes a node from the service discovery system and cleans up all associated data.
   * This method performs an atomic transaction to ensure consistent removal of all
   * node-related data from Redis.
   * 
   * @param {string} nodeId - The unique identifier of the node to deregister
   * @returns {Promise<void>} A promise that resolves when the deregistration is complete
   * 
   * @remarks
   * The deregistration process:
   * 1. Removes the node's metadata from the nodes hash
   * 2. Deletes the node's heartbeat key
   * 3. Removes the node ID from the global node index
   * 
   * All operations are performed within a single Redis transaction to maintain consistency.
   */
  private async deregisterNodeById(nodeId: string): Promise<void> {
    const nodeKey = `netron:discovery:nodes:${nodeId}`;
    const heartbeatKey = `netron:discovery:heartbeat:${nodeId}`;

    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.redis
          .multi()
          .del(nodeKey, heartbeatKey)
          .srem('netron:discovery:index:nodes', nodeId)
          .exec();

        if (attempt > 1) {
          this.logger.info(`Deregistration of node '${nodeId}' succeeded after ${attempt} attempts`);
        }

        await this.publishEvent('NODE_DEREGISTERED');
        return;
      } catch (error) {
        this.logger.error(`Deregistration attempt ${attempt} for node '${nodeId}' failed`, { error });

        if (attempt === maxRetries) {
          this.logger.error(`All ${maxRetries} deregistration attempts for node '${nodeId}' failed.`);
          throw error;
        }

        await new Promise((res) => setTimeout(res, 500 * attempt));
      }
    }
  }

  /**
   * Verifies the current status of a specific node in the discovery system.
   * This method checks the node's heartbeat and automatically cleans up
   * the node's data if it's found to be inactive.
   * 
   * @param {string} nodeId - The unique identifier of the node to check
   * @returns {Promise<boolean>} A promise that resolves to true if the node is active,
   *                            false if the node is inactive or has been deregistered
   * 
   * @remarks
   * The check process:
   * 1. Verifies the existence of the node's heartbeat key
   * 2. If the heartbeat is missing, triggers automatic deregistration
   * 3. Returns the node's active status
   */
  public async isNodeActive(nodeId: string): Promise<boolean> {
    try {
      const heartbeatKey = `netron:discovery:heartbeat:${nodeId}`;
      const exists = await this.redis.exists(heartbeatKey);
      if (!exists) {
        await this.deregisterNodeById(nodeId);
      }
      return exists === 1;
    } catch (error) {
      this.logger.error(`Error checking if node '${nodeId}' is active`, { error });
      throw error;
    }
  }

  /**
   * Updates the service registry for the current node.
   * This method updates the local service list and immediately publishes
   * the changes to the discovery system.
   * 
   * @param {ServiceInfo[]} services - An array of ServiceInfo objects representing
   *                                  the updated list of services provided by this node
   * @returns {Promise<void>} A promise that resolves when the update is complete
   * 
   * @remarks
   * The update process:
   * 1. Updates the local service registry
   * 2. Triggers an immediate heartbeat to propagate the changes
   * 3. Ensures other nodes in the network receive the updated service information
   */
  public async updateServices(services: ServiceInfo[]): Promise<void> {
    if (this.stopped) {
      this.logger.warn(`Attempted to update services after shutdown initiated for node '${this.nodeId}'`);
      return;
    }
    this.services = services;
    try {
      await this.publishHeartbeat();
    } catch (error) {
      this.logger.error(`Error updating services`, { error });
      throw error;
    }
  }

  /**
   * Updates the network address of the current node.
   * This method changes the node's address and immediately notifies
   * the discovery system of the change.
   * 
   * @param {string} address - The new network address where this node can be reached
   * @returns {Promise<void>} A promise that resolves when the update is complete
   * 
   * @remarks
   * The update process:
   * 1. Updates the local address
   * 2. Triggers an immediate heartbeat to propagate the change
   * 3. Ensures other nodes in the network receive the updated address information
   */
  public async updateAddress(address: string): Promise<void> {
    if (this.stopped) {
      this.logger.warn(`Attempted to update address after shutdown initiated for node '${this.nodeId}'`);
      return;
    }
    this.address = address;
    try {
      await this.publishHeartbeat();
    } catch (error) {
      this.logger.error(`Error updating address to '${address}'`, { error });
      throw error;
    }
  }

  /**
   * Publishes a service discovery event to the Redis PubSub channel.
   * This method is responsible for broadcasting node state changes to all
   * subscribers in the distributed system.
   * 
   * @param {('NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED')} type - The type of event being published
   * @returns {Promise<void>} A promise that resolves when the event has been published
   * 
   * @private
   * 
   * @remarks
   * The event payload includes:
   * - Event type indicating the nature of the change
   * - Node identifier for tracking the source
   * - Current network address of the node
   * - Array of services provided by the node
   * - Timestamp of the event for temporal ordering
   * 
   * @throws {Error} If Redis publish operation fails
   * 
   * @example
   * // Publishing a node registration event
   * await publishEvent('NODE_REGISTERED');
   */
  private async publishEvent(type: 'NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED'): Promise<void> {
    // Skip event publishing if PubSub functionality is disabled
    if (!this.options.pubSubEnabled) return;

    // Construct the event payload with current node state
    const eventPayload = {
      type,
      nodeId: this.nodeId,
      address: this.address,
      services: this.services,
      timestamp: Date.now(),
    };

    // Publish the event to the configured Redis PubSub channel
    await this.redis.publish(this.pubSubChannel, JSON.stringify(eventPayload));
  }

  /**
   * Unsubscribes from Redis PubSub events and cleans up the subscriber instance.
   * This method is part of the graceful shutdown process and ensures proper cleanup
   * of Redis PubSub resources.
   * 
   * @returns {Promise<void>} A promise that resolves when the unsubscribe operation is complete
   * 
   * @private
   * 
   * @remarks
   * The method performs the following operations in sequence:
   * 1. Checks if a subscriber instance exists
   * 2. Unsubscribes from the configured PubSub channel
   * 3. Disconnects the Redis subscriber client
   * 4. Clears the subscriber reference to allow garbage collection
   * 
   * @throws {Error} If Redis unsubscribe or disconnect operations fail
   * 
   * @example
   * // Unsubscribing from events during shutdown
   * await unsubscribeFromEvents();
   */
  private async unsubscribeFromEvents(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(this.pubSubChannel);
      this.subscriber.disconnect();
      this.subscriber = undefined;
    }
  }
}
