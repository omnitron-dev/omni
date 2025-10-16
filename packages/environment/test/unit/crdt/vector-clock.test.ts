/**
 * Vector Clock Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VectorClockManager } from '../../../src/crdt/vector-clock.js';

describe('VectorClockManager', () => {
  let clock1: VectorClockManager;
  let clock2: VectorClockManager;

  beforeEach(() => {
    clock1 = new VectorClockManager('node1');
    clock2 = new VectorClockManager('node2');
  });

  describe('initialization', () => {
    it('should initialize with node ID', () => {
      const clock = clock1.getClock();
      expect(clock).toHaveProperty('node1');
      expect(clock.node1).toBe(0);
    });
  });

  describe('increment', () => {
    it('should increment local clock', () => {
      const clock = clock1.increment();
      expect(clock.node1).toBe(1);
    });

    it('should increment multiple times', () => {
      clock1.increment();
      clock1.increment();
      const clock = clock1.increment();
      expect(clock.node1).toBe(3);
    });
  });

  describe('merge', () => {
    it('should merge clocks from different nodes', () => {
      clock1.increment();
      clock2.increment();
      clock2.increment();

      const merged = clock1.merge(clock2.getClock());

      expect(merged.node1).toBe(2); // Incremented after merge
      expect(merged.node2).toBe(2);
    });

    it('should take maximum values when merging', () => {
      clock1.increment();
      clock1.increment();
      clock1.increment();

      const otherClock = { node1: 5, node2: 3 };
      const merged = clock1.merge(otherClock);

      expect(merged.node1).toBe(6); // max(3, 5) + 1
      expect(merged.node2).toBe(3);
    });
  });

  describe('compare', () => {
    it('should detect equal clocks', () => {
      const a = { node1: 1, node2: 2 };
      const b = { node1: 1, node2: 2 };

      expect(VectorClockManager.compare(a, b)).toBe('equal');
    });

    it('should detect before relationship', () => {
      const a = { node1: 1, node2: 2 };
      const b = { node1: 2, node2: 3 };

      expect(VectorClockManager.compare(a, b)).toBe('before');
    });

    it('should detect after relationship', () => {
      const a = { node1: 2, node2: 3 };
      const b = { node1: 1, node2: 2 };

      expect(VectorClockManager.compare(a, b)).toBe('after');
    });

    it('should detect concurrent events', () => {
      const a = { node1: 2, node2: 1 };
      const b = { node1: 1, node2: 2 };

      expect(VectorClockManager.compare(a, b)).toBe('concurrent');
    });
  });

  describe('happenedBefore', () => {
    it('should return true when clock A happened before B', () => {
      const a = { node1: 1, node2: 1 };
      const b = { node1: 2, node2: 2 };

      expect(VectorClockManager.happenedBefore(a, b)).toBe(true);
    });

    it('should return false when clock A did not happen before B', () => {
      const a = { node1: 2, node2: 2 };
      const b = { node1: 1, node2: 1 };

      expect(VectorClockManager.happenedBefore(a, b)).toBe(false);
    });
  });

  describe('isConcurrent', () => {
    it('should return true for concurrent clocks', () => {
      const a = { node1: 2, node2: 1 };
      const b = { node1: 1, node2: 2 };

      expect(VectorClockManager.isConcurrent(a, b)).toBe(true);
    });

    it('should return false for non-concurrent clocks', () => {
      const a = { node1: 1, node2: 1 };
      const b = { node1: 2, node2: 2 };

      expect(VectorClockManager.isConcurrent(a, b)).toBe(false);
    });
  });

  describe('getClock and setClock', () => {
    it('should get and set clock', () => {
      const testClock = { node1: 5, node2: 3, node3: 7 };
      clock1.setClock(testClock);

      const retrieved = clock1.getClock();
      expect(retrieved).toEqual(testClock);
    });
  });
});
