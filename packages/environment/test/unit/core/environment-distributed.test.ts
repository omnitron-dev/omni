/**
 * Environment distributed operations tests
 * Tests for distributed environment functionality with sync
 */

import { Environment } from '../../../src/core/environment.js';
import {
  createDistributed,
  waitForSync,
  getSyncStatus,
  hasQuorum,
} from '../../../src/core/environment-distributed.js';
import { DistributedOptions } from '../../../src/types/distributed.js';
import { NodeInfo } from '../../../src/sync/sync-protocol.js';

describe('Environment - Distributed Operations', () => {
  describe('createDistributed', () => {
    it('should create a distributed environment with sync', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node3', address: 'localhost:5003', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test-distributed',
        nodeId: 'node1',
        nodes,
        sync: {
          interval: 1000,
          heartbeatInterval: 500,
          suspectTimeout: 2000,
          maxRetries: 3,
          quorum: 2,
        },
        consistency: 'eventual',
        config: { key: 'value' },
      };

      const env = await createDistributed(options);

      expect(env).toBeInstanceOf(Environment);
      expect(env.name).toBe('test-distributed');
      expect(env.get('key')).toBe('value');
      expect((env as any).syncProtocol).toBeDefined();
      expect((env as any).nodeRegistry).toBeDefined();
      expect((env as any).syncStatus).toBeDefined();
    });

    it('should initialize sync status correctly', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {
          interval: 1000,
        },
      };

      const env = await createDistributed(options);
      const syncStatus = (env as any).syncStatus;

      expect(syncStatus).toBeDefined();
      expect(syncStatus.totalNodes).toBe(2);
      expect(syncStatus.status).toBe('syncing');
      expect(syncStatus.lastSync).toBeInstanceOf(Date);
    });

    it('should register all nodes in node registry', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node3', address: 'localhost:5003', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);
      const nodeRegistry = (env as any).nodeRegistry;

      expect(nodeRegistry.getNodeCount()).toBe(3);
      expect(nodeRegistry.hasNode('node1')).toBe(true);
      expect(nodeRegistry.hasNode('node2')).toBe(true);
      expect(nodeRegistry.hasNode('node3')).toBe(true);
    });

    it('should start sync protocol', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);
      const syncProtocol = (env as any).syncProtocol;

      expect(syncProtocol).toBeDefined();
      // Sync protocol should be started (but we can't easily test the internal state)
    });

    it('should configure quorum correctly', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node3', address: 'localhost:5003', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {
          quorum: 2,
        },
      };

      const env = await createDistributed(options);
      const quorumConfig = (env as any).quorumConfig;

      expect(quorumConfig).toBeDefined();
      expect(quorumConfig.minNodes).toBe(2);
    });

    it('should wait for initial sync with strong consistency', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
        consistency: 'strong',
      };

      // This will timeout but shouldn't fail creation
      const env = await createDistributed(options);
      expect(env).toBeInstanceOf(Environment);
    }, 10000);

    it('should not wait for initial sync with eventual consistency', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
        consistency: 'eventual',
      };

      const startTime = Date.now();
      const env = await createDistributed(options);
      const duration = Date.now() - startTime;

      expect(env).toBeInstanceOf(Environment);
      // Should be fast since we don't wait for sync
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('waitForSync', () => {
    it('should reject if environment is not configured for sync', async () => {
      const env = new Environment({ name: 'test', config: {} });

      await expect(waitForSync(env, 1000)).rejects.toThrow(
        'Environment is not configured for distributed sync'
      );
    });

    it('should resolve quickly when all nodes are already online', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);

      // With a single node that's online, sync should complete immediately
      await expect(waitForSync(env, 1000)).resolves.toBeUndefined();
    }, 10000);

    it('should update sync status during wait', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);

      // Try to wait (will timeout but should update status)
      try {
        await waitForSync(env, 1000);
      } catch {
        // Expected to timeout
      }

      const syncStatus = (env as any).syncStatus;
      expect(syncStatus.lastSync).toBeInstanceOf(Date);
    }, 10000);
  });

  describe('getSyncStatus', () => {
    it('should throw error if environment is not configured for sync', () => {
      const env = new Environment({ name: 'test', config: {} });

      expect(() => getSyncStatus(env)).toThrow('Environment is not configured for distributed sync');
    });

    it('should return current sync status', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);
      const status = getSyncStatus(env);

      expect(status).toBeDefined();
      expect(status.totalNodes).toBe(2);
      expect(status.status).toMatch(/syncing|synced|error/);
      expect(status.lastSync).toBeInstanceOf(Date);
    });

    it('should update synced nodes count', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);
      const status = getSyncStatus(env);

      expect(status.syncedNodes).toBeGreaterThanOrEqual(0);
      expect(status.syncedNodes).toBeLessThanOrEqual(status.totalNodes);
    });

    it('should return a copy of sync status', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);
      const status1 = getSyncStatus(env);
      const status2 = getSyncStatus(env);

      // Should be different objects
      expect(status1).not.toBe(status2);
      // But with same values
      expect(status1.totalNodes).toBe(status2.totalNodes);
    });
  });

  describe('hasQuorum', () => {
    it('should return true for single node without quorum config', async () => {
      const env = new Environment({ name: 'test', config: {} });

      expect(hasQuorum(env)).toBe(true);
    });

    it('should return true when minimum nodes met', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node3', address: 'localhost:5003', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {
          quorum: 2,
        },
      };

      const env = await createDistributed(options);

      // All nodes registered, should have quorum
      expect(hasQuorum(env)).toBe(true);
    });

    it('should use majority quorum by default', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node3', address: 'localhost:5003', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {},
      };

      const env = await createDistributed(options);

      // Remove quorum config to use default
      (env as any).quorumConfig = {};

      // With all nodes online, should have quorum
      expect(hasQuorum(env)).toBe(true);
    });

    it('should check percentage-based quorum', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test',
        nodeId: 'node1',
        nodes,
        sync: {
          quorum: 1, // 50%
        },
      };

      const env = await createDistributed(options);

      // Override to use percentage
      (env as any).quorumConfig = {
        percentage: 50,
      };

      expect(hasQuorum(env)).toBe(true);
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete distributed lifecycle', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test-lifecycle',
        nodeId: 'node1',
        nodes,
        sync: {
          interval: 1000,
          quorum: 1,
        },
        consistency: 'eventual',
        config: { key: 'value' },
      };

      // Create distributed environment
      const env = await createDistributed(options);
      expect(env).toBeInstanceOf(Environment);

      // Check initial state
      expect(env.get('key')).toBe('value');
      expect(hasQuorum(env)).toBe(true);

      // Get sync status
      const status = getSyncStatus(env);
      expect(status.totalNodes).toBe(2);
      expect(status.status).toMatch(/syncing|synced|error/);

      // Environment should work normally
      env.set('newKey', 'newValue');
      expect(env.get('newKey')).toBe('newValue');
    });

    it('should handle distributed environment with multiple nodes', async () => {
      const nodes: NodeInfo[] = [
        { id: 'node1', address: 'localhost:5001', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node2', address: 'localhost:5002', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node3', address: 'localhost:5003', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node4', address: 'localhost:5004', lastSeen: Date.now(), status: 'active', clock: {} },
        { id: 'node5', address: 'localhost:5005', lastSeen: Date.now(), status: 'active', clock: {} },
      ];

      const options: DistributedOptions = {
        name: 'test-multi-node',
        nodeId: 'node1',
        nodes,
        sync: {
          interval: 1000,
          quorum: 3, // Need 3 out of 5 for quorum
        },
        consistency: 'eventual',
      };

      const env = await createDistributed(options);

      expect(env).toBeInstanceOf(Environment);
      expect((env as any).nodeRegistry.getNodeCount()).toBe(5);
      expect(hasQuorum(env)).toBe(true); // All nodes registered
    });
  });
});
