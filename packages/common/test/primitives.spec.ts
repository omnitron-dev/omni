import { noop, truly, arrify, falsely, identity } from '../src/primitives.js';

describe('primitives', () => {
  describe('noop', () => {
    it('should return undefined', () => {
      expect(noop()).toBeUndefined();
    });

    it('should ignore arguments', () => {
      expect(noop(1, 2, 3)).toBeUndefined();
    });
  });

  describe('identity', () => {
    it('should return the same value for primitives', () => {
      expect(identity(1)).toBe(1);
      expect(identity('test')).toBe('test');
      expect(identity(true)).toBe(true);
      expect(identity(null)).toBe(null);
      expect(identity(undefined)).toBe(undefined);
      expect(identity(Symbol('test'))).toBeTruthy();
    });

    it('should return the same reference for objects', () => {
      const obj = { test: 123 };
      const arr = [1, 2, 3];
      const func = () => {};

      expect(identity(obj)).toBe(obj);
      expect(identity(arr)).toBe(arr);
      expect(identity(func)).toBe(func);
    });

    it('should preserve undefined and null', () => {
      expect(identity(undefined)).toBeUndefined();
      expect(identity(null)).toBeNull();
    });
  });

  describe('truly', () => {
    it('should always return true', () => {
      expect(truly()).toBe(true);
      expect(truly(false as any)).toBe(true);
      expect(truly(null as any)).toBe(true);
      expect(truly(undefined as any)).toBe(true);
      expect(truly({} as any)).toBe(true);
    });
  });

  describe('falsely', () => {
    it('should always return false', () => {
      expect(falsely()).toBe(false);
      expect(falsely(true as any)).toBe(false);
      expect(falsely(null as any)).toBe(false);
      expect(falsely(undefined as any)).toBe(false);
      expect(falsely({} as any)).toBe(false);
    });
  });

  describe('arrify', () => {
    it('should handle undefined and null', () => {
      expect(arrify(undefined)).toEqual([]);
      expect(arrify(null)).toEqual([]);
    });

    it('should handle primitive values', () => {
      expect(arrify(1)).toEqual([1]);
      expect(arrify('test')).toEqual(['test']);
      expect(arrify(true)).toEqual([true]);
      expect(arrify(Symbol('test'))).toHaveLength(1);
    });

    it('should handle arrays', () => {
      expect(arrify([1, 2, 3])).toEqual([1, 2, 3]);
      expect(arrify([])).toEqual([]);
      expect(arrify([null])).toEqual([null]);
      expect(arrify([undefined])).toEqual([undefined]);
    });

    it('should handle objects', () => {
      const obj = { test: 123 };
      expect(arrify(obj)).toEqual([obj]);
    });

    it('should handle nested arrays', () => {
      const arr = [1, [2, 3], 4];
      expect(arrify(arr)).toBe(arr);
    });

    it('should preserve array reference', () => {
      const arr = [1, 2, 3];
      expect(arrify(arr)).toBe(arr);
    });

    it('should handle special cases', () => {
      expect(arrify(NaN)).toEqual([NaN]);
      expect(arrify(0)).toEqual([0]);
      expect(arrify(false)).toEqual([false]);
      expect(arrify('')).toEqual(['']);
    });

    it('should handle functions', () => {
      const func = () => {};
      expect(arrify(func)).toEqual([func]);
    });
  });
});
