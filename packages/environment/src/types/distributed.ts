/**
 * Distributed environment types
 * Types for distributed synchronization and coordination
 */

import { NodeInfo } from '../sync/sync-protocol.js';
import { VectorClock } from '../crdt/vector-clock.js';

/**
 * Consistency level for distributed operations
 */
export type ConsistencyLevel = 'eventual' | 'strong' | 'causal';

/**
 * Conflict resolution strategy
 */
export type ConflictStrategy = 'last-write-wins' | 'first-write-wins' | 'merge' | 'manual';

/**
 * Conflict resolution configuration
 */
export interface ConflictConfig {
  strategy: ConflictStrategy;
  mergeFn?: (local: any, remote: any) => any;
  onConflict?: (key: string, local: any, remote: any) => void;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  interval?: number;
  heartbeatInterval?: number;
  suspectTimeout?: number;
  maxRetries?: number;
  quorum?: number;
}

/**
 * Options for creating a distributed environment
 */
export interface DistributedOptions {
  name: string;
  nodeId: string;
  nodes: NodeInfo[];
  sync: SyncConfig;
  consistency?: ConsistencyLevel;
  conflicts?: ConflictConfig;
  schema?: any;
  config?: Record<string, any>;
}

/**
 * Sync status for distributed environment
 */
export interface SyncStatus {
  syncedNodes: number;
  totalNodes: number;
  lastSync: Date;
  status: 'syncing' | 'synced' | 'error';
  error?: Error;
  clock?: VectorClock;
}

/**
 * Quorum configuration
 */
export interface QuorumConfig {
  minNodes?: number;
  percentage?: number;
}
