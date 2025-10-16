/**
 * Change Tracker Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChangeTracker } from '../../../src/sync/change-tracker.js';

describe('ChangeTracker', () => {
  let tracker: ChangeTracker;

  beforeEach(() => {
    tracker = new ChangeTracker({
      nodeId: 'node1',
      maxHistorySize: 100,
    });
  });

  describe('tracking', () => {
    it('should track a change', () => {
      const change = tracker.track('key1', 'value1', 'set');

      expect(change.key).toBe('key1');
      expect(change.value).toBe('value1');
      expect(change.operation).toBe('set');
      expect(change.nodeId).toBe('node1');
    });

    it('should emit change event', () => {
      return new Promise<void>((resolve) => {
        tracker.on('change', (change) => {
          expect(change.key).toBe('key1');
          resolve();
        });

        tracker.track('key1', 'value1');
      });
    });

    it('should increment vector clock', () => {
      const change1 = tracker.track('key1', 'value1');
      const change2 = tracker.track('key2', 'value2');

      expect(change2.clock.node1).toBeGreaterThan(change1.clock.node1);
    });

    it('should track deletions', () => {
      const change = tracker.track('key1', null, 'delete');
      expect(change.operation).toBe('delete');
    });
  });

  describe('getChangesSince', () => {
    beforeEach(() => {
      tracker.track('key1', 'value1');
      tracker.track('key2', 'value2');
      tracker.track('key3', 'value3');
    });

    it('should get all changes when no clock provided', () => {
      const changes = tracker.getChangesSince();
      expect(changes).toHaveLength(3);
    });

    it('should get changes after a clock', () => {
      const firstChange = tracker.getLatestChange('key1');
      const changes = tracker.getChangesSince(firstChange?.clock);

      expect(changes.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getChanges with filter', () => {
    beforeEach(() => {
      tracker.track('key1', 'value1', 'set');
      tracker.track('key2', 'value2', 'set');
      tracker.track('key3', null, 'delete');
    });

    it('should filter by keys', () => {
      const changes = tracker.getChanges({ keys: ['key1', 'key2'] });

      expect(changes).toHaveLength(2);
      expect(changes.every((c) => ['key1', 'key2'].includes(c.key))).toBe(true);
    });

    it('should filter by operations', () => {
      const changes = tracker.getChanges({ operations: ['delete'] });

      expect(changes).toHaveLength(1);
      expect(changes[0].operation).toBe('delete');
    });

    it('should filter by node', () => {
      const changes = tracker.getChanges({ nodeId: 'node1' });

      expect(changes).toHaveLength(3);
      expect(changes.every((c) => c.nodeId === 'node1')).toBe(true);
    });
  });

  describe('getLatestChange', () => {
    it('should get latest change for a key', () => {
      tracker.track('key1', 'value1');
      tracker.track('key1', 'value2');

      const latest = tracker.getLatestChange('key1');

      expect(latest?.value).toBe('value2');
    });

    it('should return undefined for non-existent key', () => {
      const latest = tracker.getLatestChange('nonexistent');
      expect(latest).toBeUndefined();
    });
  });

  describe('getLatestChanges', () => {
    it('should get one change per key', () => {
      tracker.track('key1', 'value1');
      tracker.track('key1', 'value2');
      tracker.track('key2', 'value3');

      const latest = tracker.getLatestChanges();

      expect(latest).toHaveLength(2);
    });
  });

  describe('applyRemoteChanges', () => {
    it('should apply new remote changes', () => {
      const remoteChanges = [
        {
          id: 'node2-1',
          key: 'key1',
          value: 'remote-value',
          operation: 'set' as const,
          timestamp: Date.now(),
          clock: { node2: 1 },
          nodeId: 'node2',
        },
      ];

      tracker.applyRemoteChanges(remoteChanges);

      const latest = tracker.getLatestChange('key1');
      expect(latest?.value).toBe('remote-value');
    });

    it('should emit remote-changes-applied event', () => {
      return new Promise<void>((resolve) => {
        tracker.on('remote-changes-applied', (changes) => {
          expect(changes).toHaveLength(1);
          resolve();
        });

        tracker.applyRemoteChanges([
          {
            id: 'node2-1',
            key: 'key1',
            value: 'value',
            operation: 'set',
            timestamp: Date.now(),
            clock: { node2: 1 },
            nodeId: 'node2',
          },
        ]);
      });
    });

    it('should resolve conflicts with vector clock', () => {
      tracker.track('key1', 'local-value');

      const remoteChange = {
        id: 'node2-1',
        key: 'key1',
        value: 'remote-value',
        operation: 'set' as const,
        timestamp: Date.now() + 1000,
        clock: { node2: 5 },
        nodeId: 'node2',
      };

      tracker.applyRemoteChanges([remoteChange]);

      const latest = tracker.getLatestChange('key1');
      expect(latest?.value).toBe('remote-value');
    });
  });

  describe('getClock', () => {
    it('should return current vector clock', () => {
      tracker.track('key1', 'value1');

      const clock = tracker.getClock();

      expect(clock).toHaveProperty('node1');
      expect(clock.node1).toBeGreaterThan(0);
    });
  });

  describe('statistics', () => {
    beforeEach(() => {
      tracker.track('key1', 'value1');
      tracker.track('key1', 'value2');
      tracker.track('key2', 'value3');
    });

    it('should get change count', () => {
      expect(tracker.getChangeCount()).toBe(3);
    });

    it('should get unique key count', () => {
      expect(tracker.getKeyCount()).toBe(2);
    });

    it('should get stats', () => {
      const stats = tracker.getStats();

      expect(stats.totalChanges).toBe(3);
      expect(stats.uniqueKeys).toBe(2);
      expect(stats.nodeId).toBe('node1');
    });
  });

  describe('clear', () => {
    it('should clear all changes', () => {
      tracker.track('key1', 'value1');
      tracker.track('key2', 'value2');

      tracker.clear();

      expect(tracker.getChangeCount()).toBe(0);
      expect(tracker.getKeyCount()).toBe(0);
    });

    it('should emit cleared event', () => {
      return new Promise<void>((resolve) => {
        tracker.on('cleared', () => {
          resolve();
        });

        tracker.clear();
      });
    });
  });

  describe('compress', () => {
    it('should compress history', () => {
      tracker.track('key1', 'value1');
      tracker.track('key1', 'value2');
      tracker.track('key1', 'value3');

      tracker.compress();

      expect(tracker.getChangeCount()).toBe(1);
      expect(tracker.getLatestChange('key1')?.value).toBe('value3');
    });

    it('should emit compressed event', () => {
      tracker.track('key1', 'value1');
      tracker.track('key1', 'value2');

      return new Promise<void>((resolve) => {
        tracker.on('compressed', (info) => {
          expect(info.after).toBeLessThanOrEqual(info.before);
          resolve();
        });

        tracker.compress();
      });
    });
  });

  describe('history limit', () => {
    it('should limit history size', () => {
      const smallTracker = new ChangeTracker({
        nodeId: 'node1',
        maxHistorySize: 5,
      });

      for (let i = 0; i < 10; i++) {
        smallTracker.track(`key${i}`, `value${i}`);
      }

      expect(smallTracker.getChangeCount()).toBe(5);
    });
  });
});
