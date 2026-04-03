/**
 * Integration tests for the complete validation system
 */

import 'reflect-metadata';
import { z } from 'zod';
import { ValidationEngine, ValidationError } from '../../src/validation/validation-engine.js';
import { ValidationMiddleware } from '../../src/validation/validation-middleware.js';
import { contract, Contracts } from '../../src/validation/contract.js';

describe('Validation System Integration', () => {
  let engine: ValidationEngine;
  let middleware: ValidationMiddleware;

  beforeEach(() => {
    engine = new ValidationEngine();
    middleware = new ValidationMiddleware(engine);
  });

  describe('end-to-end user service', () => {
    it('should validate complete user service workflow', async () => {
      // Define schemas
      const UserSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        name: z.string().min(2).max(100),
        age: z.number().int().min(18).max(120),
        roles: z.array(z.enum(['user', 'admin', 'moderator'])),
        createdAt: z.string().datetime(),
      });

      // Create service contract
      const UserServiceContract = contract({
        createUser: {
          input: z.object({
            email: z.string().email(),
            name: z.string().min(2),
            password: z.string().min(8),
            age: z.number().int().min(18),
          }),
          output: UserSchema,
          options: {
            mode: 'strip',
          },
        },
        getUser: {
          input: z.string().uuid(),
          output: UserSchema.nullable(),
        },
        updateUser: {
          input: z.object({
            id: z.string().uuid(),
            updates: UserSchema.partial().omit({ id: true, createdAt: true }),
          }),
          output: UserSchema,
        },
        deleteUser: {
          input: z.string().uuid(),
          output: z.boolean(),
        },
      });

      // Implement service
      class UserService {
        private users = new Map<string, any>();

        async createUser(input: any) {
          const user = {
            id: crypto.randomUUID(),
            email: input.email,
            name: input.name,
            age: input.age,
            roles: ['user'],
            createdAt: new Date().toISOString(),
          };
          this.users.set(user.id, user);
          return user;
        }

        async getUser(id: string) {
          return this.users.get(id) || null;
        }

        async updateUser(input: any) {
          const user = this.users.get(input.id);
          if (!user) throw new Error('User not found');
          const updated = { ...user, ...input.updates };
          this.users.set(input.id, updated);
          return updated;
        }

        async deleteUser(id: string) {
          return this.users.delete(id);
        }
      }

      const service = new UserService();
      const wrappedService = middleware.wrapService(service, UserServiceContract);

      // Test create
      const createdUser = await wrappedService.createUser({
        email: 'test@example.com',
        name: 'Test User',
        password: 'SecurePass123',
        age: 25,
      });

      expect(createdUser.id).toBeDefined();
      expect(createdUser.email).toBe('test@example.com');
      expect(createdUser.roles).toEqual(['user']);

      // Test get
      const fetchedUser = await wrappedService.getUser(createdUser.id);
      expect(fetchedUser).toEqual(createdUser);

      // Test update
      const updatedUser = await wrappedService.updateUser({
        id: createdUser.id,
        updates: {
          name: 'Updated Name',
          age: 26,
        },
      });
      expect(updatedUser.name).toBe('Updated Name');
      expect(updatedUser.age).toBe(26);

      // Test delete
      const deleted = await wrappedService.deleteUser(createdUser.id);
      expect(deleted).toBe(true);

      const notFound = await wrappedService.getUser(createdUser.id);
      expect(notFound).toBeNull();
    });
  });

  describe('streaming data pipeline', () => {
    it('should validate streaming data transformation', async () => {
      const DataContract = contract({
        processStream: {
          input: z.object({
            filter: z.object({
              minValue: z.number().optional(),
              maxValue: z.number().optional(),
            }),
          }),
          output: z.object({
            id: z.string(),
            value: z.number(),
            processed: z.boolean(),
          }),
          stream: true,
        },
      });

      class DataProcessor {
        async *processStream(input: any) {
          const data = [
            { id: '1', value: 10, processed: false },
            { id: '2', value: 20, processed: false },
            { id: '3', value: 30, processed: false },
            { id: '4', value: 40, processed: false },
          ];

          for (const item of data) {
            const { minValue, maxValue } = input.filter;

            if (minValue !== undefined && item.value < minValue) continue;
            if (maxValue !== undefined && item.value > maxValue) continue;

            yield { ...item, processed: true };
          }
        }
      }

      const processor = new DataProcessor();
      const wrappedProcessor = middleware.wrapService(processor, DataContract);

      // Test filtering
      const results: any[] = [];
      for await (const item of wrappedProcessor.processStream({
        filter: { minValue: 15, maxValue: 35 },
      })) {
        results.push(item);
      }

      expect(results).toHaveLength(2);
      expect(results[0].value).toBe(20);
      expect(results[1].value).toBe(30);
      expect(results.every((r) => r.processed)).toBe(true);
    });
  });

  describe('error handling integration', () => {
    it('should handle validation errors at different stages', async () => {
      const ServiceContract = contract({
        process: {
          input: z.object({
            step1: z.string().email(),
            step2: z.number().positive(),
            step3: z.array(z.string()).min(1),
          }),
          output: z.object({
            result: z.string(),
            status: z.enum(['success', 'partial', 'failed']),
          }),
        },
      });

      class ProcessingService {
        async process(input: any) {
          return {
            result: `Processed: ${input.step1}`,
            status: 'success' as const,
          };
        }
      }

      const service = new ProcessingService();
      const wrappedService = middleware.wrapService(service, ServiceContract);

      // Valid input
      const result = await wrappedService.process({
        step1: 'test@example.com',
        step2: 42,
        step3: ['item1', 'item2'],
      });
      expect(result.status).toBe('success');

      // Invalid step1 (email)
      try {
        await wrappedService.process({
          step1: 'not-an-email',
          step2: 42,
          step3: ['item1'],
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }

      // Invalid step2 (not positive)
      try {
        await wrappedService.process({
          step1: 'test@example.com',
          step2: -1,
          step3: ['item1'],
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }

      // Invalid step3 (empty array)
      try {
        await wrappedService.process({
          step1: 'test@example.com',
          step2: 42,
          step3: [],
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }
    });
  });

  describe('CRUD contract integration', () => {
    it('should work with CRUD contract template', async () => {
      const ProductSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
        price: z.number().positive(),
        stock: z.number().int().min(0),
      });

      const ProductContract = Contracts.crud(ProductSchema);

      class ProductService {
        private products = new Map<string, any>();

        async create(input: any) {
          const product = { ...input, id: crypto.randomUUID() };
          this.products.set(product.id, product);
          return product;
        }

        async read(id: string) {
          return this.products.get(id) || null;
        }

        async update(input: any) {
          const existing = this.products.get(input.id);
          if (!existing) return null;
          const updated = { ...existing, ...input.data };
          this.products.set(input.id, updated);
          return updated;
        }

        async delete(id: string) {
          return this.products.delete(id);
        }

        async list(input: any) {
          const items = Array.from(this.products.values());
          const { offset = 0, limit = 20 } = input;
          return {
            items: items.slice(offset, offset + limit),
            total: items.length,
            offset,
            limit,
          };
        }
      }

      const service = new ProductService();
      const wrappedService = middleware.wrapService(service, ProductContract);

      // Create
      const product = await wrappedService.create({
        id: crypto.randomUUID(),
        name: 'Test Product',
        price: 29.99,
        stock: 100,
      });

      expect(product.id).toBeDefined();

      // Read
      const fetched = await wrappedService.read(product.id);
      expect(fetched).toEqual(product);

      // Update
      const updated = await wrappedService.update({
        id: product.id,
        data: { price: 39.99 },
      });
      expect(updated.price).toBe(39.99);

      // List
      const list = await wrappedService.list({ offset: 0, limit: 10 });
      expect(list.items).toHaveLength(1);
      expect(list.total).toBe(1);

      // Delete
      const deleted = await wrappedService.delete(product.id);
      expect(deleted).toBe(true);
    });
  });

  describe('coercion integration', () => {
    it('should coerce types throughout the pipeline', async () => {
      const FormContract = contract({
        submitForm: {
          input: z.object({
            name: z.string(),
            age: z.number().int().min(18),
            active: z.boolean(),
            score: z.number(),
            timestamp: z.date(),
          }),
          output: z.object({
            success: z.boolean(),
            data: z.object({
              name: z.string(),
              age: z.number(),
              active: z.boolean(),
              score: z.number(),
              timestamp: z.date(),
            }),
          }),
          options: {
            coerce: true,
          },
        },
      });

      class FormService {
        async submitForm(input: any) {
          return {
            success: true,
            data: input,
          };
        }
      }

      const service = new FormService();
      const wrappedService = middleware.wrapService(service, FormContract);

      // Submit with string values (should be coerced)
      const result = await wrappedService.submitForm({
        name: 'John Doe',
        age: '25',
        active: 'true',
        score: '95.5',
        timestamp: '2024-01-01T00:00:00.000Z',
      });

      expect(result.success).toBe(true);
      expect(result.data.age).toBe(25);
      expect(typeof result.data.age).toBe('number');
      expect(result.data.active).toBe(true);
      expect(typeof result.data.active).toBe('boolean');
      expect(result.data.score).toBe(95.5);
      expect(result.data.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('validation options integration', () => {
    it('should respect different validation modes', async () => {
      const BaseSchema = z.object({
        required: z.string(),
      });

      // Strip mode
      const stripService = {
        async process(input: any) {
          return input;
        },
      };
      const stripContract = contract({
        process: {
          input: BaseSchema,
          output: BaseSchema,
          options: { mode: 'strip' },
        },
      });
      const wrappedStrip = middleware.wrapService(stripService, stripContract);

      const stripResult = await wrappedStrip.process({
        required: 'value',
        extra: 'removed',
      });
      expect(stripResult.required).toBe('value');
      expect((stripResult as any).extra).toBeUndefined();

      // Strict mode
      const strictService = {
        async process(input: any) {
          return input;
        },
      };
      const strictContract = contract({
        process: {
          input: BaseSchema,
          output: BaseSchema,
          options: { mode: 'strict' },
        },
      });
      const wrappedStrict = middleware.wrapService(strictService, strictContract);

      try {
        await wrappedStrict.process({
          required: 'value',
          extra: 'not-allowed',
        });
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
      }

      // Passthrough mode
      const passthroughService = {
        async process(input: any) {
          return input;
        },
      };
      const passthroughContract = contract({
        process: {
          input: BaseSchema,
          output: BaseSchema,
          options: { mode: 'passthrough' },
        },
      });
      const wrappedPassthrough = middleware.wrapService(passthroughService, passthroughContract);

      const passthroughResult = await wrappedPassthrough.process({
        required: 'value',
        extra: 'kept',
      });
      expect(passthroughResult.required).toBe('value');
      expect((passthroughResult as any).extra).toBe('kept');
    });
  });

  describe('cache effectiveness', () => {
    it('should reuse compiled validators across calls', async () => {
      const schema = z.object({
        value: z.number(),
      });

      const ServiceContract = contract({
        process: {
          input: schema,
          output: schema,
        },
      });

      const service = {
        async process(input: any) {
          return input;
        },
      };

      const wrappedService = middleware.wrapService(service, ServiceContract);

      const initialCacheSize = engine.getCacheSize();

      // Make multiple calls
      for (let i = 0; i < 100; i++) {
        await wrappedService.process({ value: i });
      }

      const finalCacheSize = engine.getCacheSize();

      // Cache size should not grow significantly
      expect(finalCacheSize - initialCacheSize).toBeLessThan(5);
    });
  });
});
