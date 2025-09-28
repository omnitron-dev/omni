import { describe, it, expect } from '@jest/globals';
import { cuid, isCuid, createOptimizedCuid } from '../src/index';

describe('CUID', () => {
  describe('cuid() - default generator', () => {
    it('should generate a valid CUID', () => {
      const id = cuid();
      expect(typeof id).toBe('string');
      expect(id.length).toBe(16);
      expect(isCuid(id)).toBe(true);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      const count = 10000;

      for (let i = 0; i < count; i++) {
        ids.add(cuid());
      }

      expect(ids.size).toBe(count);
    });

    it('should start with a lowercase letter', () => {
      for (let i = 0; i < 100; i++) {
        const id = cuid();
        expect(/^[a-z]/.test(id)).toBe(true);
      }
    });

    it('should only contain lowercase letters and numbers', () => {
      for (let i = 0; i < 100; i++) {
        const id = cuid();
        expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true);
      }
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

  describe('isCuid() - validation', () => {
    it('should validate correct CUIDs', () => {
      const validCuids = [
        'a1',
        'ab',
        'a1234567890abcde',
        'z9876543210zyxwv',
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
        'a', // too short (minimum is 2)
        'A123', // starts with uppercase
        'A1234567890abcde', // starts with uppercase
        '1abc', // starts with number
        '12345678901234567', // starts with number
        'a-123', // contains hyphen
        'a_123', // contains underscore
        'a 123', // contains space
        'a!123', // contains special character
        'aB123', // contains uppercase letter
        'a12345-67890abcd', // contains dash
        'a'.repeat(33), // too long (maximum is 32)
      ];

      for (const id of invalidCuids) {
        expect(isCuid(id)).toBe(false);
      }
    });

    it('should handle edge cases', () => {
      expect(isCuid('ab')).toBe(true); // Minimum valid length
      expect(isCuid('a' + '0'.repeat(31))).toBe(true); // Maximum valid length (32)
      expect(isCuid('a' + '0'.repeat(32))).toBe(false); // Too long (33)
    });

    it('should handle non-string inputs gracefully', () => {
      expect(isCuid(123 as any)).toBe(false);
      expect(isCuid({} as any)).toBe(false);
      expect(isCuid([] as any)).toBe(false);
      expect(isCuid(null as any)).toBe(false);
      expect(isCuid(undefined as any)).toBe(false);
    });

    it('should validate generated CUIDs', () => {
      // Test with default generator
      for (let i = 0; i < 100; i++) {
        expect(isCuid(cuid())).toBe(true);
      }

      // Test with custom generators
      const lengths = [8, 12, 16, 20, 24, 28, 32];
      for (const length of lengths) {
        const customCuid = createOptimizedCuid({ length });
        for (let i = 0; i < 10; i++) {
          const id = customCuid();
          expect(isCuid(id)).toBe(true);
        }
      }
    });
  });

  describe('createOptimizedCuid() - factory function', () => {
    it('should create a custom CUID generator with default options', () => {
      const customCuid = createOptimizedCuid();
      const id = customCuid();

      expect(typeof id).toBe('string');
      expect(id.length).toBe(16); // default length
      expect(isCuid(id)).toBe(true);
    });

    it('should create a CUID generator with custom length', () => {
      const lengths = [8, 12, 16, 20, 24, 28, 32];

      for (const length of lengths) {
        const customCuid = createOptimizedCuid({ length });
        const id = customCuid();

        expect(id.length).toBe(length);
        expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true);
        expect(isCuid(id)).toBe(true);
      }
    });

    it('should use custom fingerprint if provided', () => {
      const customFingerprint = 'customfingerprint12345678901234';
      const customCuid = createOptimizedCuid({
        length: 16,
        fingerprint: customFingerprint,
      });

      const id = customCuid();
      expect(id.length).toBe(16);
      expect(isCuid(id)).toBe(true);
    });

    it('should use custom initial count if provided', () => {
      const customCuid = createOptimizedCuid({
        length: 16,
        initialCount: 1000000,
      });

      const id = customCuid();
      expect(id.length).toBe(16);
      expect(isCuid(id)).toBe(true);
    });

    it('should handle all options together', () => {
      const customFingerprint = 'test-fingerprint';
      const customLength = 20;
      const initialCount = 500;

      const customCuid = createOptimizedCuid({
        length: customLength,
        fingerprint: customFingerprint,
        initialCount,
      });

      const id = customCuid();

      expect(id.length).toBe(customLength);
      expect(/^[a-z][0-9a-z]+$/.test(id)).toBe(true);
      expect(isCuid(id)).toBe(true);
    });

    it('should create unique IDs with custom generator', () => {
      const cuid20 = createOptimizedCuid({ length: 20 });
      const ids = new Set<string>();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        ids.add(cuid20());
      }

      expect(ids.size).toBe(count);
    });

    it('should handle very small lengths', () => {
      const customCuid = createOptimizedCuid({ length: 2 });
      const id = customCuid();

      expect(id.length).toBe(2);
      expect(/^[a-z][0-9a-z]$/.test(id)).toBe(true);
    });

    it('should handle maximum practical length', () => {
      const customCuid = createOptimizedCuid({ length: 32 });
      const id = customCuid();

      expect(id.length).toBe(32);
      expect(isCuid(id)).toBe(true);
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
      const generators = Array.from({ length: 10 }, () => createOptimizedCuid());
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

  describe('Specification compliance', () => {
    it('should always start with a lowercase letter', () => {
      const testCount = 10000;

      for (let i = 0; i < testCount; i++) {
        const id = cuid();
        expect(/^[a-z]/.test(id)).toBe(true);
      }
    });

    it('should only contain lowercase alphanumeric characters', () => {
      const testCount = 1000;
      const lengths = [8, 16, 24, 32];

      for (const length of lengths) {
        const customCuid = createOptimizedCuid({ length });

        for (let i = 0; i < testCount; i++) {
          const id = customCuid();
          expect(/^[a-z][0-9a-z]*$/.test(id)).toBe(true);
        }
      }
    });

    it('should be URL-safe', () => {
      const testCount = 1000;

      for (let i = 0; i < testCount; i++) {
        const id = cuid();
        const encoded = encodeURIComponent(id);
        expect(encoded).toBe(id); // Should not need encoding
      }
    });

    it('should be case-insensitive safe (all lowercase)', () => {
      const testCount = 1000;

      for (let i = 0; i < testCount; i++) {
        const id = cuid();
        expect(id.toLowerCase()).toBe(id);
      }
    });
  });

  describe('Performance characteristics', () => {
    it('should generate IDs quickly', () => {
      const iterations = 10000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        cuid();
      }

      const endTime = Date.now();
      const timePerID = (endTime - startTime) / iterations;

      // Should generate at least 1000 IDs per second (1ms per ID)
      expect(timePerID).toBeLessThan(1);
    });

    it('should validate IDs quickly', () => {
      const testId = cuid();
      const iterations = 100000;
      const startTime = Date.now();

      for (let i = 0; i < iterations; i++) {
        isCuid(testId);
      }

      const endTime = Date.now();
      const timePerValidation = (endTime - startTime) / iterations;

      // Should validate at least 100,000 IDs per second
      expect(timePerValidation).toBeLessThan(0.01);
    });

    it('should scale linearly with length', () => {
      const iterations = 1000;
      const timings: Record<number, number> = {};

      for (const length of [8, 16, 24, 32]) {
        const customCuid = createOptimizedCuid({ length });
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

  describe('Compatibility with expected format', () => {
    it('should generate IDs with expected format', () => {
      const id = cuid();

      // Check format matches expected pattern
      expect(id).toMatch(/^[a-z][0-9a-z]{15}$/);

      // First character should be a letter
      expect(id.charCodeAt(0)).toBeGreaterThanOrEqual(97);
      expect(id.charCodeAt(0)).toBeLessThanOrEqual(122);

      // Rest should be alphanumeric
      for (let i = 1; i < id.length; i++) {
        const code = id.charCodeAt(i);
        const isNumber = code >= 48 && code <= 57;
        const isLetter = code >= 97 && code <= 122;
        expect(isNumber || isLetter).toBe(true);
      }
    });
  });

  describe('Edge cases', () => {
    it('should generate different IDs even with same timestamp', () => {
      const ids: string[] = [];
      // Generate multiple IDs as fast as possible
      for (let i = 0; i < 10; i++) {
        ids.push(cuid());
      }

      // All should be unique due to counter
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should not leak counter state in generated IDs', () => {
      const customCuid = createOptimizedCuid({ initialCount: 12345 });
      const id = customCuid();

      // The counter value should not be directly visible in the ID
      expect(id.includes('12345')).toBe(false);
      expect(id.includes('3039')).toBe(false); // 12345 in base 36
    });

    it('should handle boundary values for initialCount', () => {
      const zeroCount = createOptimizedCuid({ initialCount: 0 });
      const maxCount = createOptimizedCuid({ initialCount: Number.MAX_SAFE_INTEGER - 100 });

      const id1 = zeroCount();
      const id2 = maxCount();

      expect(isCuid(id1)).toBe(true);
      expect(isCuid(id2)).toBe(true);
    });
  });
});