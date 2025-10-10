/**
 * Priority 1 CRITICAL: Coercion Modes Tests
 *
 * Tests the interaction between coercion and validation modes (strip, strict, passthrough)
 */

import { z } from 'zod';
import { ValidationEngine } from '../../src/validation/validation-engine.js';

describe('Coercion Modes Tests', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
  });

  describe('Strip mode with coercion', () => {
    it('should strip unknown fields and coerce known fields', () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean(),
        name: z.string()
      });

      const validator = engine.compile(schema, { mode: 'strip', coerce: true });

      const input = {
        age: '25',
        active: 'true',
        name: 'John',
        extra: 'should be stripped',
        another: 123
      };

      const result = validator.validate(input);

      // Should coerce types
      expect(result.age).toBe(25);
      expect(typeof result.age).toBe('number');
      expect(result.active).toBe(true);
      expect(typeof result.active).toBe('boolean');

      // Should strip unknown fields
      expect((result as any).extra).toBeUndefined();
      expect((result as any).another).toBeUndefined();

      // Should keep known fields
      expect(result.name).toBe('John');
    });

    it('should handle nested objects with strip mode and coercion', () => {
      const schema = z.object({
        user: z.object({
          id: z.coerce.number(),
          active: z.coerce.boolean()
        }),
        count: z.number()
      });

      const validator = engine.compile(schema, { mode: 'strip', coerce: true });

      const input = {
        user: {
          id: '123',
          active: '1',
          extra: 'field'
        },
        count: '456',
        topLevel: 'extra'
      };

      const result = validator.validate(input);

      expect(result.user.id).toBe(123);
      expect(result.user.active).toBe(true);
      expect((result.user as any).extra).toBeUndefined();
      expect(result.count).toBe(456);
      expect((result as any).topLevel).toBeUndefined();
    });

    it('should strip and coerce with optional fields', () => {
      const schema = z.object({
        required: z.number(),
        optional: z.boolean().optional()
      });

      const validator = engine.compile(schema, { mode: 'strip', coerce: true });

      // With optional field
      const input1 = {
        required: '100',
        optional: 'true',
        extra: 'field'
      };

      const result1 = validator.validate(input1);
      expect(result1.required).toBe(100);
      expect(result1.optional).toBe(true);
      expect((result1 as any).extra).toBeUndefined();

      // Without optional field
      const input2 = {
        required: '200',
        extra: 'field'
      };

      const result2 = validator.validate(input2);
      expect(result2.required).toBe(200);
      expect(result2.optional).toBeUndefined();
      expect((result2 as any).extra).toBeUndefined();
    });
  });

  describe('Strict mode with coercion', () => {
    it('should reject unknown fields even with coercion', () => {
      const schema = z.object({
        age: z.number(),
        name: z.string()
      });

      const validator = engine.compile(schema, { mode: 'strict', coerce: true });

      const input = {
        age: '25',
        name: 'John',
        extra: 'field'
      };

      // Should fail due to unknown field
      expect(() => validator.validate(input)).toThrow();
    });

    it('should coerce types but enforce strict schema', () => {
      const schema = z.object({
        count: z.number(),
        enabled: z.boolean()
      });

      const validator = engine.compile(schema, { mode: 'strict', coerce: true });

      // Valid input with coercion
      const validInput = {
        count: '42',
        enabled: 'true'
      };

      const result = validator.validate(validInput);
      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);

      // Invalid input with extra field
      const invalidInput = {
        count: '42',
        enabled: 'true',
        extra: 'not allowed'
      };

      expect(() => validator.validate(invalidInput)).toThrow();
    });

    it('should handle nested strict validation with coercion', () => {
      const schema = z.object({
        outer: z.object({
          inner: z.object({
            value: z.number()
          })
        })
      });

      const validator = engine.compile(schema, { mode: 'strict', coerce: true });

      // Valid nested structure
      const validInput = {
        outer: {
          inner: {
            value: '123'
          }
        }
      };

      const result = validator.validate(validInput);
      expect(result.outer.inner.value).toBe(123);

      // Invalid with extra nested field
      const invalidInput = {
        outer: {
          inner: {
            value: '123',
            extra: 'not allowed'
          }
        }
      };

      expect(() => validator.validate(invalidInput)).toThrow();
    });
  });

  describe('Passthrough mode with coercion', () => {
    it('should pass through unknown fields and coerce known fields', () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean()
      });

      const validator = engine.compile(schema, { mode: 'passthrough', coerce: true });

      const input = {
        age: '30',
        active: 'false',
        extra1: 'value1',
        extra2: 123,
        extra3: { nested: 'object' }
      };

      const result = validator.validate(input);

      // Should coerce known fields
      expect(result.age).toBe(30);
      expect(result.active).toBe(false);

      // Should pass through unknown fields unchanged
      expect((result as any).extra1).toBe('value1');
      expect((result as any).extra2).toBe(123);
      expect((result as any).extra3).toEqual({ nested: 'object' });
    });

    it('should handle nested passthrough with coercion', () => {
      const schema = z.object({
        data: z.object({
          count: z.number()
        })
      });

      const validator = engine.compile(schema, { mode: 'passthrough', coerce: true });

      const input = {
        data: {
          count: '100',
          extra: 'field'
        },
        topLevel: 'value'
      };

      const result = validator.validate(input);

      expect(result.data.count).toBe(100);
      expect((result.data as any).extra).toBe('field');
      expect((result as any).topLevel).toBe('value');
    });

    it('should preserve all types with passthrough', () => {
      const schema = z.object({
        id: z.number()
      });

      const validator = engine.compile(schema, { mode: 'passthrough', coerce: true });

      const input = {
        id: '42',
        string: 'text',
        number: 123,
        boolean: true,
        null: null,
        array: [1, 2, 3],
        object: { key: 'value' },
        date: new Date('2024-01-01'),
        buffer: Buffer.from('data')
      };

      const result = validator.validate(input);

      expect(result.id).toBe(42); // Coerced
      expect((result as any).string).toBe('text');
      expect((result as any).number).toBe(123);
      expect((result as any).boolean).toBe(true);
      expect((result as any).null).toBeNull();
      expect((result as any).array).toEqual([1, 2, 3]);
      expect((result as any).object).toEqual({ key: 'value' });
      expect((result as any).date).toBeInstanceOf(Date);
      expect(Buffer.isBuffer((result as any).buffer)).toBe(true);
    });
  });

  describe('Nested objects with different modes', () => {
    it('should handle complex nested coercion', () => {
      const schema = z.object({
        user: z.object({
          id: z.number(),
          profile: z.object({
            age: z.number(),
            verified: z.boolean()
          })
        }),
        settings: z.object({
          count: z.number(),
          enabled: z.boolean()
        })
      });

      const validator = engine.compile(schema, { mode: 'strip', coerce: true });

      const input = {
        user: {
          id: '1',
          profile: {
            age: '25',
            verified: '1',
            extra1: 'strip'
          },
          extra2: 'strip'
        },
        settings: {
          count: '10',
          enabled: 'true',
          extra3: 'strip'
        },
        extra4: 'strip'
      };

      const result = validator.validate(input);

      // All numbers should be coerced
      expect(result.user.id).toBe(1);
      expect(result.user.profile.age).toBe(25);
      expect(result.settings.count).toBe(10);

      // All booleans should be coerced
      expect(result.user.profile.verified).toBe(true);
      expect(result.settings.enabled).toBe(true);

      // All extra fields should be stripped
      expect((result.user.profile as any).extra1).toBeUndefined();
      expect((result.user as any).extra2).toBeUndefined();
      expect((result.settings as any).extra3).toBeUndefined();
      expect((result as any).extra4).toBeUndefined();
    });

    it('should coerce arrays of objects (with explicit z.coerce)', () => {
      // NOTE: Due to Zod v4 internal limitation, coercion inside arrays requires
      // explicit z.coerce.* in the schema. The engine's coerce option doesn't
      // apply to array elements to avoid Zod v4 compilation errors.
      //
      // IMPORTANT: Zod's z.coerce.boolean() treats any non-empty string as true,
      // so use '0'/'1' or boolean values, not 'true'/'false' strings.
      const schema = z.object({
        items: z.array(z.object({
          id: z.coerce.number(),  // Explicit coerce required for arrays
          active: z.coerce.boolean()
        }))
      });

      const validator = engine.compile(schema, { mode: 'strip' }); // coerce:true not needed here

      const input = {
        items: [
          { id: '1', active: 1, extra: 'strip' },      // Use number: 1 = true
          { id: '2', active: 0, extra: 'strip' },      // Use number: 0 = false
          { id: '3', active: true, extra: 'strip' }    // Or actual boolean
        ],
        topExtra: 'strip'
      };

      const result = validator.validate(input);

      expect(result.items).toHaveLength(3);
      expect(result.items[0]?.id).toBe(1);
      expect(result.items[0]?.active).toBe(true);
      expect((result.items[0] as any).extra).toBeUndefined();

      expect(result.items[1]?.id).toBe(2);
      expect(result.items[1]?.active).toBe(false);

      expect(result.items[2]?.id).toBe(3);
      expect(result.items[2]?.active).toBe(true);

      expect((result as any).topExtra).toBeUndefined();
    });

    it('should handle deeply nested coercion with mixed modes', () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              value: z.number(),
              flag: z.boolean()
            })
          })
        })
      });

      // Strip mode - should remove all extra fields at all levels
      const stripValidator = engine.compile(schema, { mode: 'strip', coerce: true });

      const input = {
        level1: {
          level2: {
            level3: {
              value: '100',
              flag: 'true',
              extra3: 'strip'
            },
            extra2: 'strip'
          },
          extra1: 'strip'
        },
        extra0: 'strip'
      };

      const result = stripValidator.validate(input);

      expect(result.level1.level2.level3.value).toBe(100);
      expect(result.level1.level2.level3.flag).toBe(true);
      expect((result.level1.level2.level3 as any).extra3).toBeUndefined();
      expect((result.level1.level2 as any).extra2).toBeUndefined();
      expect((result.level1 as any).extra1).toBeUndefined();
      expect((result as any).extra0).toBeUndefined();
    });
  });

  describe('Invalid coercion handling', () => {
    it('should fail when coercion is not possible', () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean()
      });

      const validator = engine.compile(schema, { coerce: true });

      // Invalid number coercion
      expect(() => validator.validate({
        age: 'not-a-number',
        active: 'true'
      })).toThrow();

      // Invalid boolean coercion
      expect(() => validator.validate({
        age: '25',
        active: 'not-a-boolean'
      })).toThrow();
    });

    it('should handle edge cases in coercion', () => {
      const schema = z.object({
        number: z.number(),
        boolean: z.boolean()
      });

      const validator = engine.compile(schema, { coerce: true });

      // Valid edge cases
      expect(validator.validate({
        number: '0',
        boolean: 'false'
      })).toEqual({
        number: 0,
        boolean: false
      });

      expect(validator.validate({
        number: '-123.456',
        boolean: '0'
      })).toEqual({
        number: -123.456,
        boolean: false
      });

      // Empty string number coercion should fail
      expect(() => validator.validate({
        number: '',
        boolean: 'true'
      })).toThrow();
    });

    it('should handle coercion with validation constraints', () => {
      const schema = z.object({
        age: z.number().int().min(0).max(150),
        score: z.number().positive()
      });

      const validator = engine.compile(schema, { coerce: true });

      // Valid after coercion
      expect(validator.validate({
        age: '25',
        score: '100.5'
      })).toEqual({
        age: 25,
        score: 100.5
      });

      // Invalid after coercion - not an integer
      expect(() => validator.validate({
        age: '25.5',
        score: '100'
      })).toThrow();

      // Invalid after coercion - out of range
      expect(() => validator.validate({
        age: '200',
        score: '100'
      })).toThrow();

      // Invalid after coercion - not positive
      expect(() => validator.validate({
        age: '25',
        score: '-100'
      })).toThrow();
    });

    it('should handle date coercion', () => {
      const schema = z.object({
        timestamp: z.date()
      });

      const validator = engine.compile(schema, { coerce: true });

      // Valid date string
      const result1 = validator.validate({
        timestamp: '2024-01-01T00:00:00.000Z'
      });
      expect(result1.timestamp).toBeInstanceOf(Date);
      expect(result1.timestamp.getFullYear()).toBe(2024);

      // Valid timestamp number
      const result2 = validator.validate({
        timestamp: 1704067200000
      });
      expect(result2.timestamp).toBeInstanceOf(Date);

      // Invalid date
      expect(() => validator.validate({
        timestamp: 'invalid-date'
      })).toThrow();
    });
  });

  describe('Coercion with defaults', () => {
    it('should apply defaults before coercion', () => {
      const schema = z.object({
        count: z.number().default(0),
        enabled: z.boolean().default(false)
      });

      const validator = engine.compile(schema, { coerce: true });

      // Without values - should use defaults
      const result1 = validator.validate({});
      expect(result1.count).toBe(0);
      expect(result1.enabled).toBe(false);

      // With values - should coerce
      const result2 = validator.validate({
        count: '42',
        enabled: 'true'
      });
      expect(result2.count).toBe(42);
      expect(result2.enabled).toBe(true);
    });

    it('should apply defaults with strip mode', () => {
      const schema = z.object({
        required: z.string(),
        optional: z.number().default(100),
        flag: z.boolean().default(true)
      });

      const validator = engine.compile(schema, { mode: 'strip', coerce: true });

      const input = {
        required: 'value',
        extra: 'strip this'
      };

      const result = validator.validate(input);

      expect(result.required).toBe('value');
      expect(result.optional).toBe(100);
      expect(result.flag).toBe(true);
      expect((result as any).extra).toBeUndefined();
    });
  });

  describe('Async validation with coercion', () => {
    it('should coerce types in async validation', async () => {
      const schema = z.object({
        age: z.number(),
        active: z.boolean()
      });

      const validator = engine.compile(schema, { coerce: true });

      const input = {
        age: '30',
        active: 'true'
      };

      const result = await validator.validateAsync(input);

      expect(result.age).toBe(30);
      expect(result.active).toBe(true);
    });

    it('should coerce with async refinements', async () => {
      const schema = z.object({
        id: z.number(),
        email: z.string().email().refine(
          async (val) => {
            await new Promise(resolve => setTimeout(resolve, 10));
            return !val.endsWith('@blocked.com');
          },
          { message: 'Email domain is blocked' }
        )
      });

      const validator = engine.compile(schema, { coerce: true });

      // Valid
      const result = await validator.validateAsync({
        id: '123',
        email: 'test@example.com'
      });
      expect(result.id).toBe(123);
      expect(result.email).toBe('test@example.com');

      // Invalid - blocked domain
      await expect(validator.validateAsync({
        id: '123',
        email: 'test@blocked.com'
      })).rejects.toThrow();
    });
  });

  describe('Performance with coercion', () => {
    it('should cache coerced validators', () => {
      const schema = z.object({
        value: z.number()
      });

      const validator1 = engine.compile(schema, { coerce: true });
      const validator2 = engine.compile(schema, { coerce: true });

      // Should return same cached instance
      expect(validator1).toBe(validator2);
    });

    it('should handle large datasets with coercion efficiently (explicit z.coerce)', () => {
      // NOTE: Using explicit z.coerce for array elements due to Zod v4 limitation
      const schema = z.object({
        items: z.array(z.object({
          id: z.coerce.number(),
          value: z.coerce.number(),
          flag: z.coerce.boolean()
        }))
      });

      const validator = engine.compile(schema);

      const input = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: String(i),
          value: String(i * 2),
          flag: i % 2 === 0 ? 'true' : 'false'
        }))
      };

      const startTime = Date.now();
      const result = validator.validate(input);
      const duration = Date.now() - startTime;

      // Should complete quickly (< 100ms for 1000 items)
      expect(duration).toBeLessThan(100);

      // Verify coercion worked
      expect(result.items).toHaveLength(1000);
      expect(result.items[0]?.id).toBe(0);
      expect(typeof result.items[0]?.id).toBe('number');
      expect(result.items[0]?.flag).toBe(true);
      expect(typeof result.items[0]?.flag).toBe('boolean');
    });
  });
});
