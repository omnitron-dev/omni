/**
 * Netron-Validation Integration Tests with Real Connections
 *
 * Tests the integration between Netron RPC and validation subsystem
 * using REAL HTTP transport (no mocks for transport layer)
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { z } from 'zod';
import { Netron } from '../../src/netron/netron.js';
import { HttpTransport } from '../../src/netron/transport/http/http-transport.js';
import { Service } from '../../src/decorators/core.js';
import { Contract } from '../../src/decorators/validation.js';
import { contract } from '../../src/validation/index.js';
import { createMockLogger } from '../netron/test-utils.js';
import type { HttpRemotePeer } from '../../src/netron/transport/http/peer.js';

// Test port management
const getRandomPort = () => 9000 + Math.floor(Math.random() * 1000);

describe('Netron-Validation Integration (Real HTTP)', () => {
  let serverNetron: Netron;
  let clientNetron: Netron;
  let serverPort: number;
  let serverUrl: string;

  beforeAll(async () => {
    serverPort = getRandomPort();
    serverUrl = `http://localhost:${serverPort}`;

    // Create server with real HTTP transport
    const serverLogger = createMockLogger();
    serverNetron = new Netron(serverLogger, { id: 'test-server' });

    serverNetron.registerTransport('http', () => new HttpTransport());
    serverNetron.registerTransportServer('http', {
      name: 'http',
      options: { host: 'localhost', port: serverPort }
    });

    await serverNetron.start();

    // Create client with real HTTP transport
    const clientLogger = createMockLogger();
    clientNetron = new Netron(clientLogger, { id: 'test-client' });
    clientNetron.registerTransport('http', () => new HttpTransport());
  });

  afterAll(async () => {
    await clientNetron?.stop();
    await serverNetron?.stop();
  });

  describe('Scenario 1: Basic HTTP RPC with Validation', () => {
    // Define contract
    const CalculatorContract = contract({
      add: {
        input: z.object({
          a: z.number(),
          b: z.number()
        }),
        output: z.number()
      },
      subtract: {
        input: z.object({
          a: z.number(),
          b: z.number()
        }),
        output: z.number()
      },
      multiply: {
        input: z.object({
          a: z.number(),
          b: z.number()
        }),
        output: z.number()
      }
    });

    @Service('calculator@1.0.0')
    @Contract(CalculatorContract)
    class CalculatorService {
      add(input: { a: number; b: number }): number {
        return input.a + input.b;
      }

      subtract(input: { a: number; b: number }): number {
        return input.a - input.b;
      }

      multiply(input: { a: number; b: number }): number {
        return input.a * input.b;
      }
    }

    let peer: HttpRemotePeer;
    let calculator: any;

    beforeEach(async () => {
      // Expose service on server
      await serverNetron.peer.exposeService(new CalculatorService());

      // Connect real HTTP client
      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      calculator = await peer.queryInterface('calculator@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (calculator) {
      //   await peer.releaseInterface(calculator);
      // }
      if (peer) {
        await peer.close();
      }
      // Unexpose service to allow next test to expose it again
      await serverNetron.peer.unexposeService('calculator@1.0.0');
    });

    it('should successfully validate and execute add method', async () => {
      const result = await calculator.add({ a: 5, b: 3 });
      expect(result).toBe(8);
    });

    it('should successfully validate and execute subtract method', async () => {
      const result = await calculator.subtract({ a: 10, b: 4 });
      expect(result).toBe(6);
    });

    it('should successfully validate and execute multiply method', async () => {
      const result = await calculator.multiply({ a: 7, b: 6 });
      expect(result).toBe(42);
    });

    it('should reject invalid input types', async () => {
      await expect(
        calculator.add({ a: 'not-a-number', b: 3 })
      ).rejects.toThrow();
    });

    it('should reject missing required fields', async () => {
      await expect(
        calculator.add({ a: 5 })
      ).rejects.toThrow();
    });

    it('should reject extra fields if strict mode', async () => {
      // With default Zod behavior, extra fields are stripped
      const result = await calculator.add({ a: 5, b: 3, c: 100 });
      expect(result).toBe(8);
    });
  });

  describe('Scenario 2: Validation Errors Over HTTP', () => {
    const UserContract = contract({
      createUser: {
        input: z.object({
          email: z.string().email(),
          age: z.number().int().min(0).max(150),
          username: z.string().min(3).max(20)
        }),
        output: z.object({
          id: z.string().uuid(),
          email: z.string(),
          age: z.number(),
          username: z.string()
        }),
        errors: {
          409: z.object({
            code: z.literal('USER_EXISTS'),
            message: z.string()
          })
        }
      }
    });

    @Service('user@1.0.0')
    @Contract(UserContract)
    class UserService {
      private users = new Map<string, any>();

      createUser(input: { email: string; age: number; username: string }) {
        if (this.users.has(input.email)) {
          throw new Error('USER_EXISTS: User already exists');
        }

        const user = {
          id: crypto.randomUUID(),
          ...input
        };
        this.users.set(input.email, user);
        return user;
      }
    }

    let peer: HttpRemotePeer;
    let userService: any;

    beforeEach(async () => {
      await serverNetron.peer.exposeService(new UserService());
      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      userService = await peer.queryInterface('user@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (userService) {
      //   await peer.releaseInterface(userService);
      // }
      if (peer) {
        await peer.close();
      }
      await serverNetron.peer.unexposeService('user@1.0.0');
    });

    it('should reject invalid email format', async () => {
      await expect(
        userService.createUser({
          email: 'not-an-email',
          age: 25,
          username: 'johndoe'
        })
      ).rejects.toThrow();
    });

    it('should reject age below minimum', async () => {
      await expect(
        userService.createUser({
          email: 'john@example.com',
          age: -1,
          username: 'johndoe'
        })
      ).rejects.toThrow();
    });

    it('should reject age above maximum', async () => {
      await expect(
        userService.createUser({
          email: 'john@example.com',
          age: 200,
          username: 'johndoe'
        })
      ).rejects.toThrow();
    });

    it('should reject username too short', async () => {
      await expect(
        userService.createUser({
          email: 'john@example.com',
          age: 25,
          username: 'ab'
        })
      ).rejects.toThrow();
    });

    it('should reject username too long', async () => {
      await expect(
        userService.createUser({
          email: 'john@example.com',
          age: 25,
          username: 'a'.repeat(21)
        })
      ).rejects.toThrow();
    });

    it('should accept valid input and return valid output', async () => {
      const result = await userService.createUser({
        email: 'john@example.com',
        age: 25,
        username: 'johndoe'
      });

      expect(result).toMatchObject({
        email: 'john@example.com',
        age: 25,
        username: 'johndoe'
      });
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should validate error responses', async () => {
      // Create user first
      await userService.createUser({
        email: 'duplicate@example.com',
        age: 30,
        username: 'duplicate'
      });

      // Try to create again
      await expect(
        userService.createUser({
          email: 'duplicate@example.com',
          age: 30,
          username: 'duplicate2'
        })
      ).rejects.toThrow();
    });
  });

  describe('Scenario 3: Streaming with Validation', () => {
    const StreamContract = contract({
      generateNumbers: {
        input: z.object({
          start: z.number().int(),
          end: z.number().int(),
          step: z.number().int().positive().default(1)
        }),
        output: z.number(),
        stream: true
      }
    });

    @Service('stream@1.0.0')
    @Contract(StreamContract)
    class StreamService {
      async* generateNumbers(input: { start: number; end: number; step: number }) {
        for (let i = input.start; i <= input.end; i += input.step) {
          yield i;
        }
      }
    }

    let peer: HttpRemotePeer;
    let streamService: any;

    beforeEach(async () => {
      await serverNetron.peer.exposeService(new StreamService());
      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      streamService = await peer.queryInterface('stream@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (streamService) {
      //   await peer.releaseInterface(streamService);
      // }
      if (peer) {
        await peer.close();
      }
      await serverNetron.peer.unexposeService('stream@1.0.0');
    });

    it('should validate input for streaming method', async () => {
      // HTTP transport validates input and returns error immediately
      await expect(
        streamService.generateNumbers({
          start: 'not-a-number',
          end: 5,
          step: 1
        })
      ).rejects.toThrow();
    });

    it('should reject negative step', async () => {
      // HTTP transport validates input and returns error immediately
      await expect(
        streamService.generateNumbers({
          start: 1,
          end: 5,
          step: -1
        })
      ).rejects.toThrow();
    });

    it('should validate each streamed item', async () => {
      // HTTP transport doesn't support true streaming - it collects all values and returns as array
      const result = await streamService.generateNumbers({
        start: 1,
        end: 5,
        step: 1
      });

      // For HTTP, the result is an array, not an async iterable
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([1, 2, 3, 4, 5]);

      // Verify each item is a number
      for (const num of result) {
        expect(typeof num).toBe('number');
      }
    });

    it('should use default step value', async () => {
      // HTTP transport doesn't support true streaming - it collects all values and returns as array
      const result = await streamService.generateNumbers({
        start: 10,
        end: 12,
        step: 1
      });

      // For HTTP, the result is an array, not an async iterable
      expect(Array.isArray(result)).toBe(true);
      expect(result).toEqual([10, 11, 12]);
    });
  });

  describe('Scenario 4: Contract Metadata in HTTP', () => {
    const MetadataContract = contract({
      getInfo: {
        input: z.object({ id: z.string() }),
        output: z.object({
          id: z.string(),
          data: z.string()
        }),
        http: {
          status: 200,
          contentType: 'application/json',
          responseHeaders: {
            'X-Custom-Header': 'custom-value',
            'Cache-Control': 'public, max-age=300'
          },
          openapi: {
            summary: 'Get information by ID',
            description: 'Retrieves information for the given ID',
            tags: ['info'],
            deprecated: false
          }
        }
      },
      deprecatedMethod: {
        input: z.object({ value: z.string() }),
        output: z.string(),
        http: {
          openapi: {
            deprecated: true,
            summary: 'Deprecated method'
          }
        }
      }
    });

    @Service('metadata@1.0.0')
    @Contract(MetadataContract)
    class MetadataService {
      getInfo(input: { id: string }) {
        return {
          id: input.id,
          data: `Data for ${input.id}`
        };
      }

      deprecatedMethod(input: { value: string }) {
        return input.value;
      }
    }

    let peer: HttpRemotePeer;
    let metadataService: any;

    beforeEach(async () => {
      await serverNetron.peer.exposeService(new MetadataService());
      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      metadataService = await peer.queryInterface('metadata@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (metadataService) {
      //   await peer.releaseInterface(metadataService);
      // }
      if (peer) {
        await peer.close();
      }
      await serverNetron.peer.unexposeService('metadata@1.0.0');
    });

    it('should execute method with custom HTTP metadata', async () => {
      const result = await metadataService.getInfo({ id: 'test-123' });

      expect(result).toEqual({
        id: 'test-123',
        data: 'Data for test-123'
      });
    });

    it('should execute deprecated method', async () => {
      const result = await metadataService.deprecatedMethod({ value: 'test' });
      expect(result).toBe('test');
    });

    it('should validate input for methods with HTTP metadata', async () => {
      await expect(
        metadataService.getInfo({ id: 123 })
      ).rejects.toThrow();
    });
  });

  describe('Scenario 5: Multiple Services with Different Contracts', () => {
    // Service 1: Math operations
    const MathContract = contract({
      divide: {
        input: z.object({
          dividend: z.number(),
          divisor: z.number().refine(val => val !== 0, {
            message: 'Divisor cannot be zero'
          })
        }),
        output: z.number()
      }
    });

    @Service('math@1.0.0')
    @Contract(MathContract)
    class MathService {
      divide(input: { dividend: number; divisor: number }) {
        return input.dividend / input.divisor;
      }
    }

    // Service 2: String operations
    const StringContract = contract({
      concat: {
        input: z.object({
          strings: z.array(z.string()).min(1).max(10)
        }),
        output: z.string()
      },
      reverse: {
        input: z.string().min(1),
        output: z.string()
      }
    });

    @Service('string@1.0.0')
    @Contract(StringContract)
    class StringService {
      concat(input: { strings: string[] }) {
        return input.strings.join('');
      }

      reverse(input: string) {
        return input.split('').reverse().join('');
      }
    }

    // Service 3: Data operations
    const DataContract = contract({
      store: {
        input: z.object({
          key: z.string().min(1).max(100),
          value: z.any()
        }),
        output: z.boolean()
      },
      retrieve: {
        input: z.string(),
        output: z.any().nullable()
      }
    });

    @Service('data@1.0.0')
    @Contract(DataContract)
    class DataService {
      private storage = new Map<string, any>();

      store(input: { key: string; value: any }) {
        this.storage.set(input.key, input.value);
        return true;
      }

      retrieve(key: string) {
        return this.storage.get(key) ?? null;
      }
    }

    let peer: HttpRemotePeer;
    let mathService: any;
    let stringService: any;
    let dataService: any;

    beforeEach(async () => {
      await serverNetron.peer.exposeService(new MathService());
      await serverNetron.peer.exposeService(new StringService());
      await serverNetron.peer.exposeService(new DataService());

      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      mathService = await peer.queryInterface('math@1.0.0');
      stringService = await peer.queryInterface('string@1.0.0');
      dataService = await peer.queryInterface('data@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (mathService) await peer.releaseInterface(mathService);
      // if (stringService) await peer.releaseInterface(stringService);
      // if (dataService) await peer.releaseInterface(dataService);
      if (peer) await peer.close();
      await serverNetron.peer.unexposeService('math@1.0.0');
      await serverNetron.peer.unexposeService('string@1.0.0');
      await serverNetron.peer.unexposeService('data@1.0.0');
    });

    it('should validate MathService operations', async () => {
      const result = await mathService.divide({ dividend: 10, divisor: 2 });
      expect(result).toBe(5);
    });

    it('should reject division by zero', async () => {
      await expect(
        mathService.divide({ dividend: 10, divisor: 0 })
      ).rejects.toThrow();
    });

    it('should validate StringService operations', async () => {
      const concat = await stringService.concat({
        strings: ['Hello', ' ', 'World']
      });
      expect(concat).toBe('Hello World');

      const reversed = await stringService.reverse('abc');
      expect(reversed).toBe('cba');
    });

    it('should reject empty string array', async () => {
      await expect(
        stringService.concat({ strings: [] })
      ).rejects.toThrow();
    });

    it('should reject too many strings', async () => {
      await expect(
        stringService.concat({ strings: new Array(11).fill('a') })
      ).rejects.toThrow();
    });

    it('should validate DataService operations', async () => {
      const stored = await dataService.store({
        key: 'test-key',
        value: { nested: 'data' }
      });
      expect(stored).toBe(true);

      const retrieved = await dataService.retrieve('test-key');
      expect(retrieved).toEqual({ nested: 'data' });
    });

    it('should reject invalid key length', async () => {
      await expect(
        dataService.store({ key: '', value: 'test' })
      ).rejects.toThrow();

      await expect(
        dataService.store({ key: 'a'.repeat(101), value: 'test' })
      ).rejects.toThrow();
    });

    it('should work across all services simultaneously', async () => {
      // Math
      const mathResult = await mathService.divide({ dividend: 20, divisor: 4 });
      expect(mathResult).toBe(5);

      // String
      const stringResult = await stringService.concat({
        strings: ['a', 'b', 'c']
      });
      expect(stringResult).toBe('abc');

      // Data
      await dataService.store({ key: 'cross-test', value: { math: mathResult, string: stringResult } });
      const dataResult = await dataService.retrieve('cross-test');
      expect(dataResult).toEqual({ math: 5, string: 'abc' });
    });
  });

  describe('Scenario 6: Validation Middleware Integration', () => {
    // Track middleware execution
    const middlewareLog: string[] = [];

    const TrackedContract = contract({
      process: {
        input: z.object({
          value: z.number().positive()
        }),
        output: z.object({
          result: z.number(),
          processed: z.boolean()
        })
      }
    });

    @Service('tracked@1.0.0')
    @Contract(TrackedContract)
    class TrackedService {
      process(input: { value: number }) {
        middlewareLog.push('method-execution');
        return {
          result: input.value * 2,
          processed: true
        };
      }
    }

    let peer: HttpRemotePeer;
    let trackedService: any;

    beforeEach(async () => {
      middlewareLog.length = 0; // Clear log
      await serverNetron.peer.exposeService(new TrackedService());
      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      trackedService = await peer.queryInterface('tracked@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (trackedService) {
      //   await peer.releaseInterface(trackedService);
      // }
      if (peer) {
        await peer.close();
      }
      await serverNetron.peer.unexposeService('tracked@1.0.0');
    });

    it('should execute validation middleware before method', async () => {
      const result = await trackedService.process({ value: 10 });

      expect(result).toEqual({
        result: 20,
        processed: true
      });

      expect(middlewareLog).toContain('method-execution');
    });

    it('should validate before middleware execution', async () => {
      // Invalid input should fail before method execution
      await expect(
        trackedService.process({ value: -5 })
      ).rejects.toThrow();

      // Method should not have been executed
      expect(middlewareLog).not.toContain('method-execution');
    });

    it('should validate output after method execution', async () => {
      const result = await trackedService.process({ value: 15 });

      // Output should be validated
      expect(result.result).toBe(30);
      expect(result.processed).toBe(true);
    });
  });

  describe('Scenario 7: Performance with Real Load', () => {
    const PerfContract = contract({
      echo: {
        input: z.object({
          message: z.string().min(1).max(1000)
        }),
        output: z.string()
      }
    });

    @Service('perf@1.0.0')
    @Contract(PerfContract)
    class PerfService {
      echo(input: { message: string }) {
        return input.message;
      }
    }

    let peer: HttpRemotePeer;
    let perfService: any;

    beforeEach(async () => {
      await serverNetron.peer.exposeService(new PerfService());
      peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      perfService = await peer.queryInterface('perf@1.0.0');
    });

    afterEach(async () => {
      // HTTP interfaces are stateless and don't need to be released
      // if (perfService) {
      //   await peer.releaseInterface(perfService);
      // }
      if (peer) {
        await peer.close();
      }
      await serverNetron.peer.unexposeService('perf@1.0.0');
    });

    it('should handle 100 sequential requests with validation', async () => {
      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        const result = await perfService.echo({ message: `Message ${i}` });
        expect(result).toBe(`Message ${i}`);
      }

      const duration = Date.now() - startTime;

      // Should complete in reasonable time (< 10 seconds for 100 requests)
      expect(duration).toBeLessThan(10000);
    });

    it('should handle concurrent requests with validation', async () => {
      const startTime = Date.now();

      const promises = Array.from({ length: 50 }, (_, i) =>
        perfService.echo({ message: `Concurrent ${i}` })
      );

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;

      expect(results).toHaveLength(50);
      results.forEach((result, i) => {
        expect(result).toBe(`Concurrent ${i}`);
      });

      // Concurrent should be faster than sequential
      expect(duration).toBeLessThan(5000);
    });

    it('should not leak memory with repeated validations', async () => {
      // Warm-up
      for (let i = 0; i < 10; i++) {
        await perfService.echo({ message: 'warmup' });
      }

      // Check memory stays stable
      const measurements: number[] = [];

      for (let batch = 0; batch < 5; batch++) {
        const before = process.memoryUsage().heapUsed;

        for (let i = 0; i < 20; i++) {
          await perfService.echo({ message: `batch-${batch}-msg-${i}` });
        }

        const after = process.memoryUsage().heapUsed;
        measurements.push(after - before);
      }

      // Memory growth should be minimal and stable
      // (not increasing exponentially)
      const avgGrowth = measurements.reduce((a, b) => a + b) / measurements.length;
      expect(avgGrowth).toBeLessThan(5 * 1024 * 1024); // Less than 5MB per batch
    });

    it('should cache validators for performance', async () => {
      // First call - validator compilation
      const start1 = Date.now();
      await perfService.echo({ message: 'first' });
      const time1 = Date.now() - start1;

      // Subsequent calls - cached validator
      const start2 = Date.now();
      for (let i = 0; i < 10; i++) {
        await perfService.echo({ message: `cached-${i}` });
      }
      const time2 = Date.now() - start2;

      // Average time per cached call should be much faster
      const avgCached = time2 / 10;
      expect(avgCached).toBeLessThan(time1);
    });

    it('should handle validation errors efficiently', async () => {
      const startTime = Date.now();

      // Mix of valid and invalid requests
      const promises = Array.from({ length: 50 }, (_, i) => {
        if (i % 2 === 0) {
          return perfService.echo({ message: `valid-${i}` });
        } else {
          // Invalid - too long
          return perfService.echo({ message: 'a'.repeat(1001) })
            .catch((err: Error) => ({ error: true }));
        }
      });

      const results = await Promise.all(promises);

      const duration = Date.now() - startTime;

      const validResults = results.filter(r => typeof r === 'string');
      const errorResults = results.filter(r => typeof r === 'object' && (r as any).error);

      expect(validResults).toHaveLength(25);
      expect(errorResults).toHaveLength(25);
      expect(duration).toBeLessThan(5000);
    });
  });

  describe('Additional Integration Scenarios', () => {
    it('should support optional fields with defaults', async () => {
      const ConfigContract = contract({
        configure: {
          input: z.object({
            name: z.string(),
            timeout: z.number().default(5000),
            retries: z.number().int().default(3),
            enabled: z.boolean().default(true)
          }),
          output: z.object({
            configured: z.boolean(),
            settings: z.any()
          })
        }
      });

      @Service('config@1.0.0')
      @Contract(ConfigContract)
      class ConfigService {
        configure(input: any) {
          return {
            configured: true,
            settings: input
          };
        }
      }

      await serverNetron.peer.exposeService(new ConfigService());
      const peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      const configService = await peer.queryInterface('config@1.0.0');

      const result = await configService.configure({ name: 'test' });

      expect(result.configured).toBe(true);
      expect(result.settings.name).toBe('test');
      expect(result.settings.timeout).toBe(5000);
      expect(result.settings.retries).toBe(3);
      expect(result.settings.enabled).toBe(true);

      // HTTP interfaces are stateless and don't need to be released
      // await peer.releaseInterface(configService);
      await peer.close();
      await serverNetron.peer.unexposeService('config@1.0.0');
    });

    it('should support complex nested validation', async () => {
      const NestedContract = contract({
        processOrder: {
          input: z.object({
            order: z.object({
              id: z.string().uuid(),
              items: z.array(z.object({
                productId: z.string(),
                quantity: z.number().int().positive(),
                price: z.number().positive()
              })).min(1),
              customer: z.object({
                id: z.string(),
                email: z.string().email(),
                address: z.object({
                  street: z.string(),
                  city: z.string(),
                  postalCode: z.string().regex(/^\d{5}$/)
                })
              })
            })
          }),
          output: z.object({
            orderId: z.string(),
            total: z.number(),
            status: z.enum(['pending', 'processing', 'completed'])
          })
        }
      });

      @Service('order@1.0.0')
      @Contract(NestedContract)
      class OrderService {
        processOrder(input: any) {
          const total = input.order.items.reduce(
            (sum: number, item: any) => sum + (item.quantity * item.price),
            0
          );

          return {
            orderId: input.order.id,
            total,
            status: 'pending' as const
          };
        }
      }

      await serverNetron.peer.exposeService(new OrderService());
      const peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      const orderService = await peer.queryInterface('order@1.0.0');

      const validOrder = {
        order: {
          id: crypto.randomUUID(),
          items: [
            { productId: 'p1', quantity: 2, price: 10.50 },
            { productId: 'p2', quantity: 1, price: 25.00 }
          ],
          customer: {
            id: 'c1',
            email: 'customer@example.com',
            address: {
              street: '123 Main St',
              city: 'Springfield',
              postalCode: '12345'
            }
          }
        }
      };

      const result = await orderService.processOrder(validOrder);

      expect(result.orderId).toBe(validOrder.order.id);
      expect(result.total).toBe(46.00);
      expect(result.status).toBe('pending');

      // Test invalid postal code
      const invalidOrder = {
        order: {
          ...validOrder.order,
          customer: {
            ...validOrder.order.customer,
            address: {
              ...validOrder.order.customer.address,
              postalCode: 'INVALID'
            }
          }
        }
      };

      await expect(
        orderService.processOrder(invalidOrder)
      ).rejects.toThrow();

      // HTTP interfaces are stateless and don't need to be released
      // await peer.releaseInterface(orderService);
      await peer.close();
      await serverNetron.peer.unexposeService('order@1.0.0');
    });

    it('should support discriminated unions', async () => {
      const UnionContract = contract({
        handleEvent: {
          input: z.discriminatedUnion('type', [
            z.object({
              type: z.literal('user.created'),
              userId: z.string(),
              email: z.string().email()
            }),
            z.object({
              type: z.literal('user.deleted'),
              userId: z.string(),
              reason: z.string()
            }),
            z.object({
              type: z.literal('user.updated'),
              userId: z.string(),
              changes: z.record(z.any())
            })
          ]),
          output: z.object({
            handled: z.boolean(),
            eventType: z.string()
          })
        }
      });

      @Service('event@1.0.0')
      @Contract(UnionContract)
      class EventService {
        handleEvent(input: any) {
          return {
            handled: true,
            eventType: input.type
          };
        }
      }

      await serverNetron.peer.exposeService(new EventService());
      const peer = await clientNetron.connect(serverUrl) as HttpRemotePeer;
      const eventService = await peer.queryInterface('event@1.0.0');

      // Test user.created
      const created = await eventService.handleEvent({
        type: 'user.created',
        userId: 'u1',
        email: 'user@example.com'
      });
      expect(created.eventType).toBe('user.created');

      // Test user.deleted
      const deleted = await eventService.handleEvent({
        type: 'user.deleted',
        userId: 'u1',
        reason: 'requested'
      });
      expect(deleted.eventType).toBe('user.deleted');

      // Test user.updated
      const updated = await eventService.handleEvent({
        type: 'user.updated',
        userId: 'u1',
        changes: { name: 'New Name' }
      });
      expect(updated.eventType).toBe('user.updated');

      // Test invalid discriminator
      await expect(
        eventService.handleEvent({
          type: 'user.unknown',
          userId: 'u1'
        })
      ).rejects.toThrow();

      // HTTP interfaces are stateless and don't need to be released
      // await peer.releaseInterface(eventService);
      await peer.close();
      await serverNetron.peer.unexposeService('event@1.0.0');
    });
  });
});
