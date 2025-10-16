import { describe, expect, it } from 'vitest';
import { getPath, setPath, deletePath, hasPath } from '../../../src/utils/path';

describe('Path utilities', () => {
  describe('getPath', () => {
    it('should get value at path', () => {
      const obj = { a: { b: { c: 42 } } };
      expect(getPath(obj, 'a.b.c')).toBe(42);
    });

    it('should return undefined for non-existent path', () => {
      const obj = { a: { b: 1 } };
      expect(getPath(obj, 'a.c')).toBeUndefined();
    });

    it('should return object for empty path', () => {
      const obj = { a: 1 };
      expect(getPath(obj, '')).toEqual({ a: 1 });
    });
  });

  describe('setPath', () => {
    it('should set value at path', () => {
      const obj = { a: { b: 1 } };
      const result = setPath(obj, 'a.b', 2);

      expect(result.a.b).toBe(2);
      expect(obj.a.b).toBe(1); // Original unchanged
    });

    it('should create nested objects', () => {
      const obj = {};
      const result = setPath(obj, 'a.b.c', 42);

      expect(result).toEqual({ a: { b: { c: 42 } } });
    });

    it('should return value for empty path', () => {
      const result = setPath({}, '', 42);
      expect(result).toBe(42);
    });
  });

  describe('deletePath', () => {
    it('should delete value at path', () => {
      const obj = { a: { b: 1, c: 2 } };
      const result = deletePath(obj, 'a.b');

      expect(result.a.b).toBeUndefined();
      expect(result.a.c).toBe(2);
      expect(obj.a.b).toBe(1); // Original unchanged
    });

    it('should handle non-existent path', () => {
      const obj = { a: 1 };
      const result = deletePath(obj, 'b');

      expect(result).toEqual({ a: 1 });
    });
  });

  describe('hasPath', () => {
    it('should check if path exists', () => {
      const obj = { a: { b: { c: 42 } } };

      expect(hasPath(obj, 'a.b.c')).toBe(true);
      expect(hasPath(obj, 'a.b')).toBe(true);
      expect(hasPath(obj, 'a.d')).toBe(false);
    });

    it('should return true for empty path', () => {
      expect(hasPath({}, '')).toBe(true);
    });

    it('should handle null values', () => {
      const obj = { a: null };
      expect(hasPath(obj, 'a.b')).toBe(false);
    });
  });
});
