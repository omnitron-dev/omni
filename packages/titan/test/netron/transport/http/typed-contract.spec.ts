/**
 * Tests for Type-Safe Contract System
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  TypedContract,
  TypedHttpClient,
  createTypedContract,
  createTypedClient,
  QueryBuilder
} from '../../../../src/netron/transport/http/typed-contract.js';
import { z } from 'zod';
import { contract } from '../../../../src/validation/contract.js';

describe('TypedContract', () => {
  // Define test contract
  const userContract = {
    getUser: {
      input: z.object({
        id: z.string().uuid()
      }),
      output: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string().email()
      }),
      http: {
        method: 'GET' as const,
        path: '/users/:id'
      }
    },
    createUser: {
      input: z.object({
        name: z.string().min(1),
        email: z.string().email()
      }),
      output: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string()
      }),
      http: {
        method: 'POST' as const,
        path: '/users'
      }
    },
    listUsers: {
      input: z.object({
        page: z.number().optional(),
        limit: z.number().optional()
      }),
      output: z.array(z.object({
        id: z.string(),
        name: z.string(),
        email: z.string()
      })),
      http: {
        method: 'GET' as const,
        path: '/users'
      }
    }
  };

  describe('Contract Creation', () => {
    it('should create a typed contract', () => {
      const typedContract = createTypedContract(userContract);
      expect(typedContract).toBeInstanceOf(TypedContract);
    });

    it('should preserve contract definition', () => {
      const typedContract = createTypedContract(userContract);
      expect(typedContract.getDefinition()).toEqual(userContract);
    });

    it('should infer service type', () => {
      const typedContract = createTypedContract(userContract);
      const service = typedContract.inferService();
      expect(service).toBeDefined();
    });
  });

  describe('TypedHttpClient', () => {
    let client: TypedHttpClient<typeof userContract>;
    let mockFetch: jest.MockedFunction<typeof global.fetch>;

    beforeEach(() => {
      const typedContract = createTypedContract(userContract);
      client = createTypedClient(typedContract, 'http://localhost:3000', {
        serviceName: 'UserService'
      });

      // Mock fetch
      mockFetch = jest.fn();
      global.fetch = mockFetch as any;
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    it('should create typed client', () => {
      expect(client).toBeInstanceOf(TypedHttpClient);
    });

    it('should provide type-safe method calls', () => {
      const query = client.call('getUser', { id: '123e4567-e89b-12d3-a456-426614174000' });
      expect(query).toBeInstanceOf(QueryBuilder);
    });

    it('should provide service proxy with type inference', () => {
      const service = client.service;
      expect(service).toBeDefined();
      expect(typeof service.getUser).toBe('function');
      expect(typeof service.createUser).toBe('function');
    });

    it('should validate input on method call', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { id: '123', name: 'John', email: 'john@example.com' } })
      } as Response);

      // This should work with valid input
      const validQuery = client.call('getUser', { id: '123e4567-e89b-12d3-a456-426614174000' });
      await expect(validQuery.execute()).resolves.toBeTruthy();

      // This should fail validation with invalid input
      const invalidQuery = client.call('getUser', { id: 'not-a-uuid' } as any);
      await expect(invalidQuery.execute()).rejects.toThrow('Input validation failed');
    });

    it('should support batch operations', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { id: '123', name: 'John', email: 'john@example.com' } })
      } as Response);

      const calls = [
        { method: 'getUser' as const, input: { id: '123e4567-e89b-12d3-a456-426614174000' } },
        { method: 'getUser' as const, input: { id: '223e4567-e89b-12d3-a456-426614174000' } }
      ];

      const results = await client.batch(calls);
      expect(results).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('QueryBuilder', () => {
    let client: TypedHttpClient<typeof userContract>;
    let queryBuilder: QueryBuilder<typeof userContract, 'getUser'>;

    beforeEach(() => {
      const typedContract = createTypedContract(userContract);
      client = createTypedClient(typedContract, 'http://localhost:3000');
      queryBuilder = client.call('getUser', { id: '123e4567-e89b-12d3-a456-426614174000' });
    });

    it('should support method chaining', () => {
      const result = queryBuilder
        .cache({ maxAge: 5000 })
        .retry({ attempts: 3 })
        .timeout(10000)
        .priority('high');

      expect(result).toBe(queryBuilder); // Same instance for chaining
    });

    it('should configure cache options', () => {
      const cached = queryBuilder.cache({
        maxAge: 5000,
        staleWhileRevalidate: 10000,
        tags: ['users']
      });

      expect(cached).toBeDefined();
    });

    it('should configure retry options', () => {
      const withRetry = queryBuilder.retry({
        attempts: 3,
        backoff: 'exponential',
        maxDelay: 30000
      });

      expect(withRetry).toBeDefined();
    });

    it('should support middleware addition', () => {
      const middleware = async (ctx: any, next: () => Promise<void>) => {
        console.log('Before');
        await next();
        console.log('After');
      };

      const withMiddleware = queryBuilder.middleware(middleware);
      expect(withMiddleware).toBeDefined();
    });

    it('should support request deduplication', () => {
      const deduped = queryBuilder.dedupe('user-123');
      expect(deduped).toBeDefined();
    });

    it('should support cache invalidation', () => {
      const withInvalidation = queryBuilder.invalidateOn(['users', 'profiles']);
      expect(withInvalidation).toBeDefined();
    });

    it('should support background refetch', () => {
      const withBackground = queryBuilder.background(60000);
      expect(withBackground).toBeDefined();
    });

    it('should preserve type safety through chaining', () => {
      const result = queryBuilder
        .cache({ maxAge: 5000 })
        .retry({ attempts: 3 })
        .timeout(10000);

      // Result should still be QueryBuilder with correct types
      expect(result).toBeInstanceOf(QueryBuilder);
    });
  });

  describe('Type Inference', () => {
    it('should infer input types correctly', () => {
      const typedContract = createTypedContract(userContract);
      const client = createTypedClient(typedContract, 'http://localhost:3000');

      // TypeScript should enforce correct input types
      // These are compile-time checks, runtime tests verify structure
      const getUserInput = { id: '123e4567-e89b-12d3-a456-426614174000' };
      const query = client.call('getUser', getUserInput);
      expect(query).toBeDefined();
    });

    it('should infer output types correctly', async () => {
      const typedContract = createTypedContract(userContract);
      const client = createTypedClient(typedContract, 'http://localhost:3000');

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            id: '123',
            name: 'John Doe',
            email: 'john@example.com'
          }
        })
      } as Response);

      const result = await client.call('getUser', {
        id: '123e4567-e89b-12d3-a456-426614174000'
      }).execute();

      // TypeScript knows result has id, name, email
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('email');
    });

    it('should enforce method contract constraints', () => {
      const streamContract = {
        streamData: {
          input: z.object({ query: z.string() }),
          output: z.object({ data: z.string() }),
          stream: true as const
        }
      };

      const typedContract = createTypedContract(streamContract);
      const service = typedContract.inferService();

      // Service methods should reflect stream vs async nature
      expect(service).toBeDefined();
    });
  });

  describe('Mutation Builder', () => {
    let client: TypedHttpClient<typeof userContract>;

    beforeEach(() => {
      const typedContract = createTypedContract(userContract);
      client = createTypedClient(typedContract, 'http://localhost:3000');
    });

    it('should create mutation with optimistic updates', () => {
      const mutation = client.call('createUser', {
        name: 'John Doe',
        email: 'john@example.com'
      }).mutate((current) => ({
        ...current,
        id: 'temp-id',
        name: 'John Doe',
        email: 'john@example.com'
      }));

      expect(mutation).toBeDefined();
    });

    it('should support rollback handler', () => {
      const rollbackHandler = jest.fn();

      const mutation = client.call('createUser', {
        name: 'John Doe',
        email: 'john@example.com'
      })
      .mutate()
      .onRollback(rollbackHandler);

      expect(mutation).toBeDefined();
    });

    it('should support success handler', () => {
      const successHandler = jest.fn();

      const mutation = client.call('createUser', {
        name: 'John Doe',
        email: 'john@example.com'
      })
      .mutate()
      .onSuccess(successHandler);

      expect(mutation).toBeDefined();
    });
  });

  describe('Complex Contracts', () => {
    it('should handle nested object schemas', () => {
      const complexContract = {
        updateProfile: {
          input: z.object({
            id: z.string(),
            profile: z.object({
              bio: z.string(),
              avatar: z.string().url(),
              preferences: z.object({
                theme: z.enum(['light', 'dark']),
                notifications: z.boolean()
              })
            })
          }),
          output: z.object({
            success: z.boolean(),
            profile: z.object({
              id: z.string(),
              updatedAt: z.string()
            })
          })
        }
      };

      const typedContract = createTypedContract(complexContract);
      expect(typedContract.getDefinition()).toEqual(complexContract);
    });

    it('should handle array schemas', () => {
      const arrayContract = {
        bulkCreate: {
          input: z.array(z.object({
            name: z.string(),
            email: z.string().email()
          })),
          output: z.array(z.object({
            id: z.string(),
            created: z.boolean()
          }))
        }
      };

      const typedContract = createTypedContract(arrayContract);
      expect(typedContract.getDefinition()).toEqual(arrayContract);
    });

    it('should handle union and optional schemas', () => {
      const unionContract = {
        search: {
          input: z.object({
            query: z.string(),
            type: z.enum(['user', 'post', 'comment']).optional(),
            filters: z.record(z.string(), z.any()).optional()
          }),
          output: z.union([
            z.object({ type: z.literal('user'), users: z.array(z.any()) }),
            z.object({ type: z.literal('post'), posts: z.array(z.any()) }),
            z.object({ type: z.literal('comment'), comments: z.array(z.any()) })
          ])
        }
      };

      const typedContract = createTypedContract(unionContract);
      expect(typedContract.getDefinition()).toEqual(unionContract);
    });
  });
});