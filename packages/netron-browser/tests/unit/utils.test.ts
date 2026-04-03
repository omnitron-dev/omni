/**
 * Unit tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  generateRequestId,
  validateUrl,
  normalizeUrl,
  httpToWsUrl,
  calculateBackoff,
  deepClone,
  deepMerge,
} from '../../src/utils/index.js';

describe('Utils', () => {
  describe('generateRequestId', () => {
    it('should generate unique IDs', () => {
      const id1 = generateRequestId();
      const id2 = generateRequestId();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
      expect(id1.length).toBeGreaterThan(0);
    });
  });

  describe('validateUrl', () => {
    it('should validate correct URLs', () => {
      expect(validateUrl('http://localhost:3000')).toBe(true);
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('ws://localhost:3000')).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(validateUrl('invalid-url')).toBe(false);
      expect(validateUrl('')).toBe(false);
    });
  });

  describe('normalizeUrl', () => {
    it('should remove trailing slash', () => {
      expect(normalizeUrl('http://localhost:3000/')).toBe('http://localhost:3000');
      expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000');
    });
  });

  describe('httpToWsUrl', () => {
    it('should convert HTTP to WebSocket URL', () => {
      expect(httpToWsUrl('http://localhost:3000')).toBe('ws://localhost:3000');
      expect(httpToWsUrl('https://localhost:3000')).toBe('wss://localhost:3000');
    });
  });

  describe('calculateBackoff', () => {
    it('should calculate exponential backoff', () => {
      expect(calculateBackoff(1, 1000)).toBe(1000);
      expect(calculateBackoff(2, 1000)).toBe(2000);
      expect(calculateBackoff(3, 1000)).toBe(4000);
      expect(calculateBackoff(4, 1000)).toBe(8000);
    });

    it('should cap at maximum delay', () => {
      expect(calculateBackoff(10, 1000)).toBe(30000);
      expect(calculateBackoff(20, 1000)).toBe(30000);
    });
  });

  describe('deepClone', () => {
    it('should deep clone objects', () => {
      const obj = { a: 1, b: { c: 2 } };
      const clone = deepClone(obj);
      expect(clone).toEqual(obj);
      expect(clone).not.toBe(obj);
      expect(clone.b).not.toBe(obj.b);
    });

    it('should clone arrays', () => {
      const arr = [1, 2, { a: 3 }];
      const clone = deepClone(arr);
      expect(clone).toEqual(arr);
      expect(clone).not.toBe(arr);
    });
  });

  describe('deepMerge', () => {
    it('should merge objects deeply', () => {
      const target = { a: 1, b: { c: 2 } };
      const source = { b: { d: 3 }, e: 4 };
      const result = deepMerge(target, source);
      expect(result).toEqual({ a: 1, b: { c: 2, d: 3 }, e: 4 });
    });

    it('should handle multiple sources', () => {
      const target = { a: 1 };
      const source1 = { b: 2 };
      const source2 = { c: 3 };
      const result = deepMerge(target, source1, source2);
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });
  });
});
