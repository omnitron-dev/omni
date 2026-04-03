/**
 * Tests for object utilities
 */
import { describe, it, expect } from 'vitest';
import { hasKeys, omit, pick, deepClone, isEmpty } from '../object.js';

describe('object utilities', () => {
  describe('hasKeys', () => {
    it('returns true when object has all keys', () => {
      const obj = { name: 'John', email: 'john@example.com' };
      expect(hasKeys(obj, ['name', 'email'])).toBe(true);
    });

    it('returns false when object missing keys', () => {
      const obj = { name: 'John' };
      expect(hasKeys(obj, ['name', 'age'] as (keyof typeof obj)[])).toBe(false);
    });

    it('returns true for empty keys array', () => {
      const obj = { name: 'John' };
      expect(hasKeys(obj, [])).toBe(true);
    });

    it('returns false for null/undefined', () => {
      expect(hasKeys(null as unknown as Record<string, unknown>, ['name'])).toBe(false);
      expect(hasKeys(undefined as unknown as Record<string, unknown>, ['name'])).toBe(false);
    });

    it('returns false for non-objects', () => {
      expect(hasKeys('string' as unknown as object, [])).toBe(false);
    });
  });

  describe('omit', () => {
    it('omits specified keys', () => {
      const obj = { name: 'John', email: 'john@example.com', password: 'secret' };
      const result = omit(obj, ['password']);
      expect(result).toEqual({ name: 'John', email: 'john@example.com' });
    });

    it('returns copy of object with no keys omitted', () => {
      const obj = { name: 'John' };
      const result = omit(obj, []);
      expect(result).toEqual(obj);
      expect(result).not.toBe(obj);
    });

    it('handles multiple keys', () => {
      const obj = { a: 1, b: 2, c: 3 };
      const result = omit(obj, ['a', 'c']);
      expect(result).toEqual({ b: 2 });
    });

    it('ignores non-existent keys', () => {
      const obj = { a: 1 };
      const result = omit(obj, ['a', 'nonexistent' as keyof typeof obj]);
      expect(result).toEqual({});
    });
  });

  describe('pick', () => {
    it('picks specified keys', () => {
      const obj = { name: 'John', email: 'john@example.com', password: 'secret' };
      const result = pick(obj, ['name', 'email']);
      expect(result).toEqual({ name: 'John', email: 'john@example.com' });
    });

    it('returns empty object for empty keys', () => {
      const obj = { name: 'John' };
      const result = pick(obj, []);
      expect(result).toEqual({});
    });

    it('ignores non-existent keys', () => {
      const obj = { a: 1 };
      const result = pick(obj, ['a', 'b' as keyof typeof obj]);
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('deepClone', () => {
    it('clones primitive values', () => {
      expect(deepClone(42)).toBe(42);
      expect(deepClone('hello')).toBe('hello');
      expect(deepClone(null)).toBe(null);
    });

    it('clones arrays', () => {
      const arr = [1, 2, 3];
      const cloned = deepClone(arr);
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
    });

    it('clones nested objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const cloned = deepClone(obj);
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.b).not.toBe(obj.b);
    });

    it('modifications to clone do not affect original', () => {
      const original = { a: 1, b: { c: 2 } };
      const cloned = deepClone(original);
      cloned.b.c = 3;
      expect(original.b.c).toBe(2);
    });

    it('clones Date objects', () => {
      const date = new Date('2024-01-01');
      const cloned = deepClone(date);
      expect(cloned).toEqual(date);
      expect(cloned).not.toBe(date);
      expect(cloned.getTime()).toBe(date.getTime());
    });

    it('clones RegExp objects', () => {
      const regex = /test/gi;
      const cloned = deepClone(regex);
      expect(cloned).not.toBe(regex);
      expect(cloned.source).toBe(regex.source);
      expect(cloned.flags).toBe(regex.flags);
    });

    it('handles arrays with objects', () => {
      const arr = [{ a: 1 }, { b: 2 }];
      const cloned = deepClone(arr);
      expect(cloned[0]).not.toBe(arr[0]);
      expect(cloned).toEqual(arr);
    });
  });

  describe('isEmpty', () => {
    it('returns true for null', () => {
      expect(isEmpty(null)).toBe(true);
    });

    it('returns true for undefined', () => {
      expect(isEmpty(undefined)).toBe(true);
    });

    it('returns true for empty string', () => {
      expect(isEmpty('')).toBe(true);
    });

    it('returns true for empty array', () => {
      expect(isEmpty([])).toBe(true);
    });

    it('returns true for empty object', () => {
      expect(isEmpty({})).toBe(true);
    });

    it('returns false for non-empty string', () => {
      expect(isEmpty('hello')).toBe(false);
    });

    it('returns false for non-empty array', () => {
      expect(isEmpty([1])).toBe(false);
    });

    it('returns false for non-empty object', () => {
      expect(isEmpty({ a: 1 })).toBe(false);
    });

    it('returns false for numbers', () => {
      expect(isEmpty(0)).toBe(false);
      expect(isEmpty(42)).toBe(false);
    });

    it('returns false for boolean', () => {
      expect(isEmpty(false)).toBe(false);
    });
  });
});
