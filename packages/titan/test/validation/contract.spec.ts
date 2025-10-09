/**
 * Comprehensive tests for Contract system - Real use cases, minimal mocking
 */

import { z } from 'zod';
import { Contract, contract, Contracts, ContractBuilder, contractBuilder } from '../../src/validation/contract.js';

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

  describe('Contract class methods', () => {
    it('should extend contract with additional methods', () => {
      const baseContract = contract({
        getUser: {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        }
      });

      const extendedContract = baseContract.extend({
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        },
        deleteUser: {
          input: z.string(),
          output: z.boolean()
        }
      });

      expect(extendedContract.hasMethod('getUser')).toBe(true);
      expect(extendedContract.hasMethod('createUser')).toBe(true);
      expect(extendedContract.hasMethod('deleteUser')).toBe(true);
      expect(extendedContract.metadata).toBe(baseContract.metadata);
    });

    it('should update metadata with withMetadata', () => {
      const userContract = contract({
        getUser: {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        }
      }, {
        name: 'UserService',
        version: '1.0.0'
      });

      const updatedContract = userContract.withMetadata({
        version: '2.0.0',
        description: 'Updated service'
      });

      expect(updatedContract.metadata.name).toBe('UserService');
      expect(updatedContract.metadata.version).toBe('2.0.0');
      expect(updatedContract.metadata.description).toBe('Updated service');
      expect(updatedContract.definition).toBe(userContract.definition);
    });

    it('should get all method names', () => {
      const userContract = contract({
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        },
        getUser: {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        },
        deleteUser: {
          input: z.string(),
          output: z.boolean()
        }
      });

      const methods = userContract.getMethods();

      expect(methods).toHaveLength(3);
      expect(methods).toContain('createUser');
      expect(methods).toContain('getUser');
      expect(methods).toContain('deleteUser');
    });

    it('should validate service implementation', () => {
      const userContract = contract({
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        },
        getUser: {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        }
      });

      const validService = {
        createUser: async (input: any) => ({ id: '123', ...input }),
        getUser: async (id: string) => ({ id, name: 'Test' })
      };

      const invalidService = {
        createUser: async (input: any) => ({ id: '123', ...input })
        // Missing getUser
      };

      expect(userContract.validateImplementation(validService)).toBe(true);
      expect(userContract.validateImplementation(invalidService)).toBe(false);
    });

    it('should reject service with non-function methods', () => {
      const userContract = contract({
        createUser: {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        }
      });

      const invalidService = {
        createUser: 'not-a-function'
      };

      expect(userContract.validateImplementation(invalidService)).toBe(false);
    });
  });

  describe('HTTP method options', () => {
    it('should support HTTP options in method contract', () => {
      const userContract = contract({
        createUser: {
          input: z.object({ name: z.string(), email: z.string().email() }),
          output: z.object({ id: z.string(), name: z.string(), email: z.string() }),
          http: {
            status: 201,
            contentType: 'application/json',
            responseHeaders: {
              'X-Created-By': 'API'
            },
            openapi: {
              summary: 'Create a new user',
              description: 'Creates a new user account',
              tags: ['users'],
              deprecated: false
            }
          }
        }
      });

      const method = userContract.getMethod('createUser');
      expect(method?.http).toBeDefined();
      expect(method?.http?.status).toBe(201);
      expect(method?.http?.contentType).toBe('application/json');
      expect(method?.http?.openapi?.summary).toBe('Create a new user');
    });

    it('should support streaming in HTTP options', () => {
      const streamContract = contract({
        subscribe: {
          input: z.object({ topic: z.string() }),
          output: z.object({ event: z.string(), data: z.any() }),
          stream: true,
          http: {
            streaming: true,
            contentType: 'text/event-stream'
          }
        }
      });

      const method = streamContract.getMethod('subscribe');
      expect(method?.stream).toBe(true);
      expect(method?.http?.streaming).toBe(true);
      expect(method?.http?.contentType).toBe('text/event-stream');
    });
  });

  describe('Contracts.crud template', () => {
    it('should create CRUD contract for entity', () => {
      const userSchema = z.object({
        id: z.string().uuid(),
        name: z.string(),
        email: z.string().email(),
        age: z.number().int().min(0)
      });

      const crudContract = Contracts.crud(userSchema);

      expect(crudContract.hasMethod('create')).toBe(true);
      expect(crudContract.hasMethod('read')).toBe(true);
      expect(crudContract.hasMethod('update')).toBe(true);
      expect(crudContract.hasMethod('delete')).toBe(true);
      expect(crudContract.hasMethod('list')).toBe(true);
    });

    it('should use custom ID schema', () => {
      const entitySchema = z.object({
        id: z.number(),
        name: z.string()
      });

      const crudContract = Contracts.crud(entitySchema, z.number().int());

      expect(crudContract.hasMethod('read')).toBe(true);
      expect(crudContract.hasMethod('delete')).toBe(true);
    });

    it('should include error schemas', () => {
      const entitySchema = z.object({
        id: z.string(),
        name: z.string()
      });

      const crudContract = Contracts.crud(entitySchema);

      const createMethod = crudContract.getMethod('create');
      expect(createMethod?.errors).toBeDefined();
      expect(createMethod?.errors?.[409]).toBeDefined();

      const updateMethod = crudContract.getMethod('update');
      expect(updateMethod?.errors).toBeDefined();
      expect(updateMethod?.errors?.[404]).toBeDefined();

      const deleteMethod = crudContract.getMethod('delete');
      expect(deleteMethod?.errors).toBeDefined();
      expect(deleteMethod?.errors?.[404]).toBeDefined();
    });
  });

  describe('Contracts.streaming template', () => {
    it('should create streaming contract', () => {
      const eventSchema = z.object({
        type: z.string(),
        data: z.any(),
        timestamp: z.number()
      });

      const streamContract = Contracts.streaming(eventSchema);

      expect(streamContract.hasMethod('subscribe')).toBe(true);
      expect(streamContract.hasMethod('unsubscribe')).toBe(true);
    });

    it('should mark subscribe as streaming', () => {
      const itemSchema = z.object({ value: z.number() });

      const streamContract = Contracts.streaming(itemSchema);

      const subscribeMethod = streamContract.getMethod('subscribe');
      expect(subscribeMethod?.stream).toBe(true);
    });

    it('should use custom filter schema', () => {
      const itemSchema = z.object({ value: z.number() });
      const filterSchema = z.object({
        minValue: z.number(),
        maxValue: z.number()
      });

      const streamContract = Contracts.streaming(itemSchema, filterSchema);

      const subscribeMethod = streamContract.getMethod('subscribe');
      expect(subscribeMethod?.input).toBe(filterSchema);
    });
  });

  describe('Contracts.rpc template', () => {
    it('should create RPC contract', () => {
      const inputSchema = z.object({
        a: z.number(),
        b: z.number()
      });

      const outputSchema = z.object({
        result: z.number()
      });

      const rpcContract = Contracts.rpc(inputSchema, outputSchema);

      expect(rpcContract.hasMethod('execute')).toBe(true);

      const executeMethod = rpcContract.getMethod('execute');
      expect(executeMethod?.input).toBe(inputSchema);
      expect(executeMethod?.output).toBe(outputSchema);
    });
  });

  describe('ContractBuilder', () => {
    it('should build contract with fluent API', () => {
      const builder = new ContractBuilder();

      const userContract = builder
        .method('createUser', {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        })
        .method('getUser', {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        })
        .build();

      expect(userContract.hasMethod('createUser')).toBe(true);
      expect(userContract.hasMethod('getUser')).toBe(true);
    });

    it('should add metadata with fluent API', () => {
      const builder = new ContractBuilder();

      const userContract = builder
        .method('getUser', {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        })
        .withMetadata({
          name: 'UserService',
          version: '1.0.0'
        })
        .build();

      expect(userContract.metadata.name).toBe('UserService');
      expect(userContract.metadata.version).toBe('1.0.0');
    });

    it('should merge metadata', () => {
      const builder = new ContractBuilder();

      const userContract = builder
        .withMetadata({ name: 'UserService' })
        .withMetadata({ version: '1.0.0' })
        .method('getUser', {
          input: z.string(),
          output: z.object({ id: z.string(), name: z.string() })
        })
        .build();

      expect(userContract.metadata).toEqual({
        name: 'UserService',
        version: '1.0.0'
      });
    });
  });

  describe('contractBuilder helper', () => {
    it('should create a contract builder', () => {
      const builder = contractBuilder();

      expect(builder).toBeInstanceOf(ContractBuilder);
    });

    it('should create contract with helper', () => {
      const userContract = contractBuilder()
        .method('createUser', {
          input: z.object({ name: z.string() }),
          output: z.object({ id: z.string(), name: z.string() })
        })
        .withMetadata({ name: 'UserService' })
        .build();

      expect(userContract).toBeInstanceOf(Contract);
      expect(userContract.hasMethod('createUser')).toBe(true);
      expect(userContract.metadata.name).toBe('UserService');
    });
  });

  describe('Real-world contract scenarios', () => {
    it('should create authentication service contract', () => {
      const authContract = contract({
        login: {
          input: z.object({
            email: z.string().email(),
            password: z.string().min(8)
          }),
          output: z.object({
            token: z.string(),
            refreshToken: z.string(),
            expiresAt: z.number()
          }),
          errors: {
            401: z.object({ code: z.literal('INVALID_CREDENTIALS'), message: z.string() }),
            429: z.object({ code: z.literal('TOO_MANY_ATTEMPTS'), message: z.string() })
          }
        },
        logout: {
          input: z.object({
            token: z.string()
          }),
          output: z.boolean()
        },
        refreshToken: {
          input: z.object({
            refreshToken: z.string()
          }),
          output: z.object({
            token: z.string(),
            expiresAt: z.number()
          }),
          errors: {
            401: z.object({ code: z.literal('INVALID_TOKEN'), message: z.string() })
          }
        }
      }, {
        name: 'AuthService',
        version: '1.0.0',
        description: 'Authentication and authorization service'
      });

      expect(authContract.hasMethod('login')).toBe(true);
      expect(authContract.hasMethod('logout')).toBe(true);
      expect(authContract.hasMethod('refreshToken')).toBe(true);
      expect(authContract.metadata.name).toBe('AuthService');
    });
  });
});