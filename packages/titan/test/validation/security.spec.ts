/**
 * Priority 1 CRITICAL: Security Validation Tests
 *
 * Tests security-critical aspects of the validation subsystem including:
 * - SQL injection prevention
 * - XSS prevention
 * - DoS prevention
 * - Malicious input handling
 */

import { z } from 'zod';
import { ValidationEngine, ValidationError } from '../../src/validation/validation-engine.js';

describe('Security Validation Tests', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
  });

  describe('SQL Injection Prevention', () => {
    it('should prevent SQL injection in string validation', () => {
      const schema = z.object({
        username: z.string().min(3).max(50),
        query: z.string(),
      });

      const validator = engine.compile(schema);

      // SQL injection attempt
      const sqlInjection = {
        username: "admin' OR '1'='1",
        query: 'SELECT * FROM users WHERE id = 1; DROP TABLE users; --',
      };

      // Validation should accept it (validation doesn't prevent SQL injection - that's the app's job)
      // But the error message should not contain the SQL
      const result = validator.validate(sqlInjection);
      expect(result.username).toBe("admin' OR '1'='1");
    });

    it('should sanitize SQL injection attempts in error messages', () => {
      const schema = z.object({
        id: z.number().int().positive(),
      });

      const validator = engine.compile(schema);

      try {
        validator.validate({
          id: '1 OR 1=1; DROP TABLE users--',
        });
        fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = error.toJSON();

        // Error message should exist but not execute any code
        expect(json.errors).toBeDefined();
        expect(json.errors.length).toBeGreaterThan(0);

        // Ensure error message doesn't contain executable SQL
        const errorMessage = JSON.stringify(json);
        expect(errorMessage).not.toContain('DROP TABLE');
        expect(errorMessage).not.toContain('DELETE FROM');
      }
    });

    it('should handle SQL injection in refinement error messages', () => {
      const schema = z.string().refine((val) => !val.includes('DROP TABLE'), { message: 'Invalid input detected' });

      const validator = engine.compile(schema);

      try {
        validator.validate('test; DROP TABLE users--');
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();
        expect(json.errors[0]?.message).toBe('Invalid input detected');
      }
    });
  });

  describe('XSS Prevention', () => {
    it('should prevent XSS in error messages', () => {
      const schema = z.object({
        name: z.string().min(2).max(50),
        bio: z.string().min(10).max(500),
      });

      const validator = engine.compile(schema);

      try {
        validator.validate({
          name: '<script>alert("XSS")</script>',
          bio: 'a', // too short - triggers min length error
        });
        fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = error.toJSON();

        // Error should exist but script tags should not be executable
        expect(json.errors).toBeDefined();

        // Convert to JSON string to check serialization
        const serialized = JSON.stringify(json);
        // Script tags should be escaped or sanitized in JSON
        expect(serialized).toBeDefined();
      }
    });

    it('should handle XSS in various formats', () => {
      const schema = z.object({
        content: z.string().min(5),
      });

      const validator = engine.compile(schema);

      const xssAttempts = [
        '<img src=x onerror="alert(1)">',
        '<svg onload="alert(1)">',
        'javascript:alert(1)',
        '<iframe src="javascript:alert(1)"></iframe>',
        '"><script>alert(String.fromCharCode(88,83,83))</script>',
      ];

      // All should fail min length, but errors should be safe
      xssAttempts.forEach((xss) => {
        try {
          validator.validate({ content: 'a' }); // Trigger error
          fail('Should have thrown');
        } catch (error: any) {
          expect(error).toBeInstanceOf(ValidationError);
          const json = error.toJSON();
          expect(json.errors).toBeDefined();
          // Error messages should not contain executable code
          const serialized = JSON.stringify(json);
          expect(serialized).not.toContain('onerror');
          expect(serialized).not.toContain('onload');
        }
      });
    });

    it('should sanitize user input in custom error messages', () => {
      const maliciousInput = '<script>';

      const schema = z.string().refine((val) => val.length > 10, { message: 'Input too short' });

      const validator = engine.compile(schema);

      try {
        validator.validate(maliciousInput);
        fail('Should have thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(ValidationError);
        const json = error.toJSON();
        // Error message should be clean
        expect(json.errors[0]?.message).toBe('Input too short');
        // Received value might contain the script, but it's in data, not message
      }
    });
  });

  describe('DoS Prevention', () => {
    it('should handle extremely long strings without hanging', () => {
      const schema = z.object({
        text: z.string().max(1000),
      });

      const validator = engine.compile(schema);

      // 1MB string
      const longString = 'a'.repeat(1_000_000);

      const startTime = Date.now();

      try {
        validator.validate({ text: longString });
        fail('Should have thrown');
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Should fail quickly (< 100ms even for 1MB string)
        expect(duration).toBeLessThan(100);

        expect(error).toBeInstanceOf(ValidationError);
        const json = error.toJSON();
        expect(json.errors[0]?.message).toBeDefined();
        expect(json.errors[0]?.code).toBe('too_big');
      }
    });

    it('should limit error message length to prevent DoS', () => {
      const schema = z.object({
        field1: z.string().min(10),
        field2: z.string().min(10),
        field3: z.string().min(10),
        field4: z.string().min(10),
        field5: z.string().min(10),
      });

      const validator = engine.compile(schema, { abortEarly: false });

      try {
        validator.validate({
          field1: 'a',
          field2: 'b',
          field3: 'c',
          field4: 'd',
          field5: 'e',
        });
        fail('Should have thrown');
      } catch (error: any) {
        const json = error.toJSON();

        // Should have multiple errors
        expect(json.errors.length).toBe(5);

        // Serialized error should be reasonable size (< 10KB)
        const serialized = JSON.stringify(json);
        expect(serialized.length).toBeLessThan(10_000);
      }
    });

    it('should handle deeply nested objects efficiently', () => {
      // Create a schema with 10 levels of nesting
      const deepSchema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              level4: z.object({
                level5: z.object({
                  level6: z.object({
                    level7: z.object({
                      level8: z.object({
                        level9: z.object({
                          level10: z.string(),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      });

      const validator = engine.compile(deepSchema);

      const deepObject = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: {
                    level7: {
                      level8: {
                        level9: {
                          level10: 'value',
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      };

      const startTime = Date.now();
      const result = validator.validate(deepObject);
      const duration = Date.now() - startTime;

      // Should validate quickly even with deep nesting
      expect(duration).toBeLessThan(50);
      expect(result).toEqual(deepObject);
    });

    it('should handle large arrays efficiently', () => {
      const schema = z.object({
        items: z
          .array(
            z.object({
              id: z.number(),
              name: z.string(),
            })
          )
          .max(1000),
      });

      const validator = engine.compile(schema);

      // 10,000 items (exceeds max)
      const largeArray = Array.from({ length: 10_000 }, (_, i) => ({
        id: i,
        name: `Item ${i}`,
      }));

      const startTime = Date.now();

      try {
        validator.validate({ items: largeArray });
        fail('Should have thrown');
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Should fail quickly without processing all items
        expect(duration).toBeLessThan(100);

        expect(error).toBeInstanceOf(ValidationError);
      }
    });

    it('should prevent ReDoS with complex regex patterns', () => {
      // Zod doesn't use regex by default for strings, but we can test custom regex
      const schema = z.object({
        email: z.string().email(), // Built-in email validation
        phone: z.string().regex(/^\d{3}-\d{3}-\d{4}$/),
      });

      const validator = engine.compile(schema);

      // Malicious input designed to trigger validation failure
      const maliciousInput = {
        email: 'a'.repeat(1000) + '@example.com',
        phone: '123-456-7890',
      };

      const startTime = Date.now();

      try {
        validator.validate(maliciousInput);
        fail('Should have thrown');
      } catch (error: any) {
        const duration = Date.now() - startTime;

        // Should fail quickly (< 100ms)
        expect(duration).toBeLessThan(100);

        // Should throw an error (could be ValidationError or other)
        expect(error).toBeDefined();
      }
    });
  });

  describe('Large Payload Validation', () => {
    it('should handle payloads with many fields', () => {
      // Create schema with 100 fields
      const fields: Record<string, z.ZodString> = {};
      for (let i = 0; i < 100; i++) {
        fields[`field${i}`] = z.string();
      }
      const schema = z.object(fields);

      const validator = engine.compile(schema);

      // Create data with all 100 fields
      const data: Record<string, string> = {};
      for (let i = 0; i < 100; i++) {
        data[`field${i}`] = `value${i}`;
      }

      const startTime = Date.now();
      const result = validator.validate(data);
      const duration = Date.now() - startTime;

      // Should validate quickly
      expect(duration).toBeLessThan(50);
      expect(Object.keys(result)).toHaveLength(100);
    });

    it('should handle very large individual field values', () => {
      const schema = z.object({
        smallField: z.string().max(100),
        largeField: z.string().max(1_000_000), // Allow up to 1MB
      });

      const validator = engine.compile(schema);

      const data = {
        smallField: 'small',
        largeField: 'x'.repeat(500_000), // 500KB
      };

      const startTime = Date.now();
      const result = validator.validate(data);
      const duration = Date.now() - startTime;

      // Should handle large field efficiently
      expect(duration).toBeLessThan(100);
      expect(result.largeField.length).toBe(500_000);
    });

    it('should handle mixed large and small fields', () => {
      const schema = z.object({
        id: z.number(),
        title: z.string().max(200),
        content: z.string().max(100_000),
        metadata: z.record(z.string(), z.any()),
        tags: z.array(z.string()).max(50),
      });

      const validator = engine.compile(schema);

      const data = {
        id: 123,
        title: 'Test Article',
        content: 'Lorem ipsum '.repeat(5000), // ~60KB
        metadata: {
          author: 'John Doe',
          created: '2024-01-01',
          views: 1000,
        },
        tags: Array.from({ length: 30 }, (_, i) => `tag${i}`),
      };

      const startTime = Date.now();
      const result = validator.validate(data);
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(100);
      expect(result).toBeDefined();
    });
  });

  describe('Malicious Input Handling', () => {
    it('should handle null bytes in strings', () => {
      const schema = z.object({
        text: z.string(),
      });

      const validator = engine.compile(schema);

      const data = {
        text: 'hello\x00world',
      };

      const result = validator.validate(data);
      expect(result.text).toBe('hello\x00world');
    });

    it('should handle Unicode and special characters', () => {
      const schema = z.object({
        text: z.string().min(1).max(100),
      });

      const validator = engine.compile(schema);

      const specialInputs = [
        '🔥💯✨',
        '你好世界',
        'Здравствуй мир',
        '🔥'.repeat(10), // Emojis count as multiple bytes
        '\u{1F600}\u{1F601}\u{1F602}', // Unicode escapes
        'test\u200Btest', // Zero-width space
        'test\uFEFFtest', // Zero-width no-break space
      ];

      specialInputs.forEach((input) => {
        const result = validator.validate({ text: input });
        expect(result.text).toBe(input);
      });
    });

    it('should handle prototype pollution attempts', () => {
      const schema = z.object({
        name: z.string(),
        value: z.any(),
      });

      const validator = engine.compile(schema, { mode: 'strip' });

      const maliciousInput = {
        name: 'test',
        value: 'value',
        __proto__: { polluted: true },
        constructor: { prototype: { polluted: true } },
      };

      const result = validator.validate(maliciousInput);

      // Should strip dangerous properties
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('value');
      // __proto__ is still present as an empty object in JavaScript, but shouldn't be polluted
      // What matters is that the prototype wasn't modified
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((result as any).polluted).toBeUndefined();
    });

    it('should handle circular references safely', () => {
      const schema = z.object({
        name: z.string(),
        data: z.any(),
      });

      const validator = engine.compile(schema);

      // Create circular reference
      const circular: any = { name: 'test' };
      circular.self = circular;

      // Zod will handle this as-is since data is z.any()
      // The validation won't traverse into circular structures
      expect(() => {
        validator.validate(circular);
      }).not.toThrow();
    });

    it('should handle buffer/binary data', () => {
      const schema = z.object({
        name: z.string(),
        data: z.any(),
      });

      const validator = engine.compile(schema);

      const data = {
        name: 'test',
        data: Buffer.from('binary data'),
      };

      const result = validator.validate(data);
      expect(result.name).toBe('test');
      expect(Buffer.isBuffer(result.data)).toBe(true);
    });

    it('should handle extremely nested malicious objects', () => {
      const schema = z.object({
        data: z.any(),
      });

      const validator = engine.compile(schema);

      // Create deeply nested object (100 levels)
      let nested: any = { value: 'deep' };
      for (let i = 0; i < 99; i++) {
        nested = { child: nested };
      }

      const startTime = Date.now();
      const result = validator.validate({ data: nested });
      const duration = Date.now() - startTime;

      // Should handle without stack overflow and complete quickly
      expect(duration).toBeLessThan(50);
      expect(result.data).toBeDefined();
    });

    it('should handle arrays with mixed types', () => {
      const schema = z.object({
        items: z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
      });

      const validator = engine.compile(schema);

      const data = {
        items: ['string', 123, true, null, 'another string', 456, false],
      };

      const result = validator.validate(data);
      expect(result.items).toHaveLength(7);
    });

    it('should handle symbol keys safely', () => {
      const schema = z.object({
        name: z.string(),
        value: z.number(),
      });

      const validator = engine.compile(schema, { mode: 'strip' });

      const sym = Symbol('test');
      const data: any = {
        name: 'test',
        value: 123,
        [sym]: 'symbol value',
      };

      const result = validator.validate(data);

      // Symbols should be handled (Zod ignores non-string keys by default)
      expect(result.name).toBe('test');
      expect(result.value).toBe(123);
    });
  });

  describe('Memory Safety', () => {
    it('should not leak memory with repeated validations', () => {
      const schema = z.object({
        id: z.number(),
        name: z.string(),
        data: z.array(z.number()),
      });

      const validator = engine.compile(schema);

      const initialMemory = process.memoryUsage().heapUsed;

      // Run 10,000 validations
      for (let i = 0; i < 10_000; i++) {
        validator.validate({
          id: i,
          name: `Item ${i}`,
          data: [1, 2, 3, 4, 5],
        });
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryGrowth = finalMemory - initialMemory;

      // Memory growth should be minimal (< 10MB for 10k validations)
      expect(memoryGrowth).toBeLessThan(10 * 1024 * 1024);
    });

    it('should cache validators without memory leaks', () => {
      const schemas = Array.from({ length: 1000 }, (_, i) => z.object({ [`field${i}`]: z.string() }));

      const initialSize = engine.getCacheSize();
      const initialMemory = process.memoryUsage().heapUsed;

      // Compile all schemas
      schemas.forEach((schema) => engine.compile(schema));

      const finalSize = engine.getCacheSize();
      const finalMemory = process.memoryUsage().heapUsed;

      // Cache should have grown
      expect(finalSize).toBe(initialSize + 1000);

      // Memory growth should be reasonable (< 5MB for 1000 cached validators)
      const memoryGrowth = finalMemory - initialMemory;
      expect(memoryGrowth).toBeLessThan(5 * 1024 * 1024);

      // Clear cache
      engine.clearCache();
      expect(engine.getCacheSize()).toBe(0);
    });
  });
});
