/**
 * Distributed environment operations
 * Extension methods for distributed sync functionality
 */

import { Environment } from './environment.js';
import { DistributedOptions, SyncStatus } from '../types/distributed.js';
import { SyncProtocol } from '../sync/sync-protocol.js';
import { NodeRegistry } from '../sync/node-registry.js';
import { Schema } from '../types/schema.js';

/**
 * Create a distributed environment with synchronization
 */
export async function createDistributed<T extends Schema>(
  options: DistributedOptions
): Promise<Environment<T>> {
  // Create the base environment
  const env = new Environment<T>({
    name: options.name,
    schema: options.schema,
    config: options.config || {},
  });

  // Initialize node registry
  (env as any).nodeRegistry = new NodeRegistry({
    heartbeatInterval: options.sync.heartbeatInterval,
    timeoutThreshold: options.sync.suspectTimeout,
  });

  // Register all nodes
  for (const node of options.nodes) {
    (env as any).nodeRegistry.register(node);
  }

  // Initialize sync protocol
  (env as any).syncProtocol = new SyncProtocol({
    nodeId: options.nodeId,
    heartbeatInterval: options.sync.heartbeatInterval,
    syncInterval: options.sync.interval,
    suspectTimeout: options.sync.suspectTimeout,
    maxRetries: options.sync.maxRetries,
  });

  // Set quorum config
  (env as any).quorumConfig = {
    minNodes: options.sync.quorum,
    percentage: options.sync.quorum ? (options.sync.quorum / options.nodes.length) * 100 : undefined,
  };

  // Initialize sync status
  (env as any).syncStatus = {
    syncedNodes: 0,
    totalNodes: options.nodes.length,
    lastSync: new Date(),
    status: 'syncing' as const,
  };

  // Start node registry
  (env as any).nodeRegistry.start();

  // Start sync protocol
  await (env as any).syncProtocol.start();

  // Wait for initial sync (optional, based on consistency level)
  if (options.consistency === 'strong') {
    try {
      await waitForSync(env);
    } catch (error) {
      // Log error but don't fail creation
      console.warn('Initial sync failed:', error);
    }
  }

  return env;
}

/**
 * Wait for environment to sync with all nodes
 */
export async function waitForSync<T extends Schema>(
  env: Environment<T>,
  timeout: number = 30000
): Promise<void> {
  const syncProtocol = (env as any).syncProtocol;
  const nodeRegistry = (env as any).nodeRegistry;

  if (!syncProtocol || !nodeRegistry) {
    throw new Error('Environment is not configured for distributed sync');
  }

  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const checkSync = async () => {
      try {
        const onlineNodes = nodeRegistry.getOnlineNodes();
        const totalNodes = nodeRegistry.getNodeCount();

        // Update sync status
        const syncStatus = (env as any).syncStatus;
        if (syncStatus) {
          syncStatus.syncedNodes = onlineNodes.length;
          syncStatus.totalNodes = totalNodes;
          syncStatus.lastSync = new Date();
        }

        // Check if we have quorum
        const quorum = hasQuorum(env);

        if (quorum && onlineNodes.length === totalNodes) {
          // All nodes online
          if (syncStatus) {
            syncStatus.status = 'synced';
          }
          resolve();
        } else if (Date.now() - startTime > timeout) {
          // Timeout exceeded
          const error = new Error(`Sync timeout: ${onlineNodes.length}/${totalNodes} nodes online`);
          if (syncStatus) {
            syncStatus.status = 'error';
            syncStatus.error = error;
          }
          reject(error);
        } else {
          // Continue waiting
          setTimeout(checkSync, 500);
        }
      } catch (error) {
        const syncStatus = (env as any).syncStatus;
        if (syncStatus) {
          syncStatus.status = 'error';
          syncStatus.error = error as Error;
        }
        reject(error);
      }
    };

    // Start checking
    checkSync();
  });
}

/**
 * Get current sync status
 */
export function getSyncStatus<T extends Schema>(env: Environment<T>): SyncStatus {
  const syncStatus = (env as any).syncStatus;

  if (!syncStatus) {
    throw new Error('Environment is not configured for distributed sync');
  }

  // Update with current node registry state
  const nodeRegistry = (env as any).nodeRegistry;
  if (nodeRegistry) {
    const onlineNodes = nodeRegistry.getOnlineNodes();
    syncStatus.syncedNodes = onlineNodes.length;
    syncStatus.totalNodes = nodeRegistry.getNodeCount();
  }

  return { ...syncStatus };
}

/**
 * Check if enough nodes are available for quorum
 */
export function hasQuorum<T extends Schema>(env: Environment<T>): boolean {
  const nodeRegistry = (env as any).nodeRegistry;
  const quorumConfig = (env as any).quorumConfig;

  if (!nodeRegistry || !quorumConfig) {
    // If no quorum configured, assume single node (always has quorum)
    return true;
  }

  const onlineNodes = nodeRegistry.getOnlineNodes().length;
  const totalNodes = nodeRegistry.getNodeCount();

  // Check minimum nodes requirement
  if (quorumConfig.minNodes !== undefined) {
    return onlineNodes >= quorumConfig.minNodes;
  }

  // Check percentage requirement
  if (quorumConfig.percentage !== undefined) {
    const percentage = (onlineNodes / totalNodes) * 100;
    return percentage >= quorumConfig.percentage;
  }

  // Default: majority quorum (> 50%)
  return onlineNodes > totalNodes / 2;
}
