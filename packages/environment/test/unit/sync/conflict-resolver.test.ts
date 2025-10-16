/**
 * Conflict Resolver Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictResolver } from '../../../src/sync/conflict-resolver.js';
import { Change } from '../../../src/sync/change-tracker.js';

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  const createChange = (
    nodeId: string,
    key: string,
    value: string,
    timestamp: number,
    clock: Record<string, number>,
  ): Change => ({
    id: `${nodeId}-1`,
    key,
    value,
    operation: 'set',
    timestamp,
    clock,
    nodeId,
  });

  beforeEach(() => {
    resolver = new ConflictResolver();
  });

  describe('initialization', () => {
    it('should initialize with default strategy', () => {
      expect(resolver).toBeDefined();
    });

    it('should accept custom default strategy', () => {
      const customResolver = new ConflictResolver({
        defaultStrategy: 'last-write-wins',
      });
      expect(customResolver).toBeDefined();
    });
  });

  describe('resolve by timestamp', () => {
    it('should pick newer timestamp', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 2000, { node2: 1 });

      const resolution = resolver.resolve(local, remote, 'last-write-wins');

      expect(resolution.winner).toBe(remote);
      expect(resolution.loser).toBe(local);
      expect(resolution.strategy).toBe('last-write-wins');
    });

    it('should use node ID as tie-breaker for same timestamp', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 1000, { node2: 1 });

      const resolution = resolver.resolve(local, remote, 'last-write-wins');

      expect(resolution.winner.nodeId).toBe('node2'); // node2 > node1
    });
  });

  describe('resolve by vector clock', () => {
    it('should pick causally later change', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1, node2: 0 });
      const remote = createChange('node2', 'key1', 'remote', 900, { node1: 1, node2: 1 });

      const resolution = resolver.resolve(local, remote, 'vector-clock');

      expect(resolution.winner).toBe(remote);
      expect(resolution.reason).toContain('causally');
    });

    it('should fall back to timestamp for concurrent changes', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 2, node2: 0 });
      const remote = createChange('node2', 'key1', 'remote', 2000, { node1: 0, node2: 2 });

      const resolution = resolver.resolve(local, remote, 'vector-clock');

      expect(resolution.winner).toBe(remote);
    });

    it('should handle equal clocks', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 1000, { node1: 1 });

      const resolution = resolver.resolve(local, remote, 'vector-clock');

      expect(resolution.strategy).toBe('vector-clock');
    });
  });

  describe('custom resolver', () => {
    it('should use custom resolver', () => {
      const customResolver = new ConflictResolver({
        customResolver: (local, remote) => {
          return local.value > remote.value ? local : remote;
        },
      });

      const local = createChange('node1', 'key1', 'zzz', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'aaa', 2000, { node2: 1 });

      const resolution = customResolver.resolve(local, remote, 'custom');

      expect(resolution.winner).toBe(local);
      expect(resolution.strategy).toBe('custom');
    });

    it('should throw if custom resolver not configured', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 2000, { node2: 1 });

      expect(() => resolver.resolve(local, remote, 'custom')).toThrow();
    });
  });

  describe('manual resolution', () => {
    it('should mark for manual resolution', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 2000, { node2: 1 });

      const resolution = resolver.resolve(local, remote, 'manual');

      expect(resolution.strategy).toBe('manual');
      expect(resolution.reason).toContain('Manual');
    });
  });

  describe('resolveMultiple', () => {
    it('should resolve multiple conflicts', () => {
      const conflicts = [
        {
          local: createChange('node1', 'key1', 'local1', 1000, { node1: 1 }),
          remote: createChange('node2', 'key1', 'remote1', 2000, { node2: 1 }),
        },
        {
          local: createChange('node1', 'key2', 'local2', 3000, { node1: 2 }),
          remote: createChange('node2', 'key2', 'remote2', 2000, { node2: 2 }),
        },
      ];

      const resolutions = resolver.resolveMultiple(conflicts, 'last-write-wins');

      expect(resolutions).toHaveLength(2);
      expect(resolutions[0].winner.value).toBe('remote1');
      expect(resolutions[1].winner.value).toBe('local2');
    });
  });

  describe('getResolutions', () => {
    it('should track resolution history', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 2000, { node2: 1 });

      resolver.resolve(local, remote);

      const history = resolver.getResolutions();
      expect(history).toHaveLength(1);
    });
  });

  describe('getStats', () => {
    it('should provide statistics', () => {
      const local1 = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote1 = createChange('node2', 'key1', 'remote', 2000, { node2: 1 });

      // Use non-concurrent clocks for vector-clock strategy
      const local2 = createChange('node1', 'key2', 'local', 1000, { node1: 1, node2: 0 });
      const remote2 = createChange('node2', 'key2', 'remote', 900, { node1: 1, node2: 1 });

      resolver.resolve(local1, remote1, 'last-write-wins');
      resolver.resolve(local2, remote2, 'vector-clock');

      const stats = resolver.getStats();

      expect(stats.total).toBe(2);
      expect(stats.byStrategy['last-write-wins']).toBe(1);
      expect(stats.byStrategy['vector-clock']).toBe(1);
    });
  });

  describe('clearHistory', () => {
    it('should clear resolution history', () => {
      const local = createChange('node1', 'key1', 'local', 1000, { node1: 1 });
      const remote = createChange('node2', 'key1', 'remote', 2000, { node2: 1 });

      resolver.resolve(local, remote);
      resolver.clearHistory();

      expect(resolver.getResolutions()).toHaveLength(0);
    });
  });

  describe('detectConflicts', () => {
    it('should detect concurrent conflicts', () => {
      const changes = [
        createChange('node1', 'key1', 'value1', 1000, { node1: 2, node2: 0 }),
        createChange('node2', 'key1', 'value2', 2000, { node1: 0, node2: 2 }),
      ];

      const conflicts = ConflictResolver.detectConflicts(changes);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].key).toBe('key1');
      expect(conflicts[0].conflicts).toHaveLength(2);
    });

    it('should not detect non-conflicting changes', () => {
      const changes = [
        createChange('node1', 'key1', 'value1', 1000, { node1: 1, node2: 0 }),
        createChange('node2', 'key1', 'value2', 2000, { node1: 1, node2: 1 }),
      ];

      const conflicts = ConflictResolver.detectConflicts(changes);

      expect(conflicts).toHaveLength(0);
    });

    it('should handle changes to different keys', () => {
      const changes = [
        createChange('node1', 'key1', 'value1', 1000, { node1: 1 }),
        createChange('node2', 'key2', 'value2', 2000, { node2: 1 }),
      ];

      const conflicts = ConflictResolver.detectConflicts(changes);

      expect(conflicts).toHaveLength(0);
    });
  });
});
