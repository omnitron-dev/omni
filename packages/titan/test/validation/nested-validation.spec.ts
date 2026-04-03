/**
 * Comprehensive tests for nested and complex validation scenarios
 */

import { z } from 'zod';
import { ValidationEngine, ValidationError } from '../../src/validation/validation-engine.js';

describe('Nested and Complex Validation', () => {
  let engine: ValidationEngine;

  beforeEach(() => {
    engine = new ValidationEngine();
  });

  describe('deeply nested objects', () => {
    it('should validate 5-level deep nesting', () => {
      const schema = z.object({
        level1: z.object({
          level2: z.object({
            level3: z.object({
              level4: z.object({
                level5: z.object({
                  value: z.string(),
                }),
              }),
            }),
          }),
        }),
      });

      const validator = engine.compile(schema);

      const validData = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  value: 'deep',
                },
              },
            },
          },
        },
      };

      const result = validator.validate(validData);
      expect(result.level1.level2.level3.level4.level5.value).toBe('deep');
    });

    it('should validate nested objects with arrays', () => {
      const schema = z.object({
        users: z.array(
          z.object({
            id: z.string(),
            profile: z.object({
              name: z.string(),
              contacts: z.array(
                z.object({
                  type: z.enum(['email', 'phone']),
                  value: z.string(),
                })
              ),
            }),
          })
        ),
      });

      const validator = engine.compile(schema);

      const validData = {
        users: [
          {
            id: '1',
            profile: {
              name: 'John',
              contacts: [
                { type: 'email', value: 'john@example.com' },
                { type: 'phone', value: '123-456-7890' },
              ],
            },
          },
          {
            id: '2',
            profile: {
              name: 'Jane',
              contacts: [{ type: 'email', value: 'jane@example.com' }],
            },
          },
        ],
      };

      const result = validator.validate(validData);
      expect(result.users).toHaveLength(2);
      expect(result.users[0].profile.contacts).toHaveLength(2);
    });

    it('should handle nested optional fields', () => {
      const schema = z.object({
        user: z
          .object({
            profile: z
              .object({
                bio: z.string().optional(),
                website: z.string().url().optional(),
              })
              .optional(),
          })
          .optional(),
      });

      const validator = engine.compile(schema);

      // All optional fields present
      const result1 = validator.validate({
        user: {
          profile: {
            bio: 'Hello',
            website: 'https://example.com',
          },
        },
      });
      expect(result1.user?.profile?.bio).toBe('Hello');

      // No optional fields
      const result2 = validator.validate({});
      expect(result2.user).toBeUndefined();

      // Partial optional fields
      const result3 = validator.validate({
        user: {
          profile: {},
        },
      });
      expect(result3.user?.profile).toBeDefined();
      expect(result3.user?.profile?.bio).toBeUndefined();
    });
  });

  describe('arrays with complex elements', () => {
    it('should validate arrays of unions', () => {
      const schema = z.object({
        items: z.array(
          z.union([
            z.object({ type: z.literal('text'), content: z.string() }),
            z.object({ type: z.literal('number'), value: z.number() }),
            z.object({ type: z.literal('boolean'), flag: z.boolean() }),
          ])
        ),
      });

      const validator = engine.compile(schema);

      const validData = {
        items: [
          { type: 'text', content: 'Hello' },
          { type: 'number', value: 42 },
          { type: 'boolean', flag: true },
          { type: 'text', content: 'World' },
        ],
      };

      const result = validator.validate(validData);
      expect(result.items).toHaveLength(4);
      expect(result.items[0].type).toBe('text');
      expect(result.items[1].type).toBe('number');
    });

    it('should validate arrays with refinements', () => {
      const schema = z.object({
        tags: z
          .array(z.string().min(2).max(20))
          .min(1)
          .max(10)
          .refine((arr) => new Set(arr).size === arr.length, {
            message: 'Tags must be unique',
          }),
      });

      const validator = engine.compile(schema);

      // Valid: unique tags
      const validData = {
        tags: ['javascript', 'typescript', 'nodejs'],
      };
      const result = validator.validate(validData);
      expect(result.tags).toHaveLength(3);

      // Invalid: duplicate tags
      try {
        validator.validate({
          tags: ['javascript', 'typescript', 'javascript'],
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        const validationError = error as ValidationError;
        const json = validationError.toJSON();
        expect(json.errors.some((e: any) => e.message.includes('unique'))).toBe(true);
      }
    });

    it('should handle empty arrays with constraints', () => {
      const schema = z.object({
        required: z.array(z.string()).min(1),
        optional: z.array(z.string()).optional(),
        empty: z.array(z.string()),
      });

      const validator = engine.compile(schema);

      // Valid
      const result = validator.validate({
        required: ['item'],
        optional: [],
        empty: [],
      });
      expect(result.required).toHaveLength(1);
      expect(result.empty).toHaveLength(0);

      // Invalid: required array is empty
      try {
        validator.validate({
          required: [],
          optional: [],
          empty: [],
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
    });
  });

  describe('recursive schemas', () => {
    it('should validate tree structures', () => {
      type TreeNode = {
        value: string;
        children?: TreeNode[];
      };

      const treeSchema: z.ZodType<TreeNode> = z.lazy(() =>
        z.object({
          value: z.string(),
          children: z.array(treeSchema).optional(),
        })
      );

      const validator = engine.compile(treeSchema);

      const treeData = {
        value: 'root',
        children: [
          {
            value: 'child1',
            children: [{ value: 'grandchild1' }, { value: 'grandchild2' }],
          },
          {
            value: 'child2',
          },
        ],
      };

      const result = validator.validate(treeData);
      expect(result.value).toBe('root');
      expect(result.children).toHaveLength(2);
      expect(result.children![0].children).toHaveLength(2);
    });

    it('should validate linked list structures', () => {
      type LinkedListNode = {
        value: number;
        next?: LinkedListNode;
      };

      const listSchema: z.ZodType<LinkedListNode> = z.lazy(() =>
        z.object({
          value: z.number(),
          next: listSchema.optional(),
        })
      );

      const validator = engine.compile(listSchema);

      const listData = {
        value: 1,
        next: {
          value: 2,
          next: {
            value: 3,
          },
        },
      };

      const result = validator.validate(listData);
      expect(result.value).toBe(1);
      expect(result.next?.value).toBe(2);
      expect(result.next?.next?.value).toBe(3);
    });
  });

  describe('discriminated unions', () => {
    it('should validate complex discriminated unions', () => {
      const schema = z.object({
        events: z.array(
          z.discriminatedUnion('type', [
            z.object({
              type: z.literal('user.created'),
              userId: z.string().uuid(),
              data: z.object({
                email: z.string().email(),
                name: z.string(),
              }),
            }),
            z.object({
              type: z.literal('user.updated'),
              userId: z.string().uuid(),
              changes: z.record(z.string(), z.any()),
            }),
            z.object({
              type: z.literal('user.deleted'),
              userId: z.string().uuid(),
              reason: z.string().optional(),
            }),
          ])
        ),
      });

      const validator = engine.compile(schema);

      const validData = {
        events: [
          {
            type: 'user.created',
            userId: '123e4567-e89b-12d3-a456-426614174000',
            data: { email: 'user@example.com', name: 'Test User' },
          },
          {
            type: 'user.updated',
            userId: '123e4567-e89b-12d3-a456-426614174001',
            changes: { name: 'New Name' },
          },
          {
            type: 'user.deleted',
            userId: '123e4567-e89b-12d3-a456-426614174002',
            reason: 'User request',
          },
        ],
      };

      const result = validator.validate(validData);
      expect(result.events).toHaveLength(3);
      expect(result.events[0].type).toBe('user.created');
    });
  });

  describe('tuple validation', () => {
    it('should validate tuples with different types', () => {
      const schema = z.object({
        coordinates: z.tuple([z.number(), z.number()]),
        rgb: z.tuple([z.number().min(0).max(255), z.number().min(0).max(255), z.number().min(0).max(255)]),
        mixed: z.tuple([z.string(), z.number(), z.boolean(), z.object({ key: z.string() })]),
      });

      const validator = engine.compile(schema);

      const validData = {
        coordinates: [10.5, 20.3],
        rgb: [255, 128, 0],
        mixed: ['test', 42, true, { key: 'value' }],
      };

      const result = validator.validate(validData);
      expect(result.coordinates).toEqual([10.5, 20.3]);
      expect(result.rgb).toEqual([255, 128, 0]);
      expect(result.mixed).toHaveLength(4);
    });

    it('should reject tuples with wrong types', () => {
      const schema = z.object({
        coordinates: z.tuple([z.number(), z.number()]),
      });

      const validator = engine.compile(schema);

      try {
        validator.validate({
          coordinates: ['10', '20'], // strings instead of numbers
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
    });
  });

  describe('record validation', () => {
    it('should validate records with different value types', () => {
      const schema = z.object({
        stringRecord: z.record(z.string(), z.string()),
        numberRecord: z.record(z.string(), z.number()),
        objectRecord: z.record(
          z.string(),
          z.object({
            id: z.string(),
            value: z.number(),
          })
        ),
      });

      const validator = engine.compile(schema);

      const validData = {
        stringRecord: { key1: 'value1', key2: 'value2' },
        numberRecord: { count: 10, total: 100 },
        objectRecord: {
          item1: { id: '1', value: 10 },
          item2: { id: '2', value: 20 },
        },
      };

      const result = validator.validate(validData);
      expect(result.stringRecord.key1).toBe('value1');
      expect(result.numberRecord.count).toBe(10);
      expect(result.objectRecord.item1.id).toBe('1');
    });

    it('should validate records with key constraints', () => {
      const schema = z.object({
        metadata: z.record(z.string().regex(/^[a-z_]+$/), z.any()),
      });

      const validator = engine.compile(schema);

      // Valid keys
      const validData = {
        metadata: {
          user_id: '123',
          created_at: Date.now(),
          is_active: true,
        },
      };

      const result = validator.validate(validData);
      expect(result.metadata.user_id).toBe('123');

      // Invalid keys (uppercase)
      try {
        validator.validate({
          metadata: {
            UserId: '123',
          },
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
    });
  });

  describe('intersection validation', () => {
    it('should validate intersections of objects', () => {
      const baseSchema = z.object({
        id: z.string(),
        createdAt: z.string().datetime(),
      });

      const userSchema = z.object({
        email: z.string().email(),
        name: z.string(),
      });

      const schema = z.intersection(baseSchema, userSchema);

      const validator = engine.compile(schema);

      const validData = {
        id: '123',
        createdAt: '2024-01-01T00:00:00.000Z',
        email: 'user@example.com',
        name: 'Test User',
      };

      const result = validator.validate(validData);
      expect(result.id).toBe('123');
      expect(result.email).toBe('user@example.com');
    });
  });

  describe('enum and literal validation', () => {
    it('should validate native enums', () => {
      enum Status {
        Active = 'ACTIVE',
        Inactive = 'INACTIVE',
        Pending = 'PENDING',
      }

      const schema = z.object({
        status: z.nativeEnum(Status),
      });

      const validator = engine.compile(schema);

      const result = validator.validate({ status: 'ACTIVE' });
      expect(result.status).toBe('ACTIVE');

      try {
        validator.validate({ status: 'INVALID' });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
    });

    it('should validate multiple literals', () => {
      const schema = z.object({
        mode: z.union([z.literal('read'), z.literal('write'), z.literal('admin')]),
        flag: z.union([z.literal(1), z.literal(2), z.literal(3)]),
      });

      const validator = engine.compile(schema);

      const result = validator.validate({ mode: 'read', flag: 2 });
      expect(result.mode).toBe('read');
      expect(result.flag).toBe(2);
    });
  });

  describe('transform and preprocess', () => {
    it('should validate with multiple transforms', () => {
      const schema = z.object({
        email: z.preprocess(
          (val) => (typeof val === 'string' ? val.trim() : val),
          z
            .string()
            .email()
            .transform((s) => s.toLowerCase())
        ),
        tags: z
          .array(z.string())
          .transform((arr) => arr.map((s) => s.toLowerCase()))
          .transform((arr) => [...new Set(arr)]), // deduplicate
      });

      const validator = engine.compile(schema);

      const result = validator.validate({
        email: '  TEST@EXAMPLE.COM  ',
        tags: ['JavaScript', 'TypeScript', 'javascript', 'nodejs'],
      });

      expect(result.email).toBe('test@example.com');
      expect(result.tags).toEqual(['javascript', 'typescript', 'nodejs']);
    });

    it('should validate with preprocess', () => {
      const schema = z.object({
        timestamp: z.preprocess((arg) => {
          if (typeof arg === 'string') {
            return new Date(arg);
          }
          return arg;
        }, z.date()),
      });

      const validator = engine.compile(schema);

      const result = validator.validate({
        timestamp: '2024-01-01T00:00:00.000Z',
      });

      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('default values in nested structures', () => {
    it('should apply defaults in nested objects', () => {
      const schema = z.object({
        user: z.object({
          name: z.string(),
          preferences: z
            .object({
              theme: z.enum(['light', 'dark']).default('light'),
              notifications: z.boolean().default(true),
              language: z.string().default('en'),
            })
            .default({
              theme: 'light' as const,
              notifications: true,
              language: 'en',
            }),
        }),
      });

      const validator = engine.compile(schema);

      const result = validator.validate({
        user: {
          name: 'Test User',
        },
      });

      expect(result.user.preferences.theme).toBe('light');
      expect(result.user.preferences.notifications).toBe(true);
      expect(result.user.preferences.language).toBe('en');
    });

    it('should apply defaults in arrays', () => {
      const schema = z.object({
        items: z
          .array(
            z.object({
              id: z.string(),
              priority: z.number().default(0),
              status: z.enum(['pending', 'done']).default('pending'),
            })
          )
          .default([]),
      });

      const validator = engine.compile(schema);

      const result = validator.validate({
        items: [{ id: '1' }, { id: '2', priority: 5 }],
      });

      expect(result.items).toHaveLength(2);
      expect(result.items[0].priority).toBe(0);
      expect(result.items[0].status).toBe('pending');
      expect(result.items[1].priority).toBe(5);
    });
  });

  describe('nullable and nullish', () => {
    it('should handle nullable nested objects', () => {
      const schema = z.object({
        user: z
          .object({
            profile: z
              .object({
                bio: z.string(),
                avatar: z.string().url().nullable(),
              })
              .nullable(),
          })
          .nullable(),
      });

      const validator = engine.compile(schema);

      // All present
      const result1 = validator.validate({
        user: {
          profile: {
            bio: 'Hello',
            avatar: 'https://example.com/avatar.jpg',
          },
        },
      });
      expect(result1.user?.profile?.avatar).toBe('https://example.com/avatar.jpg');

      // Avatar null
      const result2 = validator.validate({
        user: {
          profile: {
            bio: 'Hello',
            avatar: null,
          },
        },
      });
      expect(result2.user?.profile?.avatar).toBeNull();

      // Profile null
      const result3 = validator.validate({
        user: {
          profile: null,
        },
      });
      expect(result3.user?.profile).toBeNull();

      // User null
      const result4 = validator.validate({
        user: null,
      });
      expect(result4.user).toBeNull();
    });
  });
});
