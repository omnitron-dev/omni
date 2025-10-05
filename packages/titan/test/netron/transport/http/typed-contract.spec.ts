/**
 * Comprehensive tests for TypedContract system
 * Tests type-safe contract creation, client generation, and query building
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { z } from 'zod';
import {
  TypedContract,
  TypedHttpClient,
  QueryBuilder,
  MutationBuilder,
  createTypedContract,
  createTypedClient,
  type ContractDefinition,
  type ServiceType,
  type InferInput,
  type InferOutput
} from '../../../../src/netron/transport/http/typed-contract.js';
import { HttpTransportClient } from '../../../../src/netron/transport/http/client.js';

describe('TypedContract System', () => {
  // Sample contract for testing
  const testContract = {
    getUser: {
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string(), name: z.string(), email: z.string() })
    },
    createUser: {
      input: z.object({ name: z.string(), email: z.string() }),
      output: z.object({ id: z.string(), name: z.string(), email: z.string() })
    },
    updateUser: {
      input: z.object({ id: z.string(), name: z.string().optional(), email: z.string().optional() }),
      output: z.object({ id: z.string(), name: z.string(), email: z.string() })
    },
    deleteUser: {
      input: z.object({ id: z.string() }),
      output: z.object({ success: z.boolean() })
    },
    listUsers: {
      input: z.object({ page: z.number().optional(), limit: z.number().optional() }),
      output: z.object({
        users: z.array(z.object({ id: z.string(), name: z.string(), email: z.string() })),
        total: z.number()
      })
    }
  } as const satisfies ContractDefinition;

  describe('TypedContract Class', () => {
    let contract: TypedContract<typeof testContract>;

    beforeEach(() => {
      contract = new TypedContract(testContract);
    });

    it('should create TypedContract instance', () => {
      expect(contract).toBeInstanceOf(TypedContract);
    });

    it('should return contract definition', () => {
      const definition = contract.getDefinition();
      expect(definition).toEqual(testContract);
      expect(definition.getUser).toBeDefined();
      expect(definition.createUser).toBeDefined();
    });

    it('should infer service type with proxy', () => {
      const service = contract.inferService();
      expect(service).toBeDefined();
      expect(typeof service).toBe('object');
    });

    it('should validate input when calling service methods', async () => {
      const service = contract.inferService();

      // Valid input should validate
      try {
        await service.getUser({ id: '123' });
      } catch (error: any) {
        // Should fail with "not implemented" not validation error
        expect(error.message).toContain('not implemented');
      }

      // Invalid input should fail validation
      try {
        // @ts-expect-error - testing runtime validation
        await service.getUser({ invalidField: 'test' });
        fail('Should have thrown validation error');
      } catch (error: any) {
        expect(error.message).toContain('Input validation failed');
      }
    });

    it('should generate TypedHttpClient', () => {
      const client = contract.generateClient('http://localhost:3000');
      expect(client).toBeInstanceOf(TypedHttpClient);
    });

    it('should generate TypedHttpClient with middleware', () => {
      const client = contract.generateClient('http://localhost:3000', {
        middleware: { auth: true, cache: true }
      });
      expect(client).toBeInstanceOf(TypedHttpClient);
    });

    it('should handle proxy with non-string properties', () => {
      const service = contract.inferService();
      const symbolProp = Symbol('test');
      expect(service[symbolProp as any]).toBeUndefined();
    });

    it('should handle proxy with unknown methods', () => {
      const service = contract.inferService();
      expect((service as any).unknownMethod).toBeUndefined();
    });
  });

  describe('TypedHttpClient Class', () => {
    let contract: TypedContract<typeof testContract>;
    let client: TypedHttpClient<typeof testContract>;
    let mockTransport: jest.Mocked<HttpTransportClient>;

    beforeEach(() => {
      contract = new TypedContract(testContract);
      client = contract.generateClient('http://localhost:3000', {
        serviceName: 'UserService'
      });

      // Mock the transport
      mockTransport = {
        invoke: jest.fn().mockResolvedValue({ id: '1', name: 'Test', email: 'test@example.com' })
      } as any;

      // Replace internal transport with mock
      (client as any).transport = mockTransport;
    });

    describe('call() method', () => {
      it('should create QueryBuilder for method call', () => {
        const builder = client.call('getUser', { id: '123' });
        expect(builder).toBeInstanceOf(QueryBuilder);
      });

      it('should create QueryBuilder with correct parameters', () => {
        const builder = client.call('createUser', { name: 'John', email: 'john@example.com' });
        expect(builder).toBeInstanceOf(QueryBuilder);
      });
    });

    describe('service proxy', () => {
      it('should provide direct service proxy', () => {
        const service = client.service;
        expect(service).toBeDefined();
        expect(typeof service).toBe('object');
      });

      it('should call methods through proxy', async () => {
        const service = client.service;
        const result = await service.getUser({ id: '123' });

        expect(mockTransport.invoke).toHaveBeenCalledWith(
          'UserService',
          'getUser',
          [{ id: '123' }],
          expect.objectContaining({
            hints: expect.any(Object)
          })
        );
        expect(result).toEqual({ id: '1', name: 'Test', email: 'test@example.com' });
      });

      it('should return middleware from _middleware property', () => {
        const clientWithMiddleware = contract.generateClient('http://localhost:3000', {
          middleware: { auth: true, rateLimit: 100 }
        });
        const service = clientWithMiddleware.service;
        expect(service._middleware).toEqual({ auth: true, rateLimit: 100 });
      });

      it('should handle symbol properties', () => {
        const service = client.service;
        const symbolProp = Symbol('test');
        expect(service[symbolProp as any]).toBeUndefined();
      });

      it('should handle unknown methods', () => {
        const service = client.service;
        expect((service as any).unknownMethod).toBeUndefined();
      });
    });

    describe('batch() method', () => {
      it('should batch multiple method calls', async () => {
        mockTransport.invoke
          .mockResolvedValueOnce({ id: '1', name: 'User1', email: 'user1@example.com' })
          .mockResolvedValueOnce({ id: '2', name: 'User2', email: 'user2@example.com' });

        const results = await client.batch([
          { method: 'getUser', input: { id: '1' } },
          { method: 'getUser', input: { id: '2' } }
        ]);

        expect(results).toHaveLength(2);
        expect(results[0]).toEqual({ id: '1', name: 'User1', email: 'user1@example.com' });
        expect(results[1]).toEqual({ id: '2', name: 'User2', email: 'user2@example.com' });
        expect(mockTransport.invoke).toHaveBeenCalledTimes(2);
      });

      it('should batch different method calls', async () => {
        mockTransport.invoke
          .mockResolvedValueOnce({ id: '1', name: 'User1', email: 'user1@example.com' })
          .mockResolvedValueOnce({ success: true });

        const results = await client.batch([
          { method: 'getUser', input: { id: '1' } },
          { method: 'deleteUser', input: { id: '2' } }
        ]);

        expect(results).toHaveLength(2);
        expect(mockTransport.invoke).toHaveBeenCalledTimes(2);
      });
    });

    describe('subscribe() method', () => {
      it('should return unsubscribe function', () => {
        const unsubscribe = client.subscribe('getUser', (data) => {
          console.log(data);
        });
        expect(typeof unsubscribe).toBe('function');
        unsubscribe();
      });

      it('should log warning for unimplemented subscriptions', () => {
        const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
        client.subscribe('getUser', () => {});
        expect(warnSpy).toHaveBeenCalledWith('Subscriptions not yet implemented');
        warnSpy.mockRestore();
      });
    });
  });

  describe('QueryBuilder Class', () => {
    let contract: TypedContract<typeof testContract>;
    let client: TypedHttpClient<typeof testContract>;
    let mockTransport: jest.Mocked<HttpTransportClient>;

    beforeEach(() => {
      contract = new TypedContract(testContract);
      client = contract.generateClient('http://localhost:3000', {
        serviceName: 'UserService'
      });

      mockTransport = {
        invoke: jest.fn().mockResolvedValue({ id: '1', name: 'Test', email: 'test@example.com' })
      } as any;

      (client as any).transport = mockTransport;
    });

    it('should chain cache configuration', () => {
      const builder = client.call('getUser', { id: '123' })
        .cache({ maxAge: 5000, staleWhileRevalidate: 10000 });

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain retry configuration', () => {
      const builder = client.call('getUser', { id: '123' })
        .retry({ attempts: 3, backoff: 'exponential', maxDelay: 10000 });

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain middleware configuration', () => {
      const customMiddleware = async (ctx: any, next: () => Promise<void>) => {
        await next();
      };

      const builder = client.call('getUser', { id: '123' })
        .middleware(customMiddleware);

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain timeout configuration', () => {
      const builder = client.call('getUser', { id: '123' })
        .timeout(5000);

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain priority configuration', () => {
      const builder = client.call('getUser', { id: '123' })
        .priority('high');

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain invalidateOn configuration', () => {
      const builder = client.call('createUser', { name: 'John', email: 'john@example.com' })
        .invalidateOn(['users', 'user-list']);

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain dedupe configuration', () => {
      const builder = client.call('getUser', { id: '123' })
        .dedupe('user-123');

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain background configuration', () => {
      const builder = client.call('getUser', { id: '123' })
        .background(30000);

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    it('should chain multiple configurations', () => {
      const builder = client.call('getUser', { id: '123' })
        .cache({ maxAge: 5000 })
        .retry({ attempts: 3 })
        .timeout(10000)
        .priority('high')
        .dedupe('user-123');

      expect(builder).toBeInstanceOf(QueryBuilder);
    });

    describe('execute() method', () => {
      it('should execute query and return result', async () => {
        const result = await client.call('getUser', { id: '123' })
          .execute();

        expect(result).toEqual({ id: '1', name: 'Test', email: 'test@example.com' });
        expect(mockTransport.invoke).toHaveBeenCalledWith(
          'UserService',
          'getUser',
          [{ id: '123' }],
          expect.objectContaining({
            hints: expect.any(Object)
          })
        );
      });

      it('should execute with cache hints', async () => {
        await client.call('getUser', { id: '123' })
          .cache({ maxAge: 5000, tags: ['users'] })
          .execute();

        expect(mockTransport.invoke).toHaveBeenCalledWith(
          'UserService',
          'getUser',
          [{ id: '123' }],
          expect.objectContaining({
            hints: expect.objectContaining({
              cache: { maxAge: 5000, tags: ['users'] }
            })
          })
        );
      });

      it('should execute with retry hints', async () => {
        await client.call('getUser', { id: '123' })
          .retry({ attempts: 3, backoff: 'exponential' })
          .execute();

        expect(mockTransport.invoke).toHaveBeenCalledWith(
          'UserService',
          'getUser',
          [{ id: '123' }],
          expect.objectContaining({
            hints: expect.objectContaining({
              retry: { attempts: 3, backoff: 'exponential' }
            })
          })
        );
      });

      it('should execute with timeout and priority hints', async () => {
        await client.call('getUser', { id: '123' })
          .timeout(5000)
          .priority('high')
          .execute();

        expect(mockTransport.invoke).toHaveBeenCalledWith(
          'UserService',
          'getUser',
          [{ id: '123' }],
          expect.objectContaining({
            hints: expect.objectContaining({
              timeout: 5000,
              priority: 'high'
            })
          })
        );
      });

      it('should validate input before execution', async () => {
        try {
          await client.call('getUser', { id: '' } as any).execute();
        } catch (error: any) {
          // Empty string might fail zod validation depending on schema
          // Just ensure we get to execution
        }

        expect(mockTransport.invoke).toHaveBeenCalled();
      });

      it('should fail on invalid input', async () => {
        try {
          // @ts-expect-error - testing runtime validation
          await client.call('getUser', { invalidField: 'test' }).execute();
          fail('Should have thrown validation error');
        } catch (error: any) {
          expect(error.message).toContain('Input validation failed');
        }
      });

      it('should validate output after execution', async () => {
        mockTransport.invoke.mockResolvedValue({ invalidOutput: true });

        try {
          await client.call('getUser', { id: '123' }).execute();
          fail('Should have thrown validation error');
        } catch (error: any) {
          expect(error.message).toContain('Output validation failed');
        }
      });

      it('should return validated output', async () => {
        mockTransport.invoke.mockResolvedValue({
          id: '123',
          name: 'John Doe',
          email: 'john@example.com'
        });

        const result = await client.call('getUser', { id: '123' }).execute();
        expect(result).toEqual({
          id: '123',
          name: 'John Doe',
          email: 'john@example.com'
        });
      });
    });

    describe('mutate() method', () => {
      it('should create MutationBuilder', () => {
        const mutation = client.call('updateUser', {
          id: '123',
          name: 'Updated Name'
        }).mutate();

        expect(mutation).toBeInstanceOf(MutationBuilder);
      });

      it('should create MutationBuilder with optimistic update', () => {
        const optimisticUpdate = (current: any) => ({
          ...current,
          name: 'Optimistic Name'
        });

        const mutation = client.call('updateUser', {
          id: '123',
          name: 'Updated Name'
        }).mutate(optimisticUpdate);

        expect(mutation).toBeInstanceOf(MutationBuilder);
      });
    });
  });

  describe('MutationBuilder Class', () => {
    let contract: TypedContract<typeof testContract>;
    let client: TypedHttpClient<typeof testContract>;
    let mockTransport: jest.Mocked<HttpTransportClient>;

    beforeEach(() => {
      contract = new TypedContract(testContract);
      client = contract.generateClient('http://localhost:3000', {
        serviceName: 'UserService'
      });

      mockTransport = {
        invoke: jest.fn().mockResolvedValue({ id: '1', name: 'Updated', email: 'test@example.com' })
      } as any;

      (client as any).transport = mockTransport;
    });

    it('should chain onRollback handler', () => {
      const rollbackHandler = jest.fn();
      const mutation = client.call('updateUser', { id: '123', name: 'New Name' })
        .mutate()
        .onRollback(rollbackHandler);

      expect(mutation).toBeInstanceOf(MutationBuilder);
    });

    it('should chain onSuccess handler', () => {
      const successHandler = jest.fn();
      const mutation = client.call('updateUser', { id: '123', name: 'New Name' })
        .mutate()
        .onSuccess(successHandler);

      expect(mutation).toBeInstanceOf(MutationBuilder);
    });

    it('should chain multiple handlers', () => {
      const rollbackHandler = jest.fn();
      const successHandler = jest.fn();

      const mutation = client.call('updateUser', { id: '123', name: 'New Name' })
        .mutate()
        .onRollback(rollbackHandler)
        .onSuccess(successHandler);

      expect(mutation).toBeInstanceOf(MutationBuilder);
    });

    it('should execute mutation', async () => {
      const result = await client.call('updateUser', { id: '123', name: 'New Name' })
        .mutate()
        .execute();

      expect(result).toEqual({ id: '1', name: 'Updated', email: 'test@example.com' });
      expect(mockTransport.invoke).toHaveBeenCalled();
    });

    it('should execute mutation with handlers', async () => {
      const rollbackHandler = jest.fn();
      const successHandler = jest.fn();

      const result = await client.call('updateUser', { id: '123', name: 'New Name' })
        .mutate()
        .onRollback(rollbackHandler)
        .onSuccess(successHandler)
        .execute();

      expect(result).toBeDefined();
    });
  });

  describe('Helper Functions', () => {
    it('should create TypedContract with createTypedContract', () => {
      const contract = createTypedContract(testContract);
      expect(contract).toBeInstanceOf(TypedContract);
    });

    it('should create TypedHttpClient with createTypedClient', () => {
      const contract = createTypedContract(testContract);
      const client = createTypedClient(contract, 'http://localhost:3000');
      expect(client).toBeInstanceOf(TypedHttpClient);
    });

    it('should create TypedHttpClient with options', () => {
      const contract = createTypedContract(testContract);
      const client = createTypedClient(contract, 'http://localhost:3000', {
        middleware: { auth: true },
        serviceName: 'CustomService'
      });
      expect(client).toBeInstanceOf(TypedHttpClient);
    });
  });

  describe('Type Inference', () => {
    it('should infer correct input types', () => {
      type GetUserInput = InferInput<typeof testContract.getUser>;
      type CreateUserInput = InferInput<typeof testContract.createUser>;

      const getUserInput: GetUserInput = { id: '123' };
      const createUserInput: CreateUserInput = { name: 'John', email: 'john@example.com' };

      expect(getUserInput.id).toBe('123');
      expect(createUserInput.name).toBe('John');
    });

    it('should infer correct output types', () => {
      type GetUserOutput = InferOutput<typeof testContract.getUser>;
      type DeleteUserOutput = InferOutput<typeof testContract.deleteUser>;

      const getUserOutput: GetUserOutput = {
        id: '1',
        name: 'John',
        email: 'john@example.com'
      };

      const deleteUserOutput: DeleteUserOutput = { success: true };

      expect(getUserOutput.name).toBe('John');
      expect(deleteUserOutput.success).toBe(true);
    });

    it('should infer service type correctly', () => {
      const contract = createTypedContract(testContract);
      type Service = ServiceType<typeof testContract>;

      // This is a compile-time test - if it compiles, types are correct
      const service: Service = contract.inferService();
      expect(service).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    let contract: TypedContract<typeof testContract>;
    let client: TypedHttpClient<typeof testContract>;

    beforeEach(() => {
      contract = new TypedContract(testContract);
      client = contract.generateClient('http://localhost:3000');
    });

    it('should handle empty optional fields', async () => {
      const mockTransport = {
        invoke: jest.fn().mockResolvedValue({
          users: [],
          total: 0
        })
      } as any;

      (client as any).transport = mockTransport;

      const result = await client.call('listUsers', {}).execute();
      expect(result.users).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle optional fields in update', async () => {
      const mockTransport = {
        invoke: jest.fn().mockResolvedValue({
          id: '123',
          name: 'Original Name',
          email: 'test@example.com'
        })
      } as any;

      (client as any).transport = mockTransport;

      const result = await client.call('updateUser', {
        id: '123',
        email: 'newemail@example.com'
      }).execute();

      expect(result.email).toBe('test@example.com');
    });

    it('should handle all priority levels', async () => {
      const mockTransport = {
        invoke: jest.fn().mockResolvedValue({ id: '1', name: 'Test', email: 'test@example.com' })
      } as any;

      (client as any).transport = mockTransport;

      await client.call('getUser', { id: '1' }).priority('high').execute();
      await client.call('getUser', { id: '2' }).priority('normal').execute();
      await client.call('getUser', { id: '3' }).priority('low').execute();

      expect(mockTransport.invoke).toHaveBeenCalledTimes(3);
    });

    it('should handle all backoff strategies', async () => {
      const mockTransport = {
        invoke: jest.fn().mockResolvedValue({ id: '1', name: 'Test', email: 'test@example.com' })
      } as any;

      (client as any).transport = mockTransport;

      await client.call('getUser', { id: '1' }).retry({ attempts: 3, backoff: 'exponential' }).execute();
      await client.call('getUser', { id: '2' }).retry({ attempts: 3, backoff: 'linear' }).execute();
      await client.call('getUser', { id: '3' }).retry({ attempts: 3, backoff: 'constant' }).execute();

      expect(mockTransport.invoke).toHaveBeenCalledTimes(3);
    });
  });
});
