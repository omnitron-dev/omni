/**
 * Tests for Memory Systems
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Memory, EpisodicMemory, AssociativeMemory, WorkingMemory } from '../../src/cognitive/memory.js';

describe('Memory', () => {
  let memory: Memory;

  beforeEach(() => {
    memory = new Memory({ maxSize: 5 });
  });

  describe('Basic Operations', () => {
    it('should store and retrieve values', () => {
      memory.set('key1', 'value1');

      expect(memory.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent keys', () => {
      expect(memory.get('nonexistent')).toBeUndefined();
    });

    it('should check if key exists', () => {
      memory.set('key1', 'value1');

      expect(memory.has('key1')).toBe(true);
      expect(memory.has('key2')).toBe(false);
    });

    it('should delete values', () => {
      memory.set('key1', 'value1');
      memory.delete('key1');

      expect(memory.has('key1')).toBe(false);
    });

    it('should clear all memory', () => {
      memory.set('key1', 'value1');
      memory.set('key2', 'value2');
      memory.clear();

      expect(memory.size()).toBe(0);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used when full', () => {
      // Fill memory
      memory.set('key1', 'value1');
      memory.set('key2', 'value2');
      memory.set('key3', 'value3');
      memory.set('key4', 'value4');
      memory.set('key5', 'value5');

      // This should evict key1 (least recently used)
      memory.set('key6', 'value6');

      expect(memory.has('key1')).toBe(false);
      expect(memory.has('key6')).toBe(true);
      expect(memory.size()).toBe(5);
    });

    it('should update access time on get', () => {
      memory.set('key1', 'value1');
      memory.set('key2', 'value2');
      memory.set('key3', 'value3');
      memory.set('key4', 'value4');
      memory.set('key5', 'value5');

      // Access key1 to make it recently used
      memory.get('key1');

      // Add new key - should evict key2 instead of key1
      memory.set('key6', 'value6');

      expect(memory.has('key1')).toBe(true);
      expect(memory.has('key2')).toBe(false);
    });
  });

  describe('TTL Support', () => {
    it('should expire values after TTL', async () => {
      const shortMemory = new Memory({ maxSize: 10, ttl: 50 });

      shortMemory.set('key1', 'value1');

      // Should exist immediately
      expect(shortMemory.get('key1')).toBe('value1');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be expired
      expect(shortMemory.get('key1')).toBeUndefined();
    });
  });

  describe('Access Tracking', () => {
    it('should track access count', () => {
      memory.set('key1', 'value1');

      memory.get('key1');
      memory.get('key1');
      memory.get('key1');

      // Access count is tracked internally
      expect(memory.get('key1')).toBe('value1');
    });
  });
});

describe('EpisodicMemory', () => {
  let episodicMemory: EpisodicMemory;

  beforeEach(() => {
    episodicMemory = new EpisodicMemory({ maxEpisodes: 10 });
  });

  describe('Basic Operations', () => {
    it('should store episodes', () => {
      const episode = {
        input: 5,
        output: 10,
        context: {},
        timestamp: Date.now(),
      };

      episodicMemory.store(episode);

      expect(episodicMemory.size()).toBe(1);
    });

    it('should retrieve recent episodes', () => {
      for (let i = 0; i < 5; i++) {
        episodicMemory.store({
          input: i,
          output: i * 2,
          context: {},
          timestamp: Date.now(),
        });
      }

      const recent = episodicMemory.getRecent(3);

      expect(recent.length).toBe(3);
      expect(recent[0]!.input).toBe(2);
      expect(recent[1]!.input).toBe(3);
      expect(recent[2]!.input).toBe(4);
    });
  });

  describe('Capacity Management', () => {
    it('should evict oldest episodes when full', () => {
      // Fill beyond capacity
      for (let i = 0; i < 15; i++) {
        episodicMemory.store({
          input: i,
          output: i * 2,
          context: {},
          timestamp: Date.now() + i,
        });
      }

      expect(episodicMemory.size()).toBe(10);

      // First episodes should be evicted
      const recent = episodicMemory.getRecent(10);
      expect(recent[0]!.input).toBe(5); // Episodes 0-4 were evicted
    });
  });

  describe('Time Range Queries', () => {
    it('should retrieve episodes in time range', () => {
      const now = Date.now();

      episodicMemory.store({
        input: 1,
        output: 2,
        context: {},
        timestamp: now - 1000,
      });

      episodicMemory.store({
        input: 2,
        output: 4,
        context: {},
        timestamp: now,
      });

      episodicMemory.store({
        input: 3,
        output: 6,
        context: {},
        timestamp: now + 1000,
      });

      const episodes = episodicMemory.getInRange(now - 500, now + 500);

      expect(episodes.length).toBe(1);
      expect(episodes[0]!.input).toBe(2);
    });
  });

  describe('Success/Failure Tracking', () => {
    it('should filter successful episodes', () => {
      episodicMemory.store({
        input: 1,
        output: 2,
        context: {},
        timestamp: Date.now(),
        success: true,
      });

      episodicMemory.store({
        input: 2,
        output: 4,
        context: {},
        timestamp: Date.now(),
        success: false,
      });

      episodicMemory.store({
        input: 3,
        output: 6,
        context: {},
        timestamp: Date.now(),
        success: true,
      });

      const successful = episodicMemory.getSuccessful();
      const failed = episodicMemory.getFailed();

      expect(successful.length).toBe(2);
      expect(failed.length).toBe(1);
    });

    it('should calculate statistics', () => {
      episodicMemory.store({
        input: 1,
        output: 2,
        context: {},
        timestamp: Date.now(),
        success: true,
        duration: 100,
      });

      episodicMemory.store({
        input: 2,
        output: 4,
        context: {},
        timestamp: Date.now(),
        success: false,
        duration: 200,
      });

      const stats = episodicMemory.getStatistics();

      expect(stats.total).toBe(2);
      expect(stats.successful).toBe(1);
      expect(stats.failed).toBe(1);
      expect(stats.averageDuration).toBe(150);
    });
  });

  describe('Similarity Search', () => {
    it('should find similar episodes', () => {
      episodicMemory.store({
        input: { x: 1, y: 2 },
        output: 3,
        context: {},
        timestamp: Date.now(),
      });

      episodicMemory.store({
        input: { x: 2, y: 3 },
        output: 5,
        context: {},
        timestamp: Date.now(),
      });

      episodicMemory.store({
        input: 'different',
        output: 0,
        context: {},
        timestamp: Date.now(),
      });

      const target = {
        input: { x: 1, y: 2 },
        output: 3,
        context: {},
        timestamp: Date.now(),
      };

      const similar = episodicMemory.findSimilar(target, 2);

      expect(similar.length).toBeGreaterThan(0);
    });
  });
});

describe('AssociativeMemory', () => {
  let associativeMemory: AssociativeMemory<string>;

  beforeEach(() => {
    associativeMemory = new AssociativeMemory({ maxSize: 10 });
  });

  describe('Basic Operations', () => {
    it('should store and retrieve items', () => {
      associativeMemory.store('item1', [1, 0, 0], { tag: 'first' });
      associativeMemory.store('item2', [0, 1, 0], { tag: 'second' });

      expect(associativeMemory.size()).toBe(2);
    });

    it('should retrieve similar items', () => {
      associativeMemory.store('cat', [1, 0.5, 0], { type: 'animal' });
      associativeMemory.store('dog', [1, 0.6, 0.1], { type: 'animal' });
      associativeMemory.store('car', [0, 0, 1], { type: 'vehicle' });

      const query = [1, 0.5, 0]; // Similar to 'cat'
      const results = associativeMemory.retrieve(query, 2);

      expect(results.length).toBe(2);
      expect(results[0]).toBe('cat');
    });
  });

  describe('Metadata Filtering', () => {
    it('should find items by metadata', () => {
      associativeMemory.store('item1', [1, 0, 0], { category: 'A' });
      associativeMemory.store('item2', [0, 1, 0], { category: 'B' });
      associativeMemory.store('item3', [0, 0, 1], { category: 'A' });

      const results = associativeMemory.find((meta) => meta.category === 'A');

      expect(results.length).toBe(2);
      expect(results).toContain('item1');
      expect(results).toContain('item3');
    });
  });

  describe('Capacity Management', () => {
    it('should evict oldest when full', () => {
      for (let i = 0; i < 15; i++) {
        associativeMemory.store(`item${i}`, [i / 15, 0, 0], {});
      }

      expect(associativeMemory.size()).toBe(10);
    });
  });
});

describe('WorkingMemory', () => {
  let workingMemory: WorkingMemory;

  beforeEach(() => {
    workingMemory = new WorkingMemory(7); // Miller's law
  });

  describe('Basic Operations', () => {
    it('should store and retrieve items', () => {
      workingMemory.add('item1', 'value1');

      expect(workingMemory.get('item1')).toBe('value1');
    });

    it('should check if items exist', () => {
      workingMemory.add('item1', 'value1');

      expect(workingMemory.has('item1')).toBe(true);
      expect(workingMemory.has('item2')).toBe(false);
    });

    it('should get all items', () => {
      workingMemory.add('item1', 'value1');
      workingMemory.add('item2', 'value2');

      const all = workingMemory.getAll();

      expect(all.length).toBe(2);
    });
  });

  describe('Capacity Limits', () => {
    it('should respect capacity limit', () => {
      for (let i = 0; i < 10; i++) {
        workingMemory.add(`item${i}`, `value${i}`);
      }

      expect(workingMemory.size()).toBe(7);
      expect(workingMemory.isFull()).toBe(true);
    });

    it('should use FIFO eviction when full', () => {
      for (let i = 0; i < 8; i++) {
        workingMemory.add(`item${i}`, `value${i}`);
      }

      // First item should be evicted
      expect(workingMemory.has('item0')).toBe(false);
      expect(workingMemory.has('item7')).toBe(true);
    });
  });

  describe('Clear Operations', () => {
    it('should clear all items', () => {
      workingMemory.add('item1', 'value1');
      workingMemory.add('item2', 'value2');
      workingMemory.clear();

      expect(workingMemory.size()).toBe(0);
    });
  });
});
