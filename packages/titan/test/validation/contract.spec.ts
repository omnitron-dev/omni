/**
 * Tests for Contract system - TDD approach
 */

import { z } from 'zod';
import { contract } from '../../src/validation/contract.js';

describe('Contract System', () => {
  describe('contract creation', () => {
    it('should create a contract with method definitions', () => {
      const UserSchema = z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        name: z.string().min(2).max(100)
      });

      const UserServiceContract = contract({
        createUser: {
          input: z.object({
            email: z.string().email(),
            name: z.string().min(2),
            password: z.string().min(8)
          }),
          output: UserSchema
        },
        getUser: {
          input: z.string().uuid(),
          output: UserSchema.nullable()
        }
      });

      expect(UserServiceContract).toBeDefined();
      expect(UserServiceContract.definition).toBeDefined();
      expect(UserServiceContract.definition.createUser).toBeDefined();
      expect(UserServiceContract.definition.getUser).toBeDefined();
    });

    it('should support error definitions', () => {
      const ContractWithErrors = contract({
        createUser: {
          input: z.object({ email: z.string() }),
          output: z.object({ id: z.string() }),
          errors: {
            409: z.object({ code: z.literal('USER_EXISTS'), email: z.string() }),
            422: z.object({ code: z.literal('VALIDATION_ERROR'), errors: z.array(z.string()) })
          }
        }
      });

      const methodContract = ContractWithErrors.definition.createUser;
      expect(methodContract.errors).toBeDefined();
      expect(methodContract.errors![409]).toBeDefined();
      expect(methodContract.errors![422]).toBeDefined();
    });

    it('should support streaming methods', () => {
      const StreamingContract = contract({
        listUsers: {
          input: z.object({
            limit: z.number().optional()
          }),
          output: z.object({ id: z.string(), name: z.string() }),
          stream: true
        }
      });

      const methodContract = StreamingContract.definition.listUsers;
      expect(methodContract.stream).toBe(true);
    });

    it('should support validation options', () => {
      const ContractWithOptions = contract({
        processData: {
          input: z.unknown(),
          output: z.any(),
          options: {
            mode: 'strip',
            abortEarly: false,
            coerce: true
          }
        }
      });

      const methodContract = ContractWithOptions.definition.processData;
      expect(methodContract.options).toBeDefined();
      expect(methodContract.options!.mode).toBe('strip');
      expect(methodContract.options!.abortEarly).toBe(false);
      expect(methodContract.options!.coerce).toBe(true);
    });
  });

  describe('type inference', () => {
    it('should infer types from contract', () => {
      const UserContract = contract({
        createUser: {
          input: z.object({
            email: z.string().email(),
            name: z.string()
          }),
          output: z.object({
            id: z.string(),
            email: z.string(),
            name: z.string()
          })
        }
      });

      type CreateUserInput = z.infer<typeof UserContract.definition.createUser.input>;
      type CreateUserOutput = z.infer<typeof UserContract.definition.createUser.output>;

      // TypeScript compile-time checks
      const input: CreateUserInput = {
        email: 'test@example.com',
        name: 'Test User'
      };

      const output: CreateUserOutput = {
        id: '123',
        email: 'test@example.com',
        name: 'Test User'
      };

      expect(input).toBeDefined();
      expect(output).toBeDefined();
    });
  });

  describe('contract validation', () => {
    it('should validate method exists in contract', () => {
      const TestContract = contract({
        method1: { input: z.string(), output: z.string() },
        method2: { input: z.number(), output: z.number() }
      });

      expect(TestContract.hasMethod('method1')).toBe(true);
      expect(TestContract.hasMethod('method2')).toBe(true);
      expect(TestContract.hasMethod('method3')).toBe(false);
    });

    it('should get method contract', () => {
      const TestContract = contract({
        testMethod: {
          input: z.string(),
          output: z.string(),
          stream: false
        }
      });

      const methodContract = TestContract.getMethod('testMethod');
      expect(methodContract).toBeDefined();
      expect(methodContract?.input).toBeDefined();
      expect(methodContract?.output).toBeDefined();
      expect(methodContract?.stream).toBe(false);
    });
  });

  describe('contract composition', () => {
    it('should support extending contracts', () => {
      const BaseContract = contract({
        getUser: {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        }
      });

      const ExtendedContract = contract({
        ...BaseContract.definition,
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string() })
        }
      });

      expect(ExtendedContract.hasMethod('getUser')).toBe(true);
      expect(ExtendedContract.hasMethod('createUser')).toBe(true);
    });

    it('should support merging contracts', () => {
      const Contract1 = contract({
        method1: { input: z.string(), output: z.string() }
      });

      const Contract2 = contract({
        method2: { input: z.number(), output: z.number() }
      });

      const MergedContract = contract({
        ...Contract1.definition,
        ...Contract2.definition
      });

      expect(MergedContract.hasMethod('method1')).toBe(true);
      expect(MergedContract.hasMethod('method2')).toBe(true);
    });
  });

  describe('contract metadata', () => {
    it('should store metadata', () => {
      const ContractWithMetadata = contract(
        {
          testMethod: {
            input: z.string(),
            output: z.string()
          }
        },
        {
          name: 'TestContract',
          version: '1.0.0',
          description: 'Test contract for validation'
        }
      );

      expect(ContractWithMetadata.metadata).toBeDefined();
      expect(ContractWithMetadata.metadata.name).toBe('TestContract');
      expect(ContractWithMetadata.metadata.version).toBe('1.0.0');
      expect(ContractWithMetadata.metadata.description).toBe('Test contract for validation');
    });
  });

  describe('empty and partial contracts', () => {
    it('should support empty contracts', () => {
      const EmptyContract = contract({});
      expect(EmptyContract.definition).toEqual({});
      expect(EmptyContract.hasMethod('any')).toBe(false);
    });

    it('should support partial method definitions', () => {
      const PartialContract = contract({
        noValidation: {},
        inputOnly: {
          input: z.string()
        },
        outputOnly: {
          output: z.string()
        }
      });

      expect(PartialContract.definition.noValidation).toEqual({});
      expect(PartialContract.definition.inputOnly.input).toBeDefined();
      expect(PartialContract.definition.inputOnly.output).toBeUndefined();
      expect(PartialContract.definition.outputOnly.output).toBeDefined();
      expect(PartialContract.definition.outputOnly.input).toBeUndefined();
    });
  });
});