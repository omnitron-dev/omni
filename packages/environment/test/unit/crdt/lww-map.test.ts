/**
 * LWW-Map Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { LWWMap } from '../../../src/crdt/lww-map.js';

describe('LWWMap', () => {
  let map1: LWWMap<string>;
  let map2: LWWMap<string>;

  beforeEach(() => {
    map1 = new LWWMap<string>('node1');
    map2 = new LWWMap<string>('node2');
  });

  describe('basic operations', () => {
    it('should set and get values', () => {
      map1.set('key1', 'value1');
      expect(map1.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(map1.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      map1.set('key1', 'value1');
      expect(map1.has('key1')).toBe(true);
      expect(map1.has('key2')).toBe(false);
    });

    it('should delete keys', () => {
      map1.set('key1', 'value1');
      expect(map1.has('key1')).toBe(true);

      const deleted = map1.delete('key1');
      expect(deleted).toBe(true);
      expect(map1.has('key1')).toBe(false);
      expect(map1.get('key1')).toBeUndefined();
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = map1.delete('nonexistent');
      expect(deleted).toBe(false);
    });

    it('should update existing values', () => {
      map1.set('key1', 'value1');
      map1.set('key1', 'value2');
      expect(map1.get('key1')).toBe('value2');
    });
  });

  describe('collections', () => {
    beforeEach(() => {
      map1.set('key1', 'value1');
      map1.set('key2', 'value2');
      map1.set('key3', 'value3');
    });

    it('should get all keys', () => {
      const keys = map1.keys();
      expect(keys).toHaveLength(3);
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
      expect(keys).toContain('key3');
    });

    it('should get all values', () => {
      const values = map1.values();
      expect(values).toHaveLength(3);
      expect(values).toContain('value1');
      expect(values).toContain('value2');
      expect(values).toContain('value3');
    });

    it('should get all entries', () => {
      const entries = map1.entries_list();
      expect(entries).toHaveLength(3);
      expect(entries).toContainEqual(['key1', 'value1']);
      expect(entries).toContainEqual(['key2', 'value2']);
      expect(entries).toContainEqual(['key3', 'value3']);
    });

    it('should get correct size', () => {
      expect(map1.size).toBe(3);
    });

    it('should exclude deleted entries from collections', () => {
      map1.delete('key2');

      expect(map1.keys()).toHaveLength(2);
      expect(map1.keys()).not.toContain('key2');
      expect(map1.size).toBe(2);
    });
  });

  describe('merge', () => {
    it('should merge new entries from other map', () => {
      map1.set('key1', 'value1');
      map2.set('key2', 'value2');

      map1.merge(map2.getState());

      expect(map1.has('key1')).toBe(true);
      expect(map1.has('key2')).toBe(true);
      expect(map1.get('key1')).toBe('value1');
      expect(map1.get('key2')).toBe('value2');
    });

    it('should handle concurrent writes with timestamp', () => {
      // Both maps write to same key
      map1.set('key1', 'value-from-node1');

      // Small delay to ensure different timestamp
      const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      return delay(10).then(() => {
        map2.set('key1', 'value-from-node2');

        // Merge - node2's value should win (newer timestamp)
        map1.merge(map2.getState());

        expect(map1.get('key1')).toBe('value-from-node2');
      });
    });

    it('should preserve local changes when merging older remote changes', () => {
      map1.set('key1', 'initial');
      const state1 = map1.getState();

      map1.set('key1', 'updated');

      // Merge old state - should keep updated value
      map1.merge(state1);
      expect(map1.get('key1')).toBe('updated');
    });

    it('should handle deletions in merge', () => {
      map1.set('key1', 'value1');
      map2.set('key1', 'value1');

      map2.delete('key1');
      map1.merge(map2.getState());

      expect(map1.has('key1')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all entries', () => {
      map1.set('key1', 'value1');
      map1.set('key2', 'value2');

      map1.clear();

      expect(map1.size).toBe(0);
      expect(map1.keys()).toHaveLength(0);
    });
  });

  describe('getState', () => {
    it('should return complete state', () => {
      map1.set('key1', 'value1');
      map1.set('key2', 'value2');

      const state = map1.getState();

      expect(state.entries).toBeInstanceOf(Map);
      expect(state.entries.size).toBe(2);
    });
  });

  describe('getClock', () => {
    it('should return vector clock', () => {
      map1.set('key1', 'value1');

      const clock = map1.getClock();

      expect(clock).toHaveProperty('node1');
      expect(clock.node1).toBeGreaterThan(0);
    });
  });
});
