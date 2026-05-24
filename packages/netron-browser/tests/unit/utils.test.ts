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

  describe('calculateBackoff (full jitter — AWS Brooker 2015)', () => {
    it('first attempt returns exactly baseDelay (zero jitter span)', () => {
      // attempt=1 → exp = baseDelay * 2^0 = baseDelay → span = 0
      for (let i = 0; i < 50; i += 1) {
        expect(calculateBackoff(1, 1000)).toBe(1000);
      }
    });

    it('subsequent attempts draw uniformly from [baseDelay, exp(attempt)]', () => {
      for (let i = 0; i < 200; i += 1) {
        const d2 = calculateBackoff(2, 1000);
        expect(d2).toBeGreaterThanOrEqual(1000);
        expect(d2).toBeLessThanOrEqual(2000);
        const d3 = calculateBackoff(3, 1000);
        expect(d3).toBeGreaterThanOrEqual(1000);
        expect(d3).toBeLessThanOrEqual(4000);
        const d4 = calculateBackoff(4, 1000);
        expect(d4).toBeGreaterThanOrEqual(1000);
        expect(d4).toBeLessThanOrEqual(8000);
      }
    });

    it('caps the upper bound at maxDelay', () => {
      for (let i = 0; i < 200; i += 1) {
        const d = calculateBackoff(20, 1000);
        expect(d).toBeGreaterThanOrEqual(1000);
        expect(d).toBeLessThanOrEqual(30000);
      }
    });

    it('caller-supplied maxDelay overrides the default', () => {
      const d = calculateBackoff(30, 1000, 5000);
      expect(d).toBeGreaterThanOrEqual(1000);
      expect(d).toBeLessThanOrEqual(5000);
    });

    it('spreads high-attempt retries across most of [base, max] — anti thundering-herd invariant', () => {
      // The whole point of full jitter: at attempt=10+ the spread
      // should cover most of the [base, max] window.
      const samples: number[] = [];
      for (let i = 0; i < 1000; i += 1) {
        samples.push(calculateBackoff(10, 1000, 30000));
      }
      samples.sort((a, b) => a - b);
      const span = samples[samples.length - 1]! - samples[0]!;
      // Window is 29000ms wide. 1000 uniform samples cover ~99%.
      expect(span).toBeGreaterThan(29000 * 0.9);
    });

    it('clamps attempt=0 to the same as attempt=1 (no negative power)', () => {
      expect(calculateBackoff(0, 1000)).toBe(1000);
    });

    it('handles degenerate inputs without producing zero/NaN', () => {
      expect(calculateBackoff(1, 0)).toBe(1);
      expect(calculateBackoff(1, -1)).toBe(1);
      // maxDelay < baseDelay: max promoted to base — delay still ≥ base.
      expect(calculateBackoff(5, 1000, 100)).toBe(1000);
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
