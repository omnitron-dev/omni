import { cuid, isCuid, createOptimizedCuid } from '../src/optimized';

describe('Optimized CUID', () => {
  describe('cuid()', () => {
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
        expect(id[0]).toMatch(/[a-z]/);
      }
    });

    it('should only contain lowercase letters and numbers', () => {
      for (let i = 0; i < 100; i++) {
        const id = cuid();
        expect(id).toMatch(/^[a-z][0-9a-z]+$/);
      }
    });
  });

  describe('isCuid()', () => {
    it('should validate correct CUIDs', () => {
      expect(isCuid('a1234567890abcde')).toBe(true);
      expect(isCuid('z9876543210zyxwv')).toBe(true);
      expect(isCuid(cuid())).toBe(true);
    });

    it('should reject invalid CUIDs', () => {
      expect(isCuid('')).toBe(false);
      expect(isCuid('1')).toBe(false); // Too short
      expect(isCuid('A1234567890abcde')).toBe(false); // Uppercase
      expect(isCuid('a12345-67890abcd')).toBe(false); // Contains dash
      expect(isCuid('12345678901234567')).toBe(false); // Starts with number
      expect(isCuid('a'.repeat(40))).toBe(false); // Too long
      expect(isCuid(123 as any)).toBe(false); // Not a string
      expect(isCuid(null as any)).toBe(false);
      expect(isCuid(undefined as any)).toBe(false);
    });

    it('should handle edge cases', () => {
      expect(isCuid('ab')).toBe(true); // Minimum valid length
      expect(isCuid('a' + '0'.repeat(31))).toBe(true); // Maximum valid length
    });
  });

  describe('createOptimizedCuid()', () => {
    it('should create a custom CUID generator with specified length', () => {
      const cuid24 = createOptimizedCuid({ length: 24 });
      const id = cuid24();
      
      expect(id.length).toBe(24);
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

    it('should use custom fingerprint if provided', () => {
      const customFingerprint = 'customfingerprint12345678901234';
      const customCuid = createOptimizedCuid({ 
        length: 16,
        fingerprint: customFingerprint 
      });
      
      const id = customCuid();
      expect(id.length).toBe(16);
      expect(isCuid(id)).toBe(true);
    });

    it('should use custom initial count if provided', () => {
      const customCuid = createOptimizedCuid({ 
        length: 16,
        initialCount: 1000000 
      });
      
      const id = customCuid();
      expect(id.length).toBe(16);
      expect(isCuid(id)).toBe(true);
    });
  });

  describe('Performance characteristics', () => {
    it('should generate IDs quickly', () => {
      const start = Date.now();
      const count = 10000;
      
      for (let i = 0; i < count; i++) {
        cuid();
      }
      
      const elapsed = Date.now() - start;
      const opsPerSecond = (count / elapsed) * 1000;
      
      // Should generate at least 10,000 IDs per second
      expect(opsPerSecond).toBeGreaterThan(10000);
    });

    it('should validate IDs quickly', () => {
      const testId = cuid();
      const start = Date.now();
      const count = 100000;
      
      for (let i = 0; i < count; i++) {
        isCuid(testId);
      }
      
      const elapsed = Date.now() - start;
      const opsPerSecond = (count / elapsed) * 1000;
      
      // Should validate at least 100,000 IDs per second
      expect(opsPerSecond).toBeGreaterThan(100000);
    });
  });

  describe('Compatibility with original implementation', () => {
    it('should generate IDs with same format as original', () => {
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
});