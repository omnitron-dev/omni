import { describe, it, expect, beforeEach } from '@jest/globals';
import { StatsTracker } from '../../../src/rotif/stats.js';

describe('Rotif - StatsTracker', () => {
  let tracker: StatsTracker;

  beforeEach(() => {
    tracker = new StatsTracker();
  });

  describe('initialization', () => {
    it('should initialize with zero counts', () => {
      const stats = tracker.getStats();

      expect(stats.messages).toBe(0);
      expect(stats.retries).toBe(0);
      expect(stats.failures).toBe(0);
      expect(stats.lastMessageAt).toBe(0);
    });
  });

  describe('recordMessage', () => {
    it('should increment message count', () => {
      tracker.recordMessage();
      expect(tracker.getStats().messages).toBe(1);

      tracker.recordMessage();
      expect(tracker.getStats().messages).toBe(2);
    });

    it('should update lastMessageAt timestamp', () => {
      const beforeTime = Date.now();
      tracker.recordMessage();
      const afterTime = Date.now();

      const stats = tracker.getStats();
      expect(stats.lastMessageAt).toBeGreaterThanOrEqual(beforeTime);
      expect(stats.lastMessageAt).toBeLessThanOrEqual(afterTime);
    });

    it('should update timestamp on each call', async () => {
      tracker.recordMessage();
      const firstTimestamp = tracker.getStats().lastMessageAt;

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      tracker.recordMessage();
      const secondTimestamp = tracker.getStats().lastMessageAt;

      expect(secondTimestamp).toBeGreaterThan(firstTimestamp);
    });
  });

  describe('recordRetry', () => {
    it('should increment retry count', () => {
      tracker.recordRetry();
      expect(tracker.getStats().retries).toBe(1);

      tracker.recordRetry();
      expect(tracker.getStats().retries).toBe(2);
    });

    it('should not affect message count', () => {
      tracker.recordRetry();
      tracker.recordRetry();

      expect(tracker.getStats().messages).toBe(0);
      expect(tracker.getStats().retries).toBe(2);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', () => {
      tracker.recordFailure();
      expect(tracker.getStats().failures).toBe(1);

      tracker.recordFailure();
      expect(tracker.getStats().failures).toBe(2);
    });

    it('should not affect message or retry count', () => {
      tracker.recordFailure();
      tracker.recordFailure();

      expect(tracker.getStats().messages).toBe(0);
      expect(tracker.getStats().retries).toBe(0);
      expect(tracker.getStats().failures).toBe(2);
    });
  });

  describe('getStats', () => {
    it('should return current statistics snapshot', () => {
      tracker.recordMessage();
      tracker.recordMessage();
      tracker.recordRetry();
      tracker.recordFailure();

      const stats = tracker.getStats();

      expect(stats.messages).toBe(2);
      expect(stats.retries).toBe(1);
      expect(stats.failures).toBe(1);
      expect(stats.lastMessageAt).toBeGreaterThan(0);
    });

    it('should return a new object each time', () => {
      const stats1 = tracker.getStats();
      const stats2 = tracker.getStats();

      expect(stats1).not.toBe(stats2);
      expect(stats1).toEqual(stats2);
    });
  });

  describe('complex scenarios', () => {
    it('should correctly track multiple operations', () => {
      // Simulate processing 10 messages with some retries and failures
      for (let i = 0; i < 10; i++) {
        tracker.recordMessage();
      }

      for (let i = 0; i < 3; i++) {
        tracker.recordRetry();
      }

      for (let i = 0; i < 2; i++) {
        tracker.recordFailure();
      }

      const stats = tracker.getStats();

      expect(stats.messages).toBe(10);
      expect(stats.retries).toBe(3);
      expect(stats.failures).toBe(2);
    });

    it('should handle high volume of messages', () => {
      const messageCount = 10000;

      for (let i = 0; i < messageCount; i++) {
        tracker.recordMessage();
      }

      expect(tracker.getStats().messages).toBe(messageCount);
    });
  });
});
