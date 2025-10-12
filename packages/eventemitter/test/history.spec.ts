import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { EventHistory, MemoryEventStorage } from '../src/history';
import type { EventRecord, EventFilter } from '../src/types';

describe('MemoryEventStorage', () => {
  let storage: MemoryEventStorage;

  beforeEach(() => {
    storage = new MemoryEventStorage(5); // Small size for testing
  });

  describe('save', () => {
    it('should save event records', async () => {
      const record: EventRecord = {
        event: 'test',
        data: { value: 1 },
        metadata: { id: '1' },
        timestamp: Date.now(),
      };

      await storage.save(record);
      const records = await storage.load();
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
    });

    it('should maintain max size by removing oldest', async () => {
      // Save 6 records (max is 5)
      for (let i = 1; i <= 6; i++) {
        await storage.save({
          event: `event${i}`,
          data: i,
          metadata: {},
          timestamp: Date.now() + i,
        });
      }

      const records = await storage.load();
      expect(records).toHaveLength(5);
      expect(records[0]?.event).toBe('event2'); // First was removed
      expect(records[4]?.event).toBe('event6'); // Last is present
    });
  });

  describe('load with filters', () => {
    beforeEach(async () => {
      const now = Date.now();
      await storage.save({
        event: 'user.created',
        data: { id: 1 },
        metadata: { tags: ['user'], correlationId: 'corr1' },
        timestamp: now - 3600000, // 1 hour ago
      });
      await storage.save({
        event: 'user.updated',
        data: { id: 2 },
        metadata: { tags: ['user', 'important'], correlationId: 'corr2' },
        timestamp: now - 1800000, // 30 min ago
      });
      await storage.save({
        event: 'post.created',
        data: { id: 3 },
        metadata: { tags: ['post'], correlationId: 'corr3' },
        timestamp: now,
      });
    });

    it('should filter by event name string', async () => {
      const filter: EventFilter = { event: 'user' };
      const records = await storage.load(filter);
      expect(records).toHaveLength(2);
      expect(records.every((r) => r.event.includes('user'))).toBe(true);
    });

    it('should filter by event regex', async () => {
      const filter: EventFilter = { event: /\.created$/ };
      const records = await storage.load(filter);
      expect(records).toHaveLength(2);
      expect(records.every((r) => r.event.endsWith('.created'))).toBe(true);
    });

    it('should filter by time range', async () => {
      const now = Date.now();
      const filter: EventFilter = {
        from: new Date(now - 2700000), // 45 min ago
        to: new Date(now),
      };
      const records = await storage.load(filter);
      expect(records).toHaveLength(2); // Only last 2 events
    });

    it('should filter by tags', async () => {
      const filter: EventFilter = { tags: ['important'] };
      const records = await storage.load(filter);
      expect(records).toHaveLength(1);
      expect(records[0]?.event).toBe('user.updated');
    });

    it('should filter by correlation ID', async () => {
      const filter: EventFilter = { correlationId: 'corr2' };
      const records = await storage.load(filter);
      expect(records).toHaveLength(1);
      expect(records[0]?.event).toBe('user.updated');
    });

    it('should combine multiple filters', async () => {
      const filter: EventFilter = {
        event: 'user',
        tags: ['user'],
      };
      const records = await storage.load(filter);
      expect(records).toHaveLength(2);
    });
  });

  describe('clear', () => {
    it('should clear all records', async () => {
      await storage.save({
        event: 'test',
        data: {},
        metadata: {},
        timestamp: Date.now(),
      });

      let records = await storage.load();
      expect(records).toHaveLength(1);

      await storage.clear();
      records = await storage.load();
      expect(records).toHaveLength(0);
    });
  });
});

describe('EventHistory', () => {
  let history: EventHistory;

  beforeEach(() => {
    history = new EventHistory({ maxSize: 10 });
  });

  describe('enable/disable', () => {
    it('should start disabled', () => {
      expect(history.isEnabled()).toBe(false);
    });

    it('should enable and disable', () => {
      history.enable();
      expect(history.isEnabled()).toBe(true);

      history.disable();
      expect(history.isEnabled()).toBe(false);
    });
  });

  describe('record', () => {
    it('should not record when disabled', async () => {
      const record: EventRecord = {
        event: 'test',
        data: {},
        metadata: {},
        timestamp: Date.now(),
      };

      await history.record(record);
      const records = await history.getHistory();
      expect(records).toHaveLength(0);
    });

    it('should record when enabled', async () => {
      history.enable();

      const record: EventRecord = {
        event: 'test',
        data: { value: 1 },
        metadata: { id: '1' },
        timestamp: Date.now(),
      };

      await history.record(record);
      const records = await history.getHistory();
      expect(records).toHaveLength(1);
      expect(records[0]).toEqual(record);
    });

    it('should apply filter when configured', async () => {
      const filterFn = jest.fn((event: string) => event.startsWith('allowed'));
      history = new EventHistory({ filter: filterFn });
      history.enable();

      await history.record({
        event: 'allowed.event',
        data: {},
        metadata: {},
        timestamp: Date.now(),
      });

      await history.record({
        event: 'blocked.event',
        data: {},
        metadata: {},
        timestamp: Date.now(),
      });

      const records = await history.getHistory();
      expect(records).toHaveLength(1);
      expect(records[0]?.event).toBe('allowed.event');
      expect(filterFn).toHaveBeenCalledTimes(2);
    });

    it('should respect TTL when recording', async () => {
      history = new EventHistory({ ttl: 1000 }); // 1 second TTL
      history.enable();

      // Old event (outside TTL)
      await history.record({
        event: 'old',
        data: {},
        metadata: {},
        timestamp: Date.now() - 2000,
      });

      // Recent event (within TTL)
      await history.record({
        event: 'recent',
        data: {},
        metadata: {},
        timestamp: Date.now(),
      });

      const records = await history.getHistory();
      expect(records).toHaveLength(1);
      expect(records[0]?.event).toBe('recent');
    });
  });

  describe('getHistory', () => {
    beforeEach(async () => {
      history.enable();

      const now = Date.now();
      await history.record({
        event: 'event1',
        data: { value: 1 },
        metadata: { tags: ['tag1'] },
        timestamp: now - 2000,
      });
      await history.record({
        event: 'event2',
        data: { value: 2 },
        metadata: { tags: ['tag2'] },
        timestamp: now - 1000,
      });
      await history.record({
        event: 'event3',
        data: { value: 3 },
        metadata: { tags: ['tag1', 'tag2'] },
        timestamp: now,
      });
    });

    it('should return all history without filter', async () => {
      const records = await history.getHistory();
      expect(records).toHaveLength(3);
    });

    it('should filter history', async () => {
      const records = await history.getHistory({ event: 'event2' });
      expect(records).toHaveLength(1);
      expect(records[0]?.event).toBe('event2');
    });

    it('should apply TTL filter when configured', async () => {
      history = new EventHistory({ ttl: 1500 }); // 1.5 seconds
      history.enable();

      const now = Date.now();
      await history.record({
        event: 'old',
        data: {},
        metadata: {},
        timestamp: now - 2000,
      });
      await history.record({
        event: 'recent',
        data: {},
        metadata: {},
        timestamp: now - 500,
      });

      const records = await history.getHistory();
      expect(records).toHaveLength(1);
      expect(records[0]?.event).toBe('recent');
    });
  });

  describe('export/import', () => {
    it('should export and import history', async () => {
      history.enable();

      await history.record({
        event: 'event1',
        data: { value: 1 },
        metadata: {},
        timestamp: Date.now(),
      });
      await history.record({
        event: 'event2',
        data: { value: 2 },
        metadata: {},
        timestamp: Date.now(),
      });

      const exported = await history.export();
      expect(exported).toHaveLength(2);

      await history.clear();
      let records = await history.getHistory();
      expect(records).toHaveLength(0);

      await history.import(exported);
      records = await history.getHistory();
      expect(records).toHaveLength(2);
      expect(records[0]?.event).toBe('event1');
      expect(records[1]?.event).toBe('event2');
    });
  });

  describe('getStats', () => {
    beforeEach(async () => {
      history.enable();

      await history.record({
        event: 'event1',
        data: {},
        metadata: {},
        timestamp: Date.now(),
        duration: 10,
      });
      await history.record({
        event: 'event1',
        data: {},
        metadata: {},
        timestamp: Date.now(),
        duration: 20,
      });
      await history.record({
        event: 'event2',
        data: {},
        metadata: {},
        timestamp: Date.now(),
        duration: 30,
        error: new Error('Test error'),
      });
    });

    it('should calculate statistics', async () => {
      const stats = await history.getStats();

      expect(stats.totalEvents).toBe(3);
      expect(stats.uniqueEvents).toBe(2);
      expect(stats.errorCount).toBe(1);
      expect(stats.avgDuration).toBe(20); // (10 + 20 + 30) / 3
      expect(stats.eventCounts.get('event1')).toBe(2);
      expect(stats.eventCounts.get('event2')).toBe(1);
    });

    it('should handle empty history', async () => {
      await history.clear();
      const stats = await history.getStats();

      expect(stats.totalEvents).toBe(0);
      expect(stats.uniqueEvents).toBe(0);
      expect(stats.errorCount).toBe(0);
      expect(stats.avgDuration).toBe(0);
      expect(stats.eventCounts.size).toBe(0);
    });
  });

  describe('custom storage', () => {
    it('should use custom storage implementation', async () => {
      const customStorage = {
        save: jest.fn(async () => {}),
        load: jest.fn(async () => []),
        clear: jest.fn(async () => {}),
      };

      history = new EventHistory({ storage: customStorage });
      history.enable();

      await history.record({
        event: 'test',
        data: {},
        metadata: {},
        timestamp: Date.now(),
      });

      expect(customStorage.save).toHaveBeenCalled();

      await history.getHistory();
      expect(customStorage.load).toHaveBeenCalled();

      await history.clear();
      expect(customStorage.clear).toHaveBeenCalled();
    });
  });
});
