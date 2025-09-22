/**
 * Service Discovery Types for Titan Framework
 * 
 * Provides type definitions for distributed service discovery functionality
 * in the Titan application framework.
 */

/**
 * Represents information about a network node in the service discovery system.
 * This interface encapsulates all essential metadata required to identify and connect to a node.
 */
export interface NodeInfo {
  /** Unique identifier of the node within the network */
  nodeId: string;
  /** Network address where the node can be reached (e.g., "host:port") */
  address: string;
  /** Array of services available on this node */
  services: ServiceInfo[];
  /** Unix timestamp indicating when this node information was last updated */
  timestamp: number;
}

/**
 * Describes a service available in the network.
 * This interface provides the basic identification information for a service.
 */
export interface ServiceInfo {
  /** Unique name of the service */
  name: string;
  /** Optional version identifier of the service */
  version?: string;
}

/**
 * Configuration options for the service discovery mechanism.
 * These parameters control the behavior of the heartbeat system and event propagation
 * within the distributed service discovery system.
 */
export interface DiscoveryOptions {
  /** 
   * Time interval in milliseconds between consecutive heartbeat messages.
   * Lower values increase network traffic but improve failure detection speed.
   * @default 5000
   */
  heartbeatInterval?: number;
  
  /** 
   * Time-to-live in milliseconds for heartbeat records in the discovery system.
   * Should be greater than heartbeatInterval to allow for network delays.
   * @default 15000
   */
  heartbeatTTL?: number;
  
  /** 
   * Enables or disables Redis Pub/Sub event broadcasting functionality.
   * When enabled, the system will publish node registration, update, and deregistration events.
   * @default false
   */
  pubSubEnabled?: boolean;
  
  /** 
   * Redis Pub/Sub channel name for service discovery events.
   * All nodes in the network should use the same channel for proper event propagation.
   * @default 'titan:discovery:events'
   */
  pubSubChannel?: string;
  
  /**
   * Client mode flag - when true, disables heartbeat and node registration.
   * Useful for clients that only need to discover services without registering.
   * @default false
   */
  clientMode?: boolean;
  
  /**
   * Redis key prefix for all discovery-related keys.
   * @default 'titan:discovery'
   */
  redisPrefix?: string;
  
  /**
   * Maximum retry attempts for critical operations like heartbeat.
   * @default 3
   */
  maxRetries?: number;
  
  /**
   * Initial retry delay in milliseconds for exponential backoff.
   * @default 1000
   */
  retryDelay?: number;
}

/**
 * Represents an event that occurs within the service discovery system.
 * This interface defines the structure of events that are published when nodes
 * register, update their status, or deregister from the network.
 */
export interface DiscoveryEvent {
  /** The type of discovery event */
  type: 'NODE_REGISTERED' | 'NODE_UPDATED' | 'NODE_DEREGISTERED';
  /** The unique identifier of the node associated with this event */
  nodeId: string;
  /** The network address where the node can be reached */
  address: string;
  /** An array of services that are available on the node at the time of the event */
  services: ServiceInfo[];
  /** Unix timestamp indicating when this event occurred */
  timestamp: number;
}

/**
 * Interface for the Discovery Service within Titan
 */
export interface IDiscoveryService {
  /** Start the discovery service */
  start(): Promise<void>;
  
  /** Stop the discovery service */
  stop(): Promise<void>;
  
  /** Register a node with given services */
  registerNode(nodeId: string, address: string, services: ServiceInfo[]): Promise<void>;
  
  /** Deregister a node */
  deregisterNode(nodeId: string): Promise<void>;
  
  /** Get all active nodes */
  getActiveNodes(): Promise<NodeInfo[]>;
  
  /** Find nodes by service name */
  findNodesByService(serviceName: string, version?: string): Promise<NodeInfo[]>;
  
  /** Check if a node is active */
  isNodeActive(nodeId: string): Promise<boolean>;
  
  /** Update node address */
  updateNodeAddress(nodeId: string, address: string): Promise<void>;
  
  /** Update node services */
  updateNodeServices(nodeId: string, services: ServiceInfo[]): Promise<void>;
  
  /** Subscribe to discovery events */
  onEvent(handler: (event: DiscoveryEvent) => void): void;
  
  /** Unsubscribe from discovery events */
  offEvent(handler: (event: DiscoveryEvent) => void): void;
}

import { createToken, type Token } from '@nexus';
import type { Redis } from 'ioredis';
import type { ILogger } from '../logger/logger.types.js';

/**
 * Tokens for dependency injection
 */
export const DISCOVERY_SERVICE_TOKEN: Token<IDiscoveryService> = createToken<IDiscoveryService>('DiscoveryService');
export const REDIS_TOKEN: Token<Redis> = createToken<Redis>('Redis');
export const LOGGER_TOKEN: Token<ILogger> = createToken<ILogger>('Logger');
export const DISCOVERY_OPTIONS_TOKEN: Token<DiscoveryOptions> = createToken<DiscoveryOptions>('DiscoveryOptions');
