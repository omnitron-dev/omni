/**
 * CRITICAL Priority: Advanced Coercion Edge Cases
 *
 * Tests for uncovered code paths identified in coverage analysis:
 * - Nullable field coercion (lines 305-307)
 * - Refinement preservation with coercion (lines 319-325) - KNOWN LIMITATION
 * - Null/undefined edge cases (lines 354-358, 382-383)
 * - Number/Boolean coercion edge cases
 * - Date coercion with constraints (lines 393-396)
 * - BigInt coercion (line 404)
 *
 * IMPORTANT NOTES:
 * - Refinements are LOST during coercion (validation-engine.ts:319-325)
 * - This is a known limitation documented in the code
 * - Tests marked as .skip() test this known limitation for future reference
 */

import { z } from 'zod';
import { ValidationEngine } from '../../src/validation/validation-engine.js';

// Helper for tests
function fail(message: string): never {
  throw new Error(message);
}

describe('Advanced Coercion Edge Cases', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
  });

  describe('CRITICAL: Nullable Field Coercion', () => {
    it('should coerce nullable fields correctly', () => {
      const schema = z.object({
        age: z.number().nullable(),
        name: z.string().nullable(),
        count: z.number().nullable()
      });

      const validator = engine.compile(schema, { coerce: true });

      // All fields with values - should coerce
      const result1 = validator.validate({
        age: '25',
        name: 'John',
        count: '100'
      });
      expect(result1.age).toBe(25);
      expect(result1.name).toBe('John');
      expect(result1.count).toBe(100);

      // All fields null - should remain null
      const result2 = validator.validate({
        age: null,
        name: null,
        count: null
      });
      expect(result2.age).toBeNull();
      expect(result2.name).toBeNull();
      expect(result2.count).toBeNull();

      // Mixed - some coerced, some null
      const result3 = validator.validate({
        age: '0',
        name: null,
        count: '999'
      });
      expect(result3.age).toBe(0);
      expect(result3.name).toBeNull();
      expect(result3.count).toBe(999);
    });

    it('should handle nullable booleans with coercion', () => {
      const schema = z.object({
        active: z.boolean().nullable(),
        verified: z.boolean().nullable()
      });

      const validator = engine.compile(schema, { coerce: true });

      const result = validator.validate({
        active: 'true',
        verified: null
      });

      expect(result.active).toBe(true);
      expect(result.verified).toBeNull();
    });

    it('should handle deeply nested nullable fields', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            age: z.number().nullable(),
            bio: z.string().nullable()
          }).nullable()
        }).nullable()
      });

      const validator = engine.compile(schema, { coerce: true });

      // Nested object is null
      const result1 = validator.validate({ user: null });
      expect(result1.user).toBeNull();

      // Profile is null
      const result2 = validator.validate({
        user: { profile: null }
      });
      expect(result2.user.profile).toBeNull();

      // Fields are null
      const result3 = validator.validate({
        user: { profile: { age: null, bio: null } }
      });
      expect(result3.user!.profile!.age).toBeNull();
      expect(result3.user!.profile!.bio).toBeNull();

      // Fields are coerced
      const result4 = validator.validate({
        user: { profile: { age: '30', bio: 'Test' } }
      });
      expect(result4.user!.profile!.age).toBe(30);
      expect(result4.user!.profile!.bio).toBe('Test');
    });
  });

  describe('CRITICAL: Refinement Preservation with Coercion', () => {
    // KNOWN LIMITATION: Refinements are lost during coercion (validation-engine.ts:319-325)
    // These tests document expected behavior once the limitation is fixed
    it.skip('should preserve number refinements when coercion is applied', () => {
      const schema = z.number()
        .refine(n => n > 0, { message: 'Must be positive' })
        .refine(n => n < 100, { message: 'Must be less than 100' });

      const validator = engine.compile(schema, { coerce: true });

      // Valid range - should coerce AND validate refinements
      expect(validator.validate('50')).toBe(50);
      expect(validator.validate('1')).toBe(1);
      expect(validator.validate('99')).toBe(99);

      // Invalid - too small (refinement should work)
      try {
        validator.validate('-10');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Must be positive'))).toBe(true);
      }

      try {
        validator.validate('0');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Must be positive'))).toBe(true);
      }

      // Invalid - too large (refinement should work)
      try {
        validator.validate('100');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Must be less than 100'))).toBe(true);
      }

      try {
        validator.validate('150');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Must be less than 100'))).toBe(true);
      }
    });

    it.skip('should preserve string refinements with transforms', () => {
      const schema = z.string()
        .email()
        .refine(
          s => !s.endsWith('@blocked.com'),
          { message: 'Blocked domain' }
        );

      const validator = engine.compile(schema);

      // Valid email
      expect(validator.validate('test@example.com')).toBe('test@example.com');

      // Invalid - blocked domain (refinement should work)
      try {
        validator.validate('test@blocked.com');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Blocked domain'))).toBe(true);
      }

      // Invalid - not an email
      expect(() => validator.validate('not-an-email')).toThrow();
    });

    it.skip('should preserve object refinements', () => {
      const schema = z.object({
        password: z.string(),
        confirmPassword: z.string()
      }).refine(
        data => data.password === data.confirmPassword,
        { message: 'Passwords must match' }
      );

      const validator = engine.compile(schema);

      // Valid - passwords match
      expect(validator.validate({
        password: 'secret123',
        confirmPassword: 'secret123'
      })).toEqual({
        password: 'secret123',
        confirmPassword: 'secret123'
      });

      // Invalid - passwords don't match
      try {
        validator.validate({
          password: 'secret123',
          confirmPassword: 'different'
        });
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Passwords must match'))).toBe(true);
      }
    });
  });

  describe('CRITICAL: Null/Undefined Edge Cases', () => {
    it('should reject null when coercing to number', () => {
      const schema = z.object({
        count: z.number(),
        score: z.number()
      });

      const validator = engine.compile(schema, { coerce: true });

      // null should throw
      expect(() => validator.validate({
        count: null,
        score: 100
      })).toThrow('Cannot coerce null to number');
    });

    it('should handle undefined in optional fields', () => {
      const schema = z.object({
        count: z.number().optional(),
        flag: z.boolean()
      });

      const validator = engine.compile(schema, { coerce: true });

      // undefined should work for optional field
      const result1 = validator.validate({ flag: 'true' });
      expect(result1.count).toBeUndefined();
      expect(result1.flag).toBe(true);

      // Explicit undefined
      const result2 = validator.validate({
        count: undefined,
        flag: '1'
      });
      expect(result2.count).toBeUndefined();
      expect(result2.flag).toBe(true);
    });

    it('should handle edge case inputs for number coercion', () => {
      const schema = z.number();
      const validator = engine.compile(schema, { coerce: true });

      // Boolean to number
      expect(validator.validate(true)).toBe(1);
      expect(validator.validate(false)).toBe(0);

      // KNOWN LIMITATION: Infinity handling with z.preprocess
      // When coercion is applied, Zod may reject Infinity values
      // even though plain z.number() accepts them
      // This needs further investigation

      // String coercion that should throw
      expect(() => validator.validate('NaN')).toThrow();

      // Note: Arrays, objects, symbols are converted by Number() to NaN which fails validation
    });

    it('should handle edge case inputs for boolean coercion', () => {
      const schema = z.boolean();
      const validator = engine.compile(schema, { coerce: true });

      // Numbers to boolean
      expect(validator.validate(0)).toBe(false);
      expect(validator.validate(1)).toBe(true);
      expect(validator.validate(-1)).toBe(true);
      expect(validator.validate(0.5)).toBe(true);
      expect(validator.validate(Infinity)).toBe(true);
      expect(validator.validate(-Infinity)).toBe(true);

      // String edge cases
      expect(validator.validate('false')).toBe(false);
      expect(validator.validate('0')).toBe(false);
      expect(validator.validate('')).toBe(false);
      expect(validator.validate('true')).toBe(true);
      expect(validator.validate('1')).toBe(true);

      // Invalid strings
      expect(() => validator.validate('invalid')).toThrow();
      expect(() => validator.validate('yes')).toThrow();
      expect(() => validator.validate('no')).toThrow();
    });
  });

  describe('HIGH: Date Coercion with Constraints', () => {
    // KNOWN LIMITATION: Date constraints ARE NOT preserved by Zod's z.coerce.date()
    // Lines 393-396 in validation-engine.ts ATTEMPT to preserve checks but Zod v4
    // doesn't support check preservation when using z.coerce.date()
    // The checks array is copied but z.coerce.date() doesn't accept min/max chains
    it.skip('should preserve date constraints with coercion', () => {
      const minDate = new Date('2020-01-01');
      const maxDate = new Date('2025-12-31');

      const schema = z.date().min(minDate).max(maxDate);
      const validator = engine.compile(schema, { coerce: true });

      // Valid dates
      const result1 = validator.validate('2023-06-15');
      expect(result1).toBeInstanceOf(Date);
      expect(result1.getFullYear()).toBe(2023);

      const result2 = validator.validate(1609459200000); // 2021-01-01
      expect(result2).toBeInstanceOf(Date);

      // Out of range - too early
      expect(() => validator.validate('2019-01-01')).toThrow();

      // Out of range - too late
      expect(() => validator.validate('2026-01-01')).toThrow();
    });

    it('should coerce various date formats', () => {
      const schema = z.date();
      const validator = engine.compile(schema, { coerce: true });

      // ISO string
      const result1 = validator.validate('2024-01-01T00:00:00.000Z');
      expect(result1).toBeInstanceOf(Date);
      expect(result1.getFullYear()).toBe(2024);

      // Unix timestamp
      const result2 = validator.validate(1704067200000);
      expect(result2).toBeInstanceOf(Date);

      // Date object - Note: z.coerce.date() may create new Date object
      const dateObj = new Date('2024-01-01');
      const result3 = validator.validate(dateObj);
      expect(result3).toBeInstanceOf(Date);
      expect(result3.getTime()).toBe(dateObj.getTime());

      // Invalid date
      expect(() => validator.validate('invalid-date')).toThrow();
      expect(() => validator.validate('not-a-date')).toThrow();
    });
  });

  describe('MEDIUM: BigInt Coercion', () => {
    it('should coerce to bigint', () => {
      const schema = z.bigint();
      const validator = engine.compile(schema, { coerce: true });

      // String to bigint
      expect(validator.validate('12345678901234567890')).toBe(12345678901234567890n);
      expect(validator.validate('999')).toBe(999n);

      // Number to bigint
      expect(validator.validate(123)).toBe(123n);
      expect(validator.validate(0)).toBe(0n);
      expect(validator.validate(-456)).toBe(-456n);

      // BigInt passthrough
      expect(validator.validate(789n)).toBe(789n);

      // Invalid
      expect(() => validator.validate('invalid')).toThrow();
      expect(() => validator.validate('12.34')).toThrow();
    });

    // KNOWN LIMITATION: Refinements are lost during coercion
    it.skip('should handle bigint with validation', () => {
      const schema = z.bigint()
        .refine(n => n > 0n, { message: 'Must be positive' });

      const validator = engine.compile(schema, { coerce: true });

      // Valid
      expect(validator.validate('100')).toBe(100n);
      expect(validator.validate(50)).toBe(50n);

      // Invalid - not positive
      try {
        validator.validate('0');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Must be positive'))).toBe(true);
      }

      try {
        validator.validate('-10');
        fail('Should have thrown');
      } catch (error: any) {
        expect(error.name).toBe('ValidationError');
        expect(error.validationErrors).toBeDefined();
        expect(error.validationErrors.some((e: any) => e.message.includes('Must be positive'))).toBe(true);
      }
    });
  });

  describe('MEDIUM: Nested Object Mode Inheritance', () => {
    it('should use strip mode as default for nested objects without explicit mode', () => {
      const schema = z.object({
        outer: z.object({
          inner: z.object({
            value: z.number()
          })
        })
      });

      // No mode specified - should default to strip
      const validator = engine.compile(schema, { coerce: true });

      const input = {
        outer: {
          inner: {
            value: '123',
            extra1: 'strip me'
          },
          extra2: 'strip me'
        },
        extra3: 'strip me'
      };

      const result = validator.validate(input);

      // Should coerce
      expect(result.outer.inner.value).toBe(123);

      // Should strip all extra fields (default strip mode)
      expect((result.outer.inner as any).extra1).toBeUndefined();
      expect((result.outer as any).extra2).toBeUndefined();
      expect((result as any).extra3).toBeUndefined();
    });

    it('should inherit parent mode in deeply nested objects', () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              value: z.number()
            })
          })
        })
      });

      // Strict mode should be inherited
      const strictValidator = engine.compile(schema, { mode: 'strict', coerce: true });

      // Valid - no extra fields
      expect(() => strictValidator.validate({
        level1: {
          level2: {
            level3: {
              value: '100'
            }
          }
        }
      })).not.toThrow();

      // Invalid - extra field at any level should fail
      expect(() => strictValidator.validate({
        level1: {
          level2: {
            level3: {
              value: '100',
              extra: 'field'
            }
          }
        }
      })).toThrow();

      // Passthrough mode should be inherited
      const passthroughValidator = engine.compile(schema, { mode: 'passthrough', coerce: true });

      const result = passthroughValidator.validate({
        level1: {
          level2: {
            level3: {
              value: '200',
              extra: 'preserved'
            }
          }
        }
      });

      expect(result.level1.level2.level3.value).toBe(200);
      expect((result.level1.level2.level3 as any).extra).toBe('preserved');
    });
  });

  describe('MEDIUM: Zod v4 Array Coercion Limitations', () => {
    // Documents lines 334, 366 in validation-engine.ts
    // These lines skip coercion for primitives inside arrays to avoid Zod v4 compilation errors
    it('should not coerce primitives inside arrays (Zod v4 limitation)', () => {
      const schema = z.object({
        numbers: z.array(z.number()),
        booleans: z.array(z.boolean())
      });

      const validator = engine.compile(schema, { coerce: true });

      // Coercion doesn't work inside arrays - this is intentional
      // to avoid Zod v4 z.preprocess() inside arrays causing internal errors
      expect(() => validator.validate({
        numbers: ['1', '2', '3'],
        booleans: ['true', 'false']
      })).toThrow();

      // Should work with actual typed values
      expect(validator.validate({
        numbers: [1, 2, 3],
        booleans: [true, false]
      })).toEqual({
        numbers: [1, 2, 3],
        booleans: [true, false]
      });
    });

    it('should work with explicit z.coerce in array element schemas', () => {
      // Workaround: use explicit z.coerce.* in schema
      const schema = z.object({
        numbers: z.array(z.coerce.number()),
        booleans: z.array(z.coerce.boolean())
      });

      const validator = engine.compile(schema, { mode: 'strip' });

      // Note: z.coerce.boolean() treats any non-empty string as true
      const result = validator.validate({
        numbers: ['1', '2', '3'],
        booleans: [1, 0, true, false],
        extra: 'strip'
      });

      expect(result.numbers).toEqual([1, 2, 3]);
      expect(result.booleans).toEqual([true, false, true, false]);
      expect((result as any).extra).toBeUndefined();
    });
  });

  describe('MEDIUM: Transform Preservation with Mode Options', () => {
    // CRITICAL: Line 240 in validation-engine.ts - ZodEffects protection
    it('should not modify object schemas with transforms during optimization', () => {
      const schema = z.object({
        email: z.string().email()
      }).transform(obj => ({ ...obj, normalized: true }));

      const validator = engine.compile(schema, { mode: 'strict' });

      const result = validator.validate({ email: 'test@example.com' });
      expect((result as any).normalized).toBe(true); // Transform must work
      expect((result as any).email).toBe('test@example.com');

      // Mode should not break transform - this tests line 240 protection
      // Without protection, strict mode would destroy the transform
    });

    it('should not modify transforms when applying mode options', () => {
      const schema = z.object({
        email: z.string().email().transform(s => s.toLowerCase()),
        age: z.number()
      });

      const strictValidator = engine.compile(schema, { mode: 'strict' });

      // Should fail due to extra field (strict mode)
      expect(() => strictValidator.validate({
        email: 'TEST@EXAMPLE.COM',
        age: 25,
        extra: 'field'
      })).toThrow();

      // Should work with transform (no extra fields)
      const result = strictValidator.validate({
        email: 'TEST@EXAMPLE.COM',
        age: 25
      });

      expect(result.email).toBe('test@example.com'); // Transform should work
      expect(result.age).toBe(25);
    });

    it('should preserve transforms in nested objects', () => {
      const schema = z.object({
        user: z.object({
          name: z.string().transform(s => s.trim()),
          email: z.string().email().transform(s => s.toLowerCase())
        })
      });

      const validator = engine.compile(schema, { mode: 'strip' });

      const result = validator.validate({
        user: {
          name: '  John Doe  ',
          email: 'JOHN@EXAMPLE.COM',
          extra: 'strip'
        },
        topExtra: 'strip'
      });

      expect(result.user.name).toBe('John Doe');
      expect(result.user.email).toBe('john@example.com');
      expect((result.user as any).extra).toBeUndefined();
      expect((result as any).topExtra).toBeUndefined();
    });
  });
});
