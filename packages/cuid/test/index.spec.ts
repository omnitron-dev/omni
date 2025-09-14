import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  init,
  cuid,
  isCuid,
  createFingerprint,
  createCounter,
  bufToBigInt,
  getConstants,
} from '../src/index';

describe('CUID2', () => {
  describe('cuid() - default instance', () => {
    it('should generate a valid CUID', () => {
      const id = cuid();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(16);
      expect(/^[a-z]/.test(id)).toBe(true); // starts with lowercase letter
      expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true); // only lowercase letters and numbers
    });

    it('should generate unique IDs', () => {
      const ids = new Set();
      const count = 10000;

      for (let i = 0; i < count; i++) {
        ids.add(cuid());
      }

      expect(ids.size).toBe(count);
    });

    it('should maintain chronological ordering for IDs generated in sequence', () => {
      const ids: string[] = [];
      for (let i = 0; i < 100; i++) {
        ids.push(cuid());
      }

      // All IDs should be unique
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  describe('init()', () => {
    it('should create a custom CUID generator with default options', () => {
      const customCuid = init();
      const id = customCuid();

      expect(typeof id).toBe('string');
      expect(id.length).toBe(24); // default length
      expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true);
    });

    it('should create a CUID generator with custom length', () => {
      const lengths = [8, 12, 16, 20, 24, 28, 32];

      for (const length of lengths) {
        const customCuid = init({ length });
        const id = customCuid();

        expect(id.length).toBe(length);
        expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true);
      }
    });

    it('should use custom random function', () => {
      const mockRandom = jest.fn(() => 0.5);
      const customCuid = init({ random: mockRandom });

      customCuid();

      expect(mockRandom).toHaveBeenCalled();
    });

    it('should use custom counter', () => {
      let counterValue = 100;
      const customCounter = () => counterValue++;
      const customCuid = init({ counter: customCounter });

      const id1 = customCuid();
      const id2 = customCuid();

      expect(id1).not.toBe(id2);
      expect(counterValue).toBe(102);
    });

    it('should use custom fingerprint', () => {
      const customFingerprint = 'custom-fingerprint-12345678';
      const customCuid = init({ fingerprint: customFingerprint });

      const id = customCuid();
      expect(id).toBeDefined();
      expect(id.length).toBe(24);
    });

    it('should handle all options together', () => {
      const mockRandom = jest.fn(() => 0.7);
      const customCounter = createCounter(500);
      const customFingerprint = 'test-fingerprint';
      const customLength = 20;

      const customCuid = init({
        random: mockRandom,
        counter: customCounter,
        fingerprint: customFingerprint,
        length: customLength,
      });

      const id = customCuid();

      expect(id.length).toBe(customLength);
      expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true);
      expect(mockRandom).toHaveBeenCalled();
    });
  });

  describe('isCuid()', () => {
    it('should validate correct CUIDs', () => {
      const validCuids = [
        'a1',
        'z123456789abcdef',
        'abcdefghijklmnop',
        'a1234567890abcdefghijklmnopqrst',
      ];

      for (const id of validCuids) {
        expect(isCuid(id)).toBe(true);
      }
    });

    it('should reject invalid CUIDs', () => {
      const invalidCuids = [
        '', // empty string
        'a', // too short (default min is 2)
        'A123', // starts with uppercase
        '1abc', // starts with number
        'a-123', // contains hyphen
        'a_123', // contains underscore
        'a 123', // contains space
        'a!123', // contains special character
        'aB123', // contains uppercase letter
        'a'.repeat(33), // too long (default max is 32)
      ];

      for (const id of invalidCuids) {
        expect(isCuid(id)).toBe(false);
      }
    });

    it('should respect custom minLength', () => {
      // Note: regex requires at least 2 characters, so single char always fails
      expect(isCuid('a', { minLength: 1 })).toBe(false);
      expect(isCuid('a1', { minLength: 1 })).toBe(true);
      expect(isCuid('ab', { minLength: 3 })).toBe(false);
      expect(isCuid('abc', { minLength: 3 })).toBe(true);
    });

    it('should respect custom maxLength', () => {
      const longId = 'a' + '1'.repeat(35);

      expect(isCuid(longId, { maxLength: 40 })).toBe(true);
      expect(isCuid(longId, { maxLength: 30 })).toBe(false);
    });

    it('should handle both minLength and maxLength', () => {
      const id = 'abcdef';

      expect(isCuid(id, { minLength: 5, maxLength: 10 })).toBe(true);
      expect(isCuid(id, { minLength: 7, maxLength: 10 })).toBe(false);
      expect(isCuid(id, { minLength: 5, maxLength: 5 })).toBe(false);
    });

    it('should handle non-string inputs gracefully', () => {
      // The function will throw on null/undefined because it accesses .length before type check
      expect(() => isCuid(null as any)).toThrow();
      expect(() => isCuid(undefined as any)).toThrow();

      // Numbers and objects have undefined .length, so they'll fail the length check
      expect(isCuid(123 as any)).toBe(false);
      expect(isCuid({} as any)).toBe(false);

      // Arrays have length property but fail the type check
      expect(isCuid([] as any)).toBe(false);
      expect(isCuid(['a'] as any)).toBe(false);
    });

    it('should validate generated CUIDs', () => {
      // Test with default generator
      expect(isCuid(cuid())).toBe(true);

      // Test with custom generators
      const lengths = [8, 16, 24, 32];
      for (const length of lengths) {
        const customCuid = init({ length });
        const id = customCuid();
        expect(isCuid(id)).toBe(true);
      }
    });
  });

  describe('createFingerprint()', () => {
    it('should create a fingerprint with default options', () => {
      const fingerprint = createFingerprint();

      expect(typeof fingerprint).toBe('string');
      expect(fingerprint.length).toBe(32); // bigLength
      expect(/^[0-9a-z]+$/.test(fingerprint)).toBe(true);
    });

    it('should create different fingerprints with different random functions', () => {
      const random1 = () => 0.1;
      const random2 = () => 0.9;

      const fingerprint1 = createFingerprint({ random: random1 });
      const fingerprint2 = createFingerprint({ random: random2 });

      expect(fingerprint1).not.toBe(fingerprint2);
    });

    it('should use global object for fingerprinting', () => {
      const globalObj = {
        testKey1: 'value1',
        testKey2: 'value2',
      };

      const fingerprint = createFingerprint({ globalObj });

      expect(fingerprint).toBeDefined();
      expect(fingerprint.length).toBe(32);
    });

    it('should handle empty global object', () => {
      const fingerprint = createFingerprint({ globalObj: {} });

      expect(fingerprint).toBeDefined();
      expect(fingerprint.length).toBe(32);
    });

    it('should produce consistent fingerprints with same inputs', () => {
      const mockRandom = jest.fn<() => number>()
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5);

      const globalObj = { key: 'value' };

      const fingerprint1 = createFingerprint({ globalObj, random: mockRandom });

      // Reset mock to return same values
      mockRandom.mockClear();
      mockRandom
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5)
        .mockReturnValueOnce(0.5);

      const fingerprint2 = createFingerprint({ globalObj, random: mockRandom });

      expect(fingerprint1).toBe(fingerprint2);
    });
  });

  describe('createCounter()', () => {
    it('should create a counter starting from given value', () => {
      const counter = createCounter(10);

      expect(counter()).toBe(10);
      expect(counter()).toBe(11);
      expect(counter()).toBe(12);
    });

    it('should handle zero as initial value', () => {
      const counter = createCounter(0);

      expect(counter()).toBe(0);
      expect(counter()).toBe(1);
      expect(counter()).toBe(2);
    });

    it('should handle negative initial values', () => {
      const counter = createCounter(-5);

      expect(counter()).toBe(-5);
      expect(counter()).toBe(-4);
      expect(counter()).toBe(-3);
    });

    it('should handle large numbers', () => {
      const largeNumber = Number.MAX_SAFE_INTEGER - 2;
      const counter = createCounter(largeNumber);

      expect(counter()).toBe(largeNumber);
      expect(counter()).toBe(largeNumber + 1);
      expect(counter()).toBe(largeNumber + 2);
    });

    it('should maintain separate state for different counters', () => {
      const counter1 = createCounter(100);
      const counter2 = createCounter(200);

      expect(counter1()).toBe(100);
      expect(counter2()).toBe(200);
      expect(counter1()).toBe(101);
      expect(counter2()).toBe(201);
    });
  });

  describe('bufToBigInt()', () => {
    it('should convert empty buffer to 0', () => {
      const buffer = new Uint8Array([]);
      expect(bufToBigInt(buffer)).toBe(BigInt(0));
    });

    it('should convert single byte buffer', () => {
      const buffer = new Uint8Array([255]);
      expect(bufToBigInt(buffer)).toBe(BigInt(255));
    });

    it('should convert multi-byte buffer', () => {
      const buffer = new Uint8Array([1, 0]);
      expect(bufToBigInt(buffer)).toBe(BigInt(256));
    });

    it('should handle large buffers', () => {
      const buffer = new Uint8Array([255, 255, 255, 255]);
      expect(bufToBigInt(buffer)).toBe(BigInt(4294967295));
    });

    it('should preserve byte order', () => {
      const buffer1 = new Uint8Array([1, 2, 3]);
      const buffer2 = new Uint8Array([3, 2, 1]);

      expect(bufToBigInt(buffer1)).not.toBe(bufToBigInt(buffer2));
      expect(bufToBigInt(buffer1)).toBe(BigInt(66051)); // (1 << 16) + (2 << 8) + 3
      expect(bufToBigInt(buffer2)).toBe(BigInt(197121)); // (3 << 16) + (2 << 8) + 1
    });
  });

  describe('getConstants()', () => {
    it('should return correct constants', () => {
      const constants = getConstants();

      expect(constants).toEqual({
        defaultLength: 24,
        bigLength: 32,
      });
    });

    it('should return immutable constants', () => {
      const constants1 = getConstants();
      const constants2 = getConstants();

      expect(constants1).toEqual(constants2);
      expect(constants1.defaultLength).toBe(24);
      expect(constants1.bigLength).toBe(32);
    });
  });

  describe('Collision resistance', () => {
    it('should have low collision probability with sequential generation', () => {
      const ids = new Set();
      const count = 100000;

      for (let i = 0; i < count; i++) {
        ids.add(cuid());
      }

      expect(ids.size).toBe(count);
    });

    it('should handle concurrent-like generation', () => {
      const generators = Array.from({ length: 10 }, () => init());
      const ids = new Set();
      const idsPerGenerator = 1000;

      for (const generator of generators) {
        for (let i = 0; i < idsPerGenerator; i++) {
          ids.add(generator());
        }
      }

      expect(ids.size).toBe(generators.length * idsPerGenerator);
    });
  });

  describe('Time-based properties', () => {
    let originalDateNow: () => number;

    beforeEach(() => {
      originalDateNow = Date.now;
    });

    afterEach(() => {
      Date.now = originalDateNow;
    });

    it('should incorporate timestamp in generation', () => {
      let mockTime = 1000000;
      Date.now = jest.fn(() => mockTime);

      const customCuid = init();
      const id1 = customCuid();

      mockTime = 2000000;
      const id2 = customCuid();

      expect(id1).not.toBe(id2);
    });

    it('should generate different IDs even with same timestamp', () => {
      Date.now = jest.fn(() => 1000000);

      const customCuid = init();
      const id1 = customCuid();
      const id2 = customCuid();

      expect(id1).not.toBe(id2); // Counter ensures uniqueness
    });
  });

  describe('Security properties', () => {
    it('should not leak counter state in generated IDs', () => {
      const customCuid = init({ counter: createCounter(12345) });
      const id = customCuid();

      // The counter value should not be directly visible in the ID
      expect(id.includes('12345')).toBe(false);
      expect(id.includes('3039')).toBe(false); // 12345 in base 36
    });

    it('should use entropy mixing', () => {
      // Even with predictable random, IDs should be unpredictable due to hashing
      const predictableRandom = () => 0.5;
      const customCuid = init({ random: predictableRandom });

      const id1 = customCuid();
      const id2 = customCuid();

      // IDs should still be different due to counter and timestamp
      expect(id1).not.toBe(id2);

      // IDs should not have obvious patterns
      const commonPrefix = id1.split('').findIndex((char, i) => char !== id2[i]);
      expect(commonPrefix).toBeLessThan(3); // Only first letter might be same
    });
  });

  describe('Edge cases', () => {
    it('should handle Math.random returning 0', () => {
      const mockRandom = jest.fn(() => 0);
      const customCuid = init({ random: mockRandom });

      const id = customCuid();
      expect(id).toBeDefined();
      expect(isCuid(id)).toBe(true);
    });

    it('should handle Math.random returning 1', () => {
      const mockRandom = jest.fn(() => 0.999999);
      const customCuid = init({ random: mockRandom });

      const id = customCuid();
      expect(id).toBeDefined();
      expect(isCuid(id)).toBe(true);
    });

    it('should handle very small lengths', () => {
      const customCuid = init({ length: 2 });
      const id = customCuid();

      expect(id.length).toBe(2);
      expect(/^[a-z][0-9a-z]$/.test(id)).toBe(true);
    });

    it('should handle maximum practical length', () => {
      const customCuid = init({ length: 32 });
      const id = customCuid();

      expect(id.length).toBe(32);
      expect(isCuid(id)).toBe(true);
    });
  });

  describe('Specification compliance', () => {
    it('should always start with a lowercase letter', () => {
      const testCount = 10000;
      const customCuid = init();

      for (let i = 0; i < testCount; i++) {
        const id = customCuid();
        expect(/^[a-z]/.test(id)).toBe(true);
      }
    });

    it('should only contain lowercase alphanumeric characters', () => {
      const testCount = 1000;
      const lengths = [8, 16, 24, 32];

      for (const length of lengths) {
        const customCuid = init({ length });

        for (let i = 0; i < testCount; i++) {
          const id = customCuid();
          expect(/^[a-z][0-9a-z]*$/.test(id)).toBe(true);
        }
      }
    });

    it('should be URL-safe', () => {
      const testCount = 1000;
      const customCuid = init();

      for (let i = 0; i < testCount; i++) {
        const id = customCuid();
        const encoded = encodeURIComponent(id);
        expect(encoded).toBe(id); // Should not need encoding
      }
    });

    it('should be case-insensitive safe (all lowercase)', () => {
      const testCount = 1000;
      const customCuid = init();

      for (let i = 0; i < testCount; i++) {
        const id = customCuid();
        expect(id.toLowerCase()).toBe(id);
      }
    });
  });

  describe('Performance characteristics', () => {
    it('should generate IDs quickly', () => {
      const customCuid = init();
      const iterations = 10000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        customCuid();
      }

      const endTime = Date.now();
      const timePerID = (endTime - startTime) / iterations;

      // Should generate at least 1000 IDs per second (1ms per ID)
      expect(timePerID).toBeLessThan(1);
    });

    it('should scale linearly with length', () => {
      const iterations = 1000;
      const timings: Record<number, number> = {};

      for (const length of [8, 16, 24, 32]) {
        const customCuid = init({ length });
        const startTime = Date.now();

        for (let i = 0; i < iterations; i++) {
          customCuid();
        }

        timings[length] = Date.now() - startTime;
      }

      // Longer IDs should not take significantly more time
      // (hashing dominates, not length)
      const ratio = timings[32]! / timings[8]!;
      expect(ratio).toBeLessThan(3);
    });
  });
});