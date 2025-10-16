/**
 * Node Registry Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NodeRegistry } from '../../../src/sync/node-registry.js';

describe('NodeRegistry', () => {
  let registry: NodeRegistry;

  beforeEach(() => {
    registry = new NodeRegistry({
      heartbeatInterval: 100,
      timeoutThreshold: 300,
      cleanupInterval: 500,
    });
  });

  afterEach(() => {
    registry.stop();
  });

  describe('registration', () => {
    it('should register a node', () => {
      const node = registry.register({
        id: 'node1',
        address: '127.0.0.1',
        port: 3000,
      });

      expect(node.id).toBe('node1');
      expect(node.status).toBe('online');
      expect(registry.hasNode('node1')).toBe(true);
    });

    it('should emit registration event', () => {
      return new Promise<void>((resolve) => {
        registry.on('node:registered', (node) => {
          expect(node.id).toBe('node1');
          resolve();
        });

        registry.register({
          id: 'node1',
          address: '127.0.0.1',
        });
      });
    });

    it('should update existing node', () => {
      registry.register({
        id: 'node1',
        address: '127.0.0.1',
        port: 3000,
      });

      const updated = registry.register({
        id: 'node1',
        address: '127.0.0.1',
        port: 4000,
      });

      expect(updated.port).toBe(4000);
      expect(registry.getNodeCount()).toBe(1);
    });

    it('should emit update event for existing node', () => {
      registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      return new Promise<void>((resolve) => {
        registry.on('node:updated', (node) => {
          expect(node.id).toBe('node1');
          resolve();
        });

        registry.register({
          id: 'node1',
          address: '192.168.1.1',
        });
      });
    });
  });

  describe('unregistration', () => {
    it('should unregister a node', () => {
      registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      const result = registry.unregister('node1');

      expect(result).toBe(true);
      expect(registry.hasNode('node1')).toBe(false);
    });

    it('should return false when unregistering non-existent node', () => {
      const result = registry.unregister('nonexistent');
      expect(result).toBe(false);
    });

    it('should emit unregistration event', () => {
      registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      return new Promise<void>((resolve) => {
        registry.on('node:unregistered', (node) => {
          expect(node.id).toBe('node1');
          resolve();
        });

        registry.unregister('node1');
      });
    });
  });

  describe('heartbeat', () => {
    it('should update heartbeat', () => {
      const node = registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      const before = node.lastHeartbeat;

      // Wait a bit
      return new Promise((resolve) => setTimeout(resolve, 10)).then(() => {
        const result = registry.heartbeat('node1');

        expect(result).toBe(true);
        const updated = registry.getNode('node1');
        expect(updated?.lastHeartbeat).toBeGreaterThan(before);
      });
    });

    it('should return false for non-existent node', () => {
      const result = registry.heartbeat('nonexistent');
      expect(result).toBe(false);
    });

    it('should update vector clock', () => {
      registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      const clock = { node1: 5, node2: 3 };
      registry.heartbeat('node1', clock);

      const node = registry.getNode('node1');
      expect(node?.clock).toEqual(clock);
    });

    it('should emit online event when node comes back', () => {
      const node = registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      node.status = 'offline';

      return new Promise<void>((resolve) => {
        registry.on('node:online', (n) => {
          expect(n.id).toBe('node1');
          resolve();
        });

        registry.heartbeat('node1');
      });
    });
  });

  describe('queries', () => {
    beforeEach(() => {
      registry.register({
        id: 'node1',
        address: '127.0.0.1',
        region: 'us-east',
        datacenter: 'dc1',
      });

      registry.register({
        id: 'node2',
        address: '127.0.0.2',
        region: 'us-west',
        datacenter: 'dc2',
      });

      registry.register({
        id: 'node3',
        address: '127.0.0.3',
        region: 'us-east',
        datacenter: 'dc1',
      });
    });

    it('should get node by ID', () => {
      const node = registry.getNode('node1');
      expect(node?.id).toBe('node1');
    });

    it('should get all nodes', () => {
      const nodes = registry.getAllNodes();
      expect(nodes).toHaveLength(3);
    });

    it('should get online nodes', () => {
      const nodes = registry.getOnlineNodes();
      expect(nodes).toHaveLength(3);
    });

    it('should get node count', () => {
      expect(registry.getNodeCount()).toBe(3);
    });

    it('should find nodes by region', () => {
      const nodes = registry.findNodes({ region: 'us-east' });
      expect(nodes).toHaveLength(2);
      expect(nodes.every((n) => n.region === 'us-east')).toBe(true);
    });

    it('should find nodes by datacenter', () => {
      const nodes = registry.findNodes({ datacenter: 'dc1' });
      expect(nodes).toHaveLength(2);
    });

    it('should find nodes by status', () => {
      const node = registry.getNode('node2');
      if (node) node.status = 'offline';

      const offline = registry.findNodes({ status: 'offline' });
      expect(offline).toHaveLength(1);
      expect(offline[0].id).toBe('node2');
    });
  });

  describe('clear', () => {
    it('should clear all nodes', () => {
      registry.register({ id: 'node1', address: '127.0.0.1' });
      registry.register({ id: 'node2', address: '127.0.0.2' });

      registry.clear();

      expect(registry.getNodeCount()).toBe(0);
    });

    it('should emit cleared event', () => {
      return new Promise<void>((resolve) => {
        registry.on('registry:cleared', () => {
          resolve();
        });

        registry.clear();
      });
    });
  });

  describe('lifecycle', () => {
    it('should start and stop', () => {
      expect(() => registry.start()).not.toThrow();
      expect(() => registry.stop()).not.toThrow();
    });

    it('should detect suspected nodes', async () => {
      registry.start();

      registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      // Wait for timeout
      await new Promise((resolve) => {
        registry.on('node:suspected', (node) => {
          expect(node.id).toBe('node1');
          resolve(undefined);
        });
      });
    });

    it('should detect offline nodes', async () => {
      registry.start();

      const node = registry.register({
        id: 'node1',
        address: '127.0.0.1',
      });

      // Force to suspected first
      node.status = 'suspected';
      node.lastHeartbeat = Date.now() - 1000;

      // Wait for offline detection
      await new Promise((resolve) => {
        registry.on('node:offline', (n) => {
          expect(n.id).toBe('node1');
          resolve(undefined);
        });
      });
    });
  });
});
