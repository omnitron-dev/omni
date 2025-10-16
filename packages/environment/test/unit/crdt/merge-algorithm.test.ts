/**
 * Merge Algorithm Tests
 */

import { describe, it, expect } from 'vitest';
import { MergeAlgorithm } from '../../../src/crdt/merge-algorithm.js';

describe('MergeAlgorithm', () => {
  describe('threeWayMerge', () => {
    it('should merge when only local changed', () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 3 };
      const remote = { a: 1, b: 2 };

      const result = MergeAlgorithm.threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged.b).toBe(3);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should merge when only remote changed', () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 2 };
      const remote = { a: 1, b: 3 };

      const result = MergeAlgorithm.threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged.b).toBe(3);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should detect conflicts when both changed', () => {
      const base = { a: 1, b: 2 };
      const local = { a: 1, b: 3 };
      const remote = { a: 1, b: 4 };

      const result = MergeAlgorithm.threeWayMerge(base, local, remote);

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].key).toBe('b');
      expect(result.merged.b).toBe(4); // Remote wins by default
    });

    it('should handle new keys', () => {
      const base = { a: 1 };
      const local = { a: 1, b: 2 };
      const remote = { a: 1, c: 3 };

      const result = MergeAlgorithm.threeWayMerge(base, local, remote);

      expect(result.success).toBe(true);
      expect(result.merged).toEqual({ a: 1, b: 2, c: 3 });
    });
  });

  describe('mergeWithStrategy', () => {
    it('should apply local-wins strategy', () => {
      const local = { a: 1, b: 2 };
      const remote = { a: 1, b: 3 };

      const result = MergeAlgorithm.mergeWithStrategy(local, remote, 'local-wins');

      expect(result.merged.b).toBe(2);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].resolution).toBe('local');
    });

    it('should apply remote-wins strategy', () => {
      const local = { a: 1, b: 2 };
      const remote = { a: 1, b: 3 };

      const result = MergeAlgorithm.mergeWithStrategy(local, remote, 'remote-wins');

      expect(result.merged.b).toBe(3);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].resolution).toBe('remote');
    });

    it('should apply newest-wins strategy with timestamps', () => {
      const local = { a: 1, b: 2 };
      const remote = { a: 1, b: 3 };
      const timestamps = { local: 1000, remote: 2000 };

      const result = MergeAlgorithm.mergeWithStrategy(
        local,
        remote,
        'newest-wins',
        timestamps,
      );

      expect(result.merged.b).toBe(3);
      expect(result.conflicts[0].reason).toContain('newer');
    });

    it('should handle missing values', () => {
      const local = { a: 1, b: 2 };
      const remote = { a: 1, c: 3 };

      const result = MergeAlgorithm.mergeWithStrategy(local, remote, 'remote-wins');

      expect(result.merged).toEqual({ a: 1, b: 2, c: 3 });
      expect(result.conflicts).toHaveLength(0);
    });
  });

  describe('deepMerge', () => {
    it('should merge nested objects', () => {
      const target = { a: 1, b: { c: 2, d: 3 } };
      const source = { a: 1, b: { c: 4, e: 5 } };

      const result = MergeAlgorithm.deepMerge(target, source);

      expect(result.b).toEqual({ c: 4, d: 3, e: 5 });
    });

    it('should replace arrays (not merge)', () => {
      const target = { a: [1, 2, 3] };
      const source = { a: [4, 5] };

      const result = MergeAlgorithm.deepMerge(target, source);

      expect(result.a).toEqual([4, 5]);
    });

    it('should handle deeply nested objects', () => {
      const target = { a: { b: { c: { d: 1 } } } };
      const source = { a: { b: { c: { e: 2 } } } };

      const result = MergeAlgorithm.deepMerge(target, source);

      expect(result.a.b.c).toEqual({ d: 1, e: 2 });
    });

    it('should not modify original objects', () => {
      const target = { a: 1, b: { c: 2 } };
      const source = { b: { d: 3 } };

      MergeAlgorithm.deepMerge(target, source);

      expect(target.b).toEqual({ c: 2 });
    });
  });
});
