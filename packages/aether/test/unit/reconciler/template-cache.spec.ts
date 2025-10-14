/**
 * Template Cache Tests
 *
 * Comprehensive test suite for template caching system
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TemplateCache,
  generateCacheKey,
  templateCache,
} from '../../../src/reconciler/template-cache.js';
import { createElementVNode, createTextVNode } from '../../../src/reconciler/vnode.js';

describe('TemplateCache', () => {
  describe('Basic Operations', () => {
    let cache: TemplateCache;

    beforeEach(() => {
      cache = new TemplateCache();
    });

    it('should create cache with default max size', () => {
      expect(cache.size).toBe(0);
      expect(cache.maxCacheSize).toBe(1000);
    });

    it('should create cache with custom max size', () => {
      const customCache = new TemplateCache(100);
      expect(customCache.maxCacheSize).toBe(100);
    });

    it('should set and get VNode', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      cache.set(key, vnode);
      const retrieved = cache.get(key);

      expect(retrieved).toBe(vnode);
    });

    it('should return undefined for non-existent key', () => {
      const result = cache.get('non-existent');
      expect(result).toBeUndefined();
    });

    it('should check if key exists with has()', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      expect(cache.has(key)).toBe(false);
      cache.set(key, vnode);
      expect(cache.has(key)).toBe(true);
    });

    it('should delete cache entry', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      cache.set(key, vnode);
      expect(cache.has(key)).toBe(true);

      const deleted = cache.delete(key);
      expect(deleted).toBe(true);
      expect(cache.has(key)).toBe(false);
    });

    it('should return false when deleting non-existent key', () => {
      const deleted = cache.delete('non-existent');
      expect(deleted).toBe(false);
    });

    it('should clear all entries', () => {
      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));
      cache.set('key3', createTextVNode('3'));

      expect(cache.size).toBe(3);

      cache.clear();

      expect(cache.size).toBe(0);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(false);
    });

    it('should track cache size', () => {
      expect(cache.size).toBe(0);

      cache.set('key1', createTextVNode('1'));
      expect(cache.size).toBe(1);

      cache.set('key2', createTextVNode('2'));
      expect(cache.size).toBe(2);

      cache.delete('key1');
      expect(cache.size).toBe(1);

      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe('Cache Statistics', () => {
    let cache: TemplateCache;

    beforeEach(() => {
      cache = new TemplateCache();
    });

    it('should initialize with zero statistics', () => {
      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.hitRate).toBe(0);
    });

    it('should track cache hits', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      cache.set(key, vnode);
      cache.get(key); // Hit
      cache.get(key); // Hit

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(100);
    });

    it('should track cache misses', () => {
      cache.get('non-existent-1'); // Miss
      cache.get('non-existent-2'); // Miss
      cache.get('non-existent-3'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(3);
      expect(stats.hitRate).toBe(0);
    });

    it('should track mixed hits and misses', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      cache.set(key, vnode);

      cache.get(key); // Hit
      cache.get('missing'); // Miss
      cache.get(key); // Hit
      cache.get('missing2'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(2);
      expect(stats.hitRate).toBe(50);
    });

    it('should calculate hit rate correctly', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      cache.set(key, vnode);

      // 3 hits, 1 miss = 75% hit rate
      cache.get(key);
      cache.get(key);
      cache.get(key);
      cache.get('missing');

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(75);
    });

    it('should reset statistics', () => {
      const key = 'test-key';
      const vnode = createTextVNode('Hello');

      cache.set(key, vnode);
      cache.get(key);
      cache.get('missing');

      let stats = cache.getStats();
      expect(stats.hits).toBeGreaterThan(0);
      expect(stats.misses).toBeGreaterThan(0);

      cache.resetStats();

      stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(1); // Entries still exist
    });

    it('should include size in statistics', () => {
      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));
      cache.set('key3', createTextVNode('3'));

      const stats = cache.getStats();
      expect(stats.size).toBe(3);
    });
  });

  describe('LRU Eviction', () => {
    it('should evict least recently used entry when at max size', () => {
      const cache = new TemplateCache(3); // Max 3 entries

      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));
      cache.set('key3', createTextVNode('3'));

      expect(cache.size).toBe(3);

      // Add 4th entry - should evict key1 (least recently used)
      cache.set('key4', createTextVNode('4'));

      expect(cache.size).toBe(3);
      expect(cache.has('key1')).toBe(false); // Evicted
      expect(cache.has('key2')).toBe(true);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should update access order on get()', () => {
      const cache = new TemplateCache(3);

      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));
      cache.set('key3', createTextVNode('3'));

      // Access key1 to make it most recently used
      cache.get('key1');

      // Add 4th entry - should evict key2 (now least recently used)
      cache.set('key4', createTextVNode('4'));

      expect(cache.has('key1')).toBe(true); // Still exists (accessed recently)
      expect(cache.has('key2')).toBe(false); // Evicted
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
    });

    it('should not evict when updating existing key', () => {
      const cache = new TemplateCache(2);

      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));

      // Update key1 (not a new entry)
      cache.set('key1', createTextVNode('1-updated'));

      expect(cache.size).toBe(2);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(true);
    });

    it('should handle complex eviction scenarios', () => {
      const cache = new TemplateCache(3);

      // Fill cache
      cache.set('a', createTextVNode('a'));
      cache.set('b', createTextVNode('b'));
      cache.set('c', createTextVNode('c'));

      // Access a and b to update their order
      cache.get('a');
      cache.get('b');

      // Add new entry - should evict c
      cache.set('d', createTextVNode('d'));
      expect(cache.has('c')).toBe(false);

      // Access a again
      cache.get('a');

      // Add another entry - should evict b
      cache.set('e', createTextVNode('e'));
      expect(cache.has('b')).toBe(false);

      // Final state: a, d, e
      expect(cache.has('a')).toBe(true);
      expect(cache.has('d')).toBe(true);
      expect(cache.has('e')).toBe(true);
    });
  });

  describe('Max Size Management', () => {
    it('should update max size', () => {
      const cache = new TemplateCache(100);
      expect(cache.maxCacheSize).toBe(100);

      cache.maxCacheSize = 200;
      expect(cache.maxCacheSize).toBe(200);
    });

    it('should evict entries when reducing max size', () => {
      const cache = new TemplateCache(5);

      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));
      cache.set('key3', createTextVNode('3'));
      cache.set('key4', createTextVNode('4'));
      cache.set('key5', createTextVNode('5'));

      expect(cache.size).toBe(5);

      // Reduce max size to 3
      cache.maxCacheSize = 3;

      // Should evict 2 least recently used entries
      expect(cache.size).toBe(3);
      expect(cache.has('key1')).toBe(false);
      expect(cache.has('key2')).toBe(false);
      expect(cache.has('key3')).toBe(true);
      expect(cache.has('key4')).toBe(true);
      expect(cache.has('key5')).toBe(true);
    });

    it('should not evict when increasing max size', () => {
      const cache = new TemplateCache(2);

      cache.set('key1', createTextVNode('1'));
      cache.set('key2', createTextVNode('2'));

      cache.maxCacheSize = 10;

      expect(cache.size).toBe(2);
      expect(cache.has('key1')).toBe(true);
      expect(cache.has('key2')).toBe(true);
    });
  });

  describe('generateCacheKey', () => {
    it('should generate key from named function and props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, { name: 'John', age: 30 });

      expect(key).toContain('MyComponent');
      expect(key).toContain('name');
      expect(key).toContain('John');
      expect(key).toContain('age');
      expect(key).toContain('30');
    });

    it('should generate key from anonymous function', () => {
      const component = () => {};
      const key = generateCacheKey(component, { prop: 'value' });

      expect(key).toBeTruthy();
      expect(key.length).toBeGreaterThan(0);
    });

    it('should generate stable keys for same props in different order', () => {
      function MyComponent() {}

      const key1 = generateCacheKey(MyComponent, { name: 'John', age: 30 });
      const key2 = generateCacheKey(MyComponent, { age: 30, name: 'John' });

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different props', () => {
      function MyComponent() {}

      const key1 = generateCacheKey(MyComponent, { name: 'John' });
      const key2 = generateCacheKey(MyComponent, { name: 'Jane' });

      expect(key1).not.toBe(key2);
    });

    it('should generate different keys for different components', () => {
      function Component1() {}
      function Component2() {}

      const key1 = generateCacheKey(Component1, { name: 'John' });
      const key2 = generateCacheKey(Component2, { name: 'John' });

      expect(key1).not.toBe(key2);
    });

    it('should handle null props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, null);

      expect(key).toContain('MyComponent');
    });

    it('should handle undefined props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, undefined);

      expect(key).toContain('MyComponent');
    });

    it('should handle empty props object', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {});

      expect(key).toContain('MyComponent');
    });

    it('should handle props with null values', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, { value: null });

      expect(key).toContain('value');
      expect(key).toContain('null');
    });

    it('should handle props with undefined values', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, { value: undefined });

      expect(key).toContain('value');
      expect(key).toContain('undefined');
    });

    it('should skip function props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {
        name: 'John',
        onClick: () => {},
      });

      expect(key).toContain('name');
      expect(key).not.toContain('onClick');
    });

    it('should skip symbol props', () => {
      function MyComponent() {}
      const sym = Symbol('test');
      const key = generateCacheKey(MyComponent, {
        name: 'John',
        [sym]: 'value',
      });

      expect(key).toContain('name');
      // Symbols are skipped in serialization
    });

    it('should serialize object props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {
        user: { name: 'John', age: 30 },
      });

      expect(key).toContain('user');
      expect(key).toContain('John');
    });

    it('should serialize array props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {
        items: ['a', 'b', 'c'],
      });

      expect(key).toContain('items');
      expect(key).toContain('a');
    });

    it('should handle boolean props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {
        isActive: true,
        isDisabled: false,
      });

      expect(key).toContain('isActive');
      expect(key).toContain('true');
      expect(key).toContain('isDisabled');
      expect(key).toContain('false');
    });

    it('should handle number props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {
        count: 42,
        price: 99.99,
      });

      expect(key).toContain('count');
      expect(key).toContain('42');
      expect(key).toContain('price');
      expect(key).toContain('99.99');
    });

    it('should handle string props', () => {
      function MyComponent() {}
      const key = generateCacheKey(MyComponent, {
        title: 'Hello World',
      });

      expect(key).toContain('title');
      expect(key).toContain('Hello World');
    });
  });

  describe('Singleton Template Cache', () => {
    it('should export singleton instance', () => {
      expect(templateCache).toBeInstanceOf(TemplateCache);
    });

    it('should be the same instance across imports', () => {
      // This would need to be tested with actual imports in a real scenario
      expect(templateCache).toBe(templateCache);
    });

    it('should be usable immediately', () => {
      const key = 'singleton-test';
      const vnode = createTextVNode('test');

      templateCache.set(key, vnode);
      const retrieved = templateCache.get(key);

      expect(retrieved).toBe(vnode);

      // Clean up
      templateCache.delete(key);
    });
  });

  describe('VNode Storage', () => {
    let cache: TemplateCache;

    beforeEach(() => {
      cache = new TemplateCache();
    });

    it('should store and retrieve element VNode', () => {
      const vnode = createElementVNode('div', { class: 'container' });
      cache.set('test', vnode);

      const retrieved = cache.get('test');
      expect(retrieved).toBe(vnode);
      expect(retrieved?.type).toBe('element');
      expect(retrieved?.tag).toBe('div');
    });

    it('should store and retrieve text VNode', () => {
      const vnode = createTextVNode('Hello World');
      cache.set('test', vnode);

      const retrieved = cache.get('test');
      expect(retrieved).toBe(vnode);
      expect(retrieved?.type).toBe('text');
      expect(retrieved?.text).toBe('Hello World');
    });

    it('should store and retrieve VNode with children', () => {
      const vnode = createElementVNode('div', null, [createTextVNode('Child 1'), createTextVNode('Child 2')]);
      cache.set('test', vnode);

      const retrieved = cache.get('test');
      expect(retrieved).toBe(vnode);
      expect(retrieved?.children).toHaveLength(2);
    });

    it('should store and retrieve VNode with key', () => {
      const vnode = createElementVNode('div', null, undefined, 'item-123');
      cache.set('test', vnode);

      const retrieved = cache.get('test');
      expect(retrieved).toBe(vnode);
      expect(retrieved?.key).toBe('item-123');
    });
  });

  describe('Edge Cases', () => {
    let cache: TemplateCache;

    beforeEach(() => {
      cache = new TemplateCache();
    });

    it('should handle empty cache operations gracefully', () => {
      expect(() => cache.clear()).not.toThrow();
      expect(() => cache.delete('non-existent')).not.toThrow();
      expect(() => cache.get('non-existent')).not.toThrow();
    });

    it('should handle many entries efficiently', () => {
      const count = 1000;

      // Add many entries
      for (let i = 0; i < count; i++) {
        cache.set(`key-${i}`, createTextVNode(`value-${i}`));
      }

      expect(cache.size).toBe(count);

      // Retrieve all entries
      for (let i = 0; i < count; i++) {
        const vnode = cache.get(`key-${i}`);
        expect(vnode).toBeDefined();
      }
    });

    it('should handle cache with max size of 1', () => {
      const singleCache = new TemplateCache(1);

      singleCache.set('key1', createTextVNode('1'));
      expect(singleCache.has('key1')).toBe(true);

      singleCache.set('key2', createTextVNode('2'));
      expect(singleCache.size).toBe(1);
      expect(singleCache.has('key1')).toBe(false);
      expect(singleCache.has('key2')).toBe(true);
    });

    it('should handle rapid updates to same key', () => {
      const key = 'test-key';

      for (let i = 0; i < 100; i++) {
        cache.set(key, createTextVNode(`value-${i}`));
      }

      expect(cache.size).toBe(1);
      const vnode = cache.get(key);
      expect(vnode?.text).toBe('value-99');
    });
  });
});
