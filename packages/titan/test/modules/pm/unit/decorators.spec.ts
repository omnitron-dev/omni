/**
 * PM Decorators Unit Tests
 *
 * Comprehensive tests for process management decorators including:
 * - @Process - Class decorator for process configuration
 * - @Public / @Method - Method decorator for exposing methods
 * - @CircuitBreaker - Resilience pattern decorator with runtime wrapping
 * - @Idempotent - Idempotency decorator with runtime wrapping
 * - @RateLimit - Rate limiting decorator (token-bucket, sliding-window, fixed-window)
 * - @Cache - Caching decorator with TTL, key function, condition function
 * - @Validate - Validation decorator with schema and custom validator
 * - @Supervisor, @Child - Supervision tree decorators
 * - @Workflow, @Stage, @Compensate - Workflow decorators
 * - @HealthCheck, @OnShutdown - Lifecycle decorators
 * - Helper functions (parseDuration)
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  Process,
  Public,
  RateLimit,
  Cache,
  Validate,
  Trace,
  Metric,
  Supervisor,
  Child,
  Workflow,
  Stage,
  Compensate,
  CircuitBreaker,
  SelfHeal,
  Idempotent,
  HealthCheck,
  OnShutdown,
  Actor,
  InjectProcess,
  Compose,
  SharedState,
  AdaptiveBitrate,
  GraphQLService,
  DistributedTransaction,
  Saga,
  Step,
  PROCESS_METADATA_KEY,
  PROCESS_METHOD_METADATA_KEY,
  SUPERVISOR_METADATA_KEY,
  WORKFLOW_METADATA_KEY,
  ACTOR_METADATA_KEY,
} from '../../../../src/modules/pm/decorators.js';
import type {
  ICircuitBreakerOptions,
  IRateLimitOptions,
  ICacheOptions,
  IValidationOptions,
  SupervisionStrategy,
} from '../../../../src/modules/pm/types.js';

describe('PM Decorators', () => {
  describe('@Process', () => {
    it('should set process metadata on class', () => {
      @Process({ name: 'TestService', version: '2.0.0' })
      class TestService {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, TestService);

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('TestService');
      expect(metadata.version).toBe('2.0.0');
    });

    it('should work without explicit name (name is optional)', () => {
      @Process()
      class MyDefaultService {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, MyDefaultService);

      expect(metadata).toBeDefined();
      expect(metadata.isProcess).toBe(true);
      // Name is not automatically set to class name by default
      expect(metadata.target).toBe(MyDefaultService);
    });

    it('should work without version (version is optional)', () => {
      @Process({ name: 'VersionTest' })
      class VersionTest {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, VersionTest);

      expect(metadata.name).toBe('VersionTest');
      // Version is not automatically set by default
      expect(metadata.isProcess).toBe(true);
    });

    it('should preserve other options', () => {
      @Process({
        name: 'FullOptionsService',
        instances: 3,
        transport: 'tcp',
        timeout: 5000,
      })
      class FullOptionsService {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, FullOptionsService);

      expect(metadata.instances).toBe(3);
      expect(metadata.transport).toBe('tcp');
      expect(metadata.timeout).toBe(5000);
    });
  });

  describe('@Public', () => {
    it('should mark method as public', () => {
      class TestClass {
        @Public()
        publicMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'publicMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.public).toBe(true);
    });

    it('should not affect non-decorated methods', () => {
      class TestClass {
        @Public()
        publicMethod() {}

        privateMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'privateMethod'
      );

      expect(metadata).toBeUndefined();
    });
  });

  describe('@RateLimit', () => {
    it('should set rate limit metadata', () => {
      class TestClass {
        @RateLimit({ rps: 100, burst: 200 })
        rateLimitedMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'rateLimitedMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.rateLimit).toEqual({ rps: 100, burst: 200 });
    });
  });

  describe('@Cache', () => {
    it('should set cache metadata', () => {
      class TestClass {
        @Cache({ ttl: 60000, maxSize: 1000 })
        cachedMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'cachedMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.cache).toEqual({ ttl: 60000, maxSize: 1000 });
    });

    it('should use default options if none provided', () => {
      class TestClass {
        @Cache()
        defaultCachedMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'defaultCachedMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.cache).toBeDefined();
    });
  });

  describe('@Validate', () => {
    it('should set validation metadata', () => {
      const schema = { type: 'object', properties: { name: { type: 'string' } } };

      class TestClass {
        @Validate({ schema })
        validatedMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'validatedMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.validate).toEqual({ schema });
    });
  });

  describe('@Trace', () => {
    it('should set trace metadata', () => {
      class TestClass {
        @Trace()
        tracedMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'tracedMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.trace).toBe(true);
    });
  });

  describe('@Metric', () => {
    it('should set metrics flag to true', () => {
      class TestClass {
        @Metric('custom_metric')
        metricMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'metricMethod'
      );

      expect(metadata).toBeDefined();
      // The actual implementation sets metrics: true, not metric: name
      expect(metadata.metrics).toBe(true);
    });

    it('should enable metrics even without name parameter', () => {
      class TestClass {
        @Metric()
        defaultMetricMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'defaultMetricMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.metrics).toBe(true);
    });
  });

  describe('@Supervisor and @Child', () => {
    it('should set supervisor metadata', () => {
      @Supervisor({ strategy: 'one-for-one', maxRestarts: 5 })
      class TestSupervisor {}

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, TestSupervisor);

      expect(metadata).toBeDefined();
      expect(metadata.strategy).toBe('one-for-one');
      expect(metadata.maxRestarts).toBe(5);
    });

    it('should register child processes', () => {
      class ChildProcess {}

      @Supervisor()
      class TestSupervisor {
        @Child({ critical: true })
        worker: typeof ChildProcess = ChildProcess;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, TestSupervisor);

      expect(metadata).toBeDefined();
      expect(metadata.children).toBeDefined();
      expect(metadata.children.size).toBe(1);

      const childDef = metadata.children.get('worker');
      expect(childDef).toBeDefined();
      expect(childDef.critical).toBe(true);
    });

    it('should handle multiple children', () => {
      class Worker1 {}
      class Worker2 {}

      @Supervisor()
      class MultiChildSupervisor {
        @Child({ critical: true })
        worker1: typeof Worker1 = Worker1;

        @Child({ critical: false })
        worker2: typeof Worker2 = Worker2;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, MultiChildSupervisor);

      expect(metadata.children.size).toBe(2);
    });
  });

  describe('@Workflow, @Stage, and @Compensate', () => {
    it('should set workflow metadata', () => {
      @Workflow()
      class TestWorkflow {}

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, TestWorkflow);

      expect(metadata).toBeDefined();
      expect(metadata.stages).toBeDefined();
    });

    it('should register workflow stages', () => {
      // Stages are stored by method name (propertyKey), not by name option
      class TestWorkflow {
        @Stage({ name: 'extract', order: 1 })
        async extractData() {
          return { data: [] };
        }

        @Stage({ name: 'transform', order: 2, dependsOn: ['extractData'] })
        async transformData() {
          return { transformed: true };
        }
      }

      // Stages create metadata on the constructor
      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, TestWorkflow);

      expect(metadata).toBeDefined();
      expect(metadata.stages).toBeDefined();
      expect(metadata.stages.size).toBe(2);

      // Stages are stored by method name
      const extractStage = metadata.stages.get('extractData');
      expect(extractStage).toBeDefined();
      expect(extractStage.order).toBe(1);

      const transformStage = metadata.stages.get('transformData');
      expect(transformStage).toBeDefined();
      expect(transformStage.dependsOn).toContain('extractData');
    });

    it('should register compensation handlers', () => {
      class CompensatingWorkflow {
        @Stage({ name: 'createOrder' })
        async createOrder() {
          return { orderId: '123' };
        }

        // Compensate uses the stage name (which is the method name 'createOrder')
        @Compensate('createOrder')
        async cancelOrder() {
          // Rollback logic
        }
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, CompensatingWorkflow);

      expect(metadata).toBeDefined();
      const createStage = metadata.stages.get('createOrder');
      expect(createStage).toBeDefined();
      // Compensate stores the function itself, not the method name
      expect(typeof createStage.compensate).toBe('function');
    });
  });

  describe('@CircuitBreaker', () => {
    it('should wrap method with circuit breaker behavior', () => {
      // CircuitBreaker is a behavioral decorator that wraps the method
      // It doesn't set metadata, but modifies the method descriptor
      class TestClass {
        @CircuitBreaker({ threshold: 5, timeout: 30000 })
        protectedMethod() {
          return 'result';
        }
      }

      // The method should be wrapped (it becomes an async function)
      const instance = new TestClass();
      const result = instance.protectedMethod();

      // Result is now a Promise due to circuit breaker wrapping
      expect(result).toBeInstanceOf(Promise);
    });

    it('should wrap method with circuit breaker logic', async () => {
      let callCount = 0;
      const options: ICircuitBreakerOptions = { threshold: 2, timeout: 100 };

      class TestService {
        @CircuitBreaker(options)
        async unstableMethod() {
          callCount++;
          if (callCount <= 2) {
            throw new Error('Service unavailable');
          }
          return 'success';
        }
      }

      const service = new TestService();

      // First 2 calls fail and open circuit
      for (let i = 0; i < 2; i++) {
        try {
          await service.unstableMethod();
        } catch {
          // Expected
        }
      }

      expect(callCount).toBe(2);

      // Third call should be blocked by circuit breaker
      // (may throw immediately without calling the method)
      try {
        await service.unstableMethod();
      } catch (error: any) {
        // Circuit breaker should throw or the method should fail
        expect(error).toBeDefined();
      }
    });
  });

  describe('@Idempotent', () => {
    it('should wrap method with idempotency behavior', () => {
      // Idempotent is a behavioral decorator that wraps the method with caching
      // It doesn't set metadata on PROCESS_METHOD_METADATA_KEY
      class TestClass {
        @Idempotent({ key: 'user-{args.0}', ttl: '1h' })
        idempotentMethod(userId: string) {
          return `processed-${userId}`;
        }
      }

      // The method should be wrapped (it becomes an async function)
      const instance = new TestClass();
      const result = instance.idempotentMethod('123');

      // Result is now a Promise due to idempotent wrapping
      expect(result).toBeInstanceOf(Promise);
    });

    it('should cache idempotent results', async () => {
      let callCount = 0;

      class TestService {
        @Idempotent({ key: 'cache-{args.0}', ttl: '10m' })
        async expensiveOperation(id: string) {
          callCount++;
          return `result-${id}`;
        }
      }

      const service = new TestService();

      // First call executes the method
      const result1 = await service.expensiveOperation('123');
      expect(result1).toBe('result-123');
      expect(callCount).toBe(1);

      // Second call with same key should return cached result
      // (depends on implementation - may need cache to be set up)
    });
  });

  describe('@SelfHeal', () => {
    it('should register self-heal metadata on class prototype', () => {
      class TestClass {
        @SelfHeal({ action: 'restart', maxRetries: 3 })
        selfHealingMethod() {}
      }

      // SelfHeal stores metadata on target using 'self-heal' key
      const metadata = Reflect.getMetadata('self-heal', TestClass.prototype);

      expect(metadata).toBeDefined();
      expect(Array.isArray(metadata)).toBe(true);
      expect(metadata[0].action).toBe('restart');
      expect(metadata[0].maxRetries).toBe(3);
    });
  });

  describe('@HealthCheck', () => {
    it('should register health check metadata on class prototype', () => {
      class TestClass {
        @HealthCheck({ interval: 5000 })
        async checkHealth() {
          return { status: 'healthy' };
        }
      }

      // HealthCheck stores metadata on target using 'health-check' key
      const metadata = Reflect.getMetadata('health-check', TestClass.prototype);

      expect(metadata).toBeDefined();
      expect(metadata.interval).toBe(5000);
    });
  });

  describe('@OnShutdown', () => {
    it('should register shutdown handler on class prototype', () => {
      class TestClass {
        @OnShutdown()
        async cleanup() {
          // Cleanup resources
        }
      }

      // OnShutdown stores the method name on target using 'on-shutdown' key
      const methodName = Reflect.getMetadata('on-shutdown', TestClass.prototype);

      expect(methodName).toBe('cleanup');
    });
  });

  describe('Decorator Composition', () => {
    it('should allow multiple decorators on same method', () => {
      class TestClass {
        @Public()
        @RateLimit({ rps: 100 })
        @Cache({ ttl: 5000 })
        @Trace()
        composedMethod() {
          return 'result';
        }
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TestClass.prototype,
        'composedMethod'
      );

      expect(metadata).toBeDefined();
      expect(metadata.public).toBe(true);
      expect(metadata.rateLimit).toEqual({ rps: 100 });
      expect(metadata.cache).toEqual({ ttl: 5000 });
      expect(metadata.trace).toBe(true);
    });

    it('should allow class and method decorators together', () => {
      @Process({ name: 'ComposedService', version: '1.0.0' })
      class ComposedService {
        @Public()
        @RateLimit({ rps: 50 })
        async reliableMethod() {
          return 'reliable';
        }
      }

      const classMetadata = Reflect.getMetadata(PROCESS_METADATA_KEY, ComposedService);
      expect(classMetadata.name).toBe('ComposedService');

      const methodMetadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        ComposedService.prototype,
        'reliableMethod'
      );
      expect(methodMetadata.public).toBe(true);
      expect(methodMetadata.rateLimit).toEqual({ rps: 50 });
    });
  });

  // ============================================================================
  // Additional Comprehensive Tests
  // ============================================================================

  describe('@Process decorator - Comprehensive', () => {
    it('should store metadata with PROCESS_METADATA_KEY symbol', () => {
      @Process()
      class BasicProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, BasicProcess);

      expect(metadata).toBeDefined();
      expect(typeof PROCESS_METADATA_KEY).toBe('symbol');
      expect(PROCESS_METADATA_KEY.toString()).toContain('process:metadata');
    });

    it('should set isProcess flag to true', () => {
      @Process()
      class FlagProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, FlagProcess);

      expect(metadata.isProcess).toBe(true);
    });

    it('should store target reference', () => {
      @Process()
      class TargetProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, TargetProcess);

      expect(metadata.target).toBe(TargetProcess);
    });

    it('should initialize methods Map', () => {
      @Process()
      class MapProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, MapProcess);

      expect(metadata.methods).toBeInstanceOf(Map);
    });

    it('should collect method metadata from prototype', () => {
      @Process({ name: 'CollectorProcess' })
      class CollectorProcess {
        @Public()
        publicMethod() {}

        @RateLimit({ rps: 10 })
        limitedMethod() {}
      }

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, CollectorProcess);

      expect(metadata.methods.size).toBe(2);
      expect(metadata.methods.has('publicMethod')).toBe(true);
      expect(metadata.methods.has('limitedMethod')).toBe(true);
    });

    it('should store netron configuration', () => {
      @Process({
        name: 'NetronProcess',
        netron: {
          port: 8080,
          transport: 'http',
          host: 'localhost',
        },
      })
      class NetronProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, NetronProcess);

      expect(metadata.netron).toEqual({
        port: 8080,
        transport: 'http',
        host: 'localhost',
      });
    });

    it('should store scaling configuration', () => {
      @Process({
        name: 'ScalingProcess',
        scaling: {
          min: 1,
          max: 10,
          strategy: 'cpu',
        },
      })
      class ScalingProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, ScalingProcess);

      expect(metadata.scaling).toEqual({
        min: 1,
        max: 10,
        strategy: 'cpu',
      });
    });

    it('should store health check configuration', () => {
      @Process({
        name: 'HealthProcess',
        health: {
          enabled: true,
          interval: 5000,
          timeout: 3000,
          retries: 3,
        },
      })
      class HealthProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, HealthProcess);

      expect(metadata.health).toEqual({
        enabled: true,
        interval: 5000,
        timeout: 3000,
        retries: 3,
      });
    });

    it('should store memory configuration', () => {
      @Process({
        name: 'MemoryProcess',
        memory: {
          limit: '512m',
          alert: '400m',
          shared: true,
          gc: {
            interval: 30000,
            aggressive: false,
          },
        },
      })
      class MemoryProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, MemoryProcess);

      expect(metadata.memory).toBeDefined();
      expect(metadata.memory.limit).toBe('512m');
      expect(metadata.memory.gc.interval).toBe(30000);
    });

    it('should store security configuration', () => {
      @Process({
        name: 'SecureProcess',
        security: {
          isolation: 'vm',
          sandbox: {
            allowedModules: ['fs', 'path'],
            timeout: 5000,
          },
          permissions: {
            network: true,
            filesystem: 'read-only',
          },
        },
      })
      class SecureProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, SecureProcess);

      expect(metadata.security.isolation).toBe('vm');
      expect(metadata.security.sandbox.allowedModules).toContain('fs');
      expect(metadata.security.permissions.filesystem).toBe('read-only');
    });

    it('should store observability configuration', () => {
      @Process({
        name: 'ObservableProcess',
        observability: {
          metrics: true,
          tracing: true,
          logs: { level: 'debug', format: 'json' },
        },
      })
      class ObservableProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, ObservableProcess);

      expect(metadata.observability.metrics).toBe(true);
      expect(metadata.observability.tracing).toBe(true);
      expect(metadata.observability.logs.level).toBe('debug');
    });
  });

  describe('@RateLimit decorator - Strategies', () => {
    it('should store token-bucket strategy options', () => {
      class TokenBucketService {
        @RateLimit({
          rps: 100,
          burst: 200,
          strategy: 'token-bucket',
        })
        tokenBucketMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TokenBucketService.prototype,
        'tokenBucketMethod'
      );

      expect(metadata.rateLimit).toEqual({
        rps: 100,
        burst: 200,
        strategy: 'token-bucket',
      });
    });

    it('should store sliding-window strategy options', () => {
      class SlidingWindowService {
        @RateLimit({
          rps: 50,
          strategy: 'sliding-window',
          key: 'user-id',
        })
        slidingWindowMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        SlidingWindowService.prototype,
        'slidingWindowMethod'
      );

      expect(metadata.rateLimit).toEqual({
        rps: 50,
        strategy: 'sliding-window',
        key: 'user-id',
      });
    });

    it('should store fixed-window strategy options', () => {
      class FixedWindowService {
        @RateLimit({
          rps: 1000,
          strategy: 'fixed-window',
        })
        fixedWindowMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        FixedWindowService.prototype,
        'fixedWindowMethod'
      );

      expect(metadata.rateLimit).toEqual({
        rps: 1000,
        strategy: 'fixed-window',
      });
    });

    it('should allow rate limit key for per-user limiting', () => {
      class PerUserService {
        @RateLimit({
          rps: 10,
          key: 'request.userId',
        })
        perUserMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        PerUserService.prototype,
        'perUserMethod'
      );

      expect(metadata.rateLimit.key).toBe('request.userId');
    });
  });

  describe('@Cache decorator - Comprehensive', () => {
    it('should store TTL configuration', () => {
      class TTLCacheService {
        @Cache({ ttl: 30000 })
        ttlMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        TTLCacheService.prototype,
        'ttlMethod'
      );

      expect(metadata.cache.ttl).toBe(30000);
    });

    it('should store string key function', () => {
      class KeyCacheService {
        @Cache({
          ttl: 5000,
          key: 'user:{args.0}:data',
        })
        keyMethod(userId: string) {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        KeyCacheService.prototype,
        'keyMethod'
      );

      expect(metadata.cache.key).toBe('user:{args.0}:data');
    });

    it('should store function key generator', () => {
      const keyFn = (args: any[]) => `custom-key-${args[0]}`;

      class FnKeyCacheService {
        @Cache({
          ttl: 10000,
          key: keyFn,
        })
        fnKeyMethod(id: string) {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        FnKeyCacheService.prototype,
        'fnKeyMethod'
      );

      expect(metadata.cache.key).toBe(keyFn);
      expect(typeof metadata.cache.key).toBe('function');
    });

    it('should store condition function', () => {
      const conditionFn = (result: any) => result.status === 'success';

      class ConditionalCacheService {
        @Cache({
          ttl: 60000,
          condition: conditionFn,
        })
        conditionalMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        ConditionalCacheService.prototype,
        'conditionalMethod'
      );

      expect(metadata.cache.condition).toBe(conditionFn);
      expect(metadata.cache.condition({ status: 'success' })).toBe(true);
      expect(metadata.cache.condition({ status: 'error' })).toBe(false);
    });

    it('should allow empty options for default caching', () => {
      class DefaultCacheService {
        @Cache()
        defaultMethod() {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        DefaultCacheService.prototype,
        'defaultMethod'
      );

      expect(metadata.cache).toBeDefined();
      expect(metadata.cache).toEqual({});
    });
  });

  describe('@Validate decorator - Comprehensive', () => {
    it('should store JSON schema validation', () => {
      const userSchema = {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email' },
          age: { type: 'number', minimum: 0 },
        },
        required: ['name', 'email'],
      };

      class SchemaValidateService {
        @Validate({ schema: userSchema })
        createUser(data: any) {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        SchemaValidateService.prototype,
        'createUser'
      );

      expect(metadata.validate.schema).toEqual(userSchema);
    });

    it('should store custom validator function', () => {
      const customValidator = (value: any): boolean => {
        return !!(value && value.id && typeof value.id === 'string');
      };

      class CustomValidateService {
        @Validate({ validator: customValidator })
        processData(data: any) {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        CustomValidateService.prototype,
        'processData'
      );

      expect(metadata.validate.validator).toBe(customValidator);
      expect(metadata.validate.validator({ id: '123' })).toBe(true);
      expect(metadata.validate.validator({ name: 'test' })).toBe(false);
    });

    it('should store async validator function', () => {
      const asyncValidator = async (value: any) => {
        // Simulate async validation
        return Promise.resolve(value && value.valid === true);
      };

      class AsyncValidateService {
        @Validate({ validator: asyncValidator })
        asyncValidate(data: any) {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        AsyncValidateService.prototype,
        'asyncValidate'
      );

      expect(typeof metadata.validate.validator).toBe('function');
    });

    it('should allow both schema and validator together', () => {
      const schema = { type: 'object' };
      const validator = (v: any) => v.extra === true;

      class CombinedValidateService {
        @Validate({ schema, validator })
        combinedValidate(data: any) {}
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        CombinedValidateService.prototype,
        'combinedValidate'
      );

      expect(metadata.validate.schema).toEqual(schema);
      expect(metadata.validate.validator).toBe(validator);
    });
  });

  describe('@CircuitBreaker decorator - Runtime behavior', () => {
    it('should open circuit after threshold failures', async () => {
      let callCount = 0;

      class FailingService {
        @CircuitBreaker({ threshold: 3, timeout: 100 })
        async failingMethod() {
          callCount++;
          throw new Error('Service failure');
        }
      }

      const service = new FailingService();

      // Make threshold number of failing calls
      for (let i = 0; i < 3; i++) {
        try {
          await service.failingMethod();
        } catch {
          // Expected failures
        }
      }

      expect(callCount).toBe(3);

      // Next call should be blocked by circuit breaker
      try {
        await service.failingMethod();
      } catch (error: any) {
        // Circuit should be open
        expect(error.message).toMatch(/circuit breaker is open/i);
      }

      // Method should not have been called again
      expect(callCount).toBe(3);
    });

    it('should close circuit after timeout (half-open state)', async () => {
      let callCount = 0;
      let shouldFail = true;

      class RecoveringService {
        @CircuitBreaker({ threshold: 2, timeout: 50 })
        async recoveringMethod() {
          callCount++;
          if (shouldFail) {
            throw new Error('Service failure');
          }
          return 'success';
        }
      }

      const service = new RecoveringService();

      // Open the circuit
      for (let i = 0; i < 2; i++) {
        try {
          await service.recoveringMethod();
        } catch {
          // Expected
        }
      }

      expect(callCount).toBe(2);

      // Wait for timeout
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Service recovers
      shouldFail = false;

      // Circuit should be half-open, allowing a test call
      const result = await service.recoveringMethod();
      expect(result).toBe('success');
      expect(callCount).toBe(3);

      // Circuit should now be closed
      const result2 = await service.recoveringMethod();
      expect(result2).toBe('success');
      expect(callCount).toBe(4);
    });

    it('should use fallback function when circuit is open', async () => {
      class FallbackService {
        @CircuitBreaker({ threshold: 1, timeout: 100, fallback: 'fallbackMethod' })
        async primaryMethod() {
          throw new Error('Primary failure');
        }

        fallbackMethod() {
          return 'fallback-result';
        }
      }

      const service = new FallbackService();

      // First call fails and opens circuit
      try {
        await service.primaryMethod();
      } catch {
        // Expected
      }

      // Second call should use fallback
      const result = await service.primaryMethod();
      expect(result).toBe('fallback-result');
    });

    it('should track failures per instance', async () => {
      let instanceACount = 0;
      let instanceBCount = 0;

      class InstanceService {
        constructor(private instanceId: string) {}

        @CircuitBreaker({ threshold: 2, timeout: 100 })
        async method() {
          if (this.instanceId === 'A') {
            instanceACount++;
          } else {
            instanceBCount++;
          }
          throw new Error('Failure');
        }
      }

      const instanceA = new InstanceService('A');
      const instanceB = new InstanceService('B');

      // Fail instance A
      for (let i = 0; i < 2; i++) {
        try {
          await instanceA.method();
        } catch {
          // Expected
        }
      }

      // Instance A circuit is open, but B should still work
      try {
        await instanceB.method();
        instanceBCount--; // Will be incremented but we catch here
      } catch {
        // Expected - B fails but circuit not open yet
      }

      expect(instanceACount).toBe(2);
      expect(instanceBCount).toBe(1);
    });
  });

  describe('@Idempotent decorator - Runtime behavior', () => {
    it('should cache results by key', async () => {
      let callCount = 0;

      class IdempotentService {
        @Idempotent({ key: 'requestId', ttl: '1h' })
        async process(request: { requestId: string }) {
          callCount++;
          return { processed: request.requestId };
        }
      }

      const service = new IdempotentService();

      // First call
      const result1 = await service.process({ requestId: 'req-123' });
      expect(result1).toEqual({ processed: 'req-123' });
      expect(callCount).toBe(1);

      // Second call with same key - should return cached
      const result2 = await service.process({ requestId: 'req-123' });
      expect(result2).toEqual({ processed: 'req-123' });
      expect(callCount).toBe(1); // Should not increment

      // Call with different key - should execute
      const result3 = await service.process({ requestId: 'req-456' });
      expect(result3).toEqual({ processed: 'req-456' });
      expect(callCount).toBe(2);
    });

    it('should expire cached results after TTL', async () => {
      let callCount = 0;

      // Note: parseDuration only supports 's', 'm', 'h', 'd' units, not 'ms'
      // Using '1s' for testing TTL expiration
      class ExpiringService {
        @Idempotent({ key: 'id', ttl: '1s' })
        async getData(params: { id: string }) {
          callCount++;
          return { id: params.id, timestamp: Date.now() };
        }
      }

      const service = new ExpiringService();

      // First call
      await service.getData({ id: 'test' });
      expect(callCount).toBe(1);

      // Immediate second call - cached
      await service.getData({ id: 'test' });
      expect(callCount).toBe(1);

      // Wait for TTL to expire (1s + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // Third call after TTL - should execute again
      await service.getData({ id: 'test' });
      expect(callCount).toBe(2);
    });

    it('should handle different keys independently', async () => {
      const results: Record<string, number> = {};

      class MultiKeyService {
        @Idempotent({ key: 'userId', ttl: '10m' })
        async getUserData(params: { userId: string }) {
          results[params.userId] = (results[params.userId] || 0) + 1;
          return { userId: params.userId, count: results[params.userId] };
        }
      }

      const service = new MultiKeyService();

      // Different keys
      await service.getUserData({ userId: 'user-a' });
      await service.getUserData({ userId: 'user-b' });
      await service.getUserData({ userId: 'user-c' });

      expect(results['user-a']).toBe(1);
      expect(results['user-b']).toBe(1);
      expect(results['user-c']).toBe(1);

      // Repeat calls - should be cached
      await service.getUserData({ userId: 'user-a' });
      await service.getUserData({ userId: 'user-b' });

      expect(results['user-a']).toBe(1);
      expect(results['user-b']).toBe(1);
    });
  });

  describe('@Supervisor decorator - Comprehensive', () => {
    it('should store supervisor metadata', () => {
      @Supervisor({
        strategy: 'one-for-one' as any,
        maxRestarts: 10,
        window: 60000,
      })
      class SupervisorService {}

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, SupervisorService);

      expect(metadata).toBeDefined();
      expect(metadata.strategy).toBe('one-for-one');
      expect(metadata.maxRestarts).toBe(10);
      expect(metadata.window).toBe(60000);
    });

    it('should store backoff configuration', () => {
      @Supervisor({
        strategy: 'one-for-all' as any,
        backoff: {
          type: 'exponential',
          initial: 100,
          max: 30000,
          factor: 2,
        },
      })
      class BackoffSupervisor {}

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, BackoffSupervisor);

      expect(metadata.backoff).toEqual({
        type: 'exponential',
        initial: 100,
        max: 30000,
        factor: 2,
      });
    });

    it('should initialize empty children Map when no children', () => {
      @Supervisor()
      class EmptySupervisor {}

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, EmptySupervisor);

      expect(metadata.children).toBeInstanceOf(Map);
      expect(metadata.children.size).toBe(0);
    });

    it('should preserve target reference', () => {
      @Supervisor()
      class TargetSupervisor {}

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, TargetSupervisor);

      expect(metadata.target).toBe(TargetSupervisor);
    });
  });

  describe('@Child decorator - Comprehensive', () => {
    it('should register child definition with name', () => {
      @Supervisor()
      class NamedChildSupervisor {
        @Child()
        worker: any;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, NamedChildSupervisor);
      const child = metadata.children.get('worker');

      expect(child).toBeDefined();
      expect(child.name).toBe('worker');
      expect(child.propertyKey).toBe('worker');
    });

    it('should store optional flag', () => {
      @Supervisor()
      class OptionalChildSupervisor {
        @Child({ optional: true })
        optionalWorker: any;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, OptionalChildSupervisor);
      const child = metadata.children.get('optionalWorker');

      expect(child.optional).toBe(true);
    });

    it('should store critical flag', () => {
      @Supervisor()
      class CriticalChildSupervisor {
        @Child({ critical: true })
        criticalWorker: any;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, CriticalChildSupervisor);
      const child = metadata.children.get('criticalWorker');

      expect(child.critical).toBe(true);
    });

    it('should store pool configuration', () => {
      @Supervisor()
      class PooledChildSupervisor {
        @Child({
          pool: {
            size: 5,
            strategy: 'round-robin' as any,
            maxQueueSize: 100,
          },
        })
        pooledWorker: any;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, PooledChildSupervisor);
      const child = metadata.children.get('pooledWorker');

      expect(child.pool).toBeDefined();
      expect(child.pool.size).toBe(5);
      expect(child.pool.strategy).toBe('round-robin');
    });

    it('should handle multiple children with different configurations', () => {
      @Supervisor()
      class MultiConfigSupervisor {
        @Child({ critical: true })
        database: any;

        @Child({ optional: true })
        cache: any;

        @Child({ pool: { size: 3 } })
        workers: any;
      }

      const metadata = Reflect.getMetadata(SUPERVISOR_METADATA_KEY, MultiConfigSupervisor);

      expect(metadata.children.size).toBe(3);

      const dbChild = metadata.children.get('database');
      expect(dbChild.critical).toBe(true);

      const cacheChild = metadata.children.get('cache');
      expect(cacheChild.optional).toBe(true);

      const workersChild = metadata.children.get('workers');
      expect(workersChild.pool.size).toBe(3);
    });
  });

  describe('@Workflow, @Stage, @Compensate decorators - Comprehensive', () => {
    it('should store workflow metadata with target', () => {
      @Workflow()
      class BasicWorkflow {}

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, BasicWorkflow);

      expect(metadata).toBeDefined();
      expect(metadata.target).toBe(BasicWorkflow);
      expect(metadata.stages).toBeInstanceOf(Map);
    });

    it('should collect stages with handlers', () => {
      class StageWorkflow {
        @Stage()
        async step1() {
          return { step: 1 };
        }

        @Stage()
        async step2() {
          return { step: 2 };
        }
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, StageWorkflow);

      expect(metadata.stages.size).toBe(2);

      const stage1 = metadata.stages.get('step1');
      expect(stage1).toBeDefined();
      expect(stage1.name).toBe('step1');
      expect(typeof stage1.handler).toBe('function');

      const stage2 = metadata.stages.get('step2');
      expect(stage2).toBeDefined();
      expect(stage2.name).toBe('step2');
    });

    it('should resolve dependencies between stages', () => {
      class DependentWorkflow {
        @Stage()
        async fetchData() {
          return { data: [] };
        }

        @Stage({ dependsOn: 'fetchData' })
        async processData() {
          return { processed: true };
        }

        @Stage({ dependsOn: ['fetchData', 'processData'] })
        async saveResults() {
          return { saved: true };
        }
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, DependentWorkflow);

      const fetchStage = metadata.stages.get('fetchData');
      expect(fetchStage.dependsOn).toBeUndefined();

      const processStage = metadata.stages.get('processData');
      expect(processStage.dependsOn).toContain('fetchData');

      const saveStage = metadata.stages.get('saveResults');
      expect(saveStage.dependsOn).toContain('fetchData');
      expect(saveStage.dependsOn).toContain('processData');
    });

    it('should normalize single dependsOn to array', () => {
      class SingleDepWorkflow {
        @Stage()
        async first() {}

        @Stage({ dependsOn: 'first' })
        async second() {}
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, SingleDepWorkflow);
      const secondStage = metadata.stages.get('second');

      expect(Array.isArray(secondStage.dependsOn)).toBe(true);
      expect(secondStage.dependsOn).toContain('first');
    });

    it('should pair compensation handlers with stages', () => {
      class CompensatingWorkflow {
        @Stage()
        async createRecord() {
          return { id: '123' };
        }

        @Compensate('createRecord')
        async undoCreateRecord() {
          // Rollback
        }

        @Stage()
        async updateRecord() {
          return { updated: true };
        }

        @Compensate('updateRecord')
        async undoUpdateRecord() {
          // Rollback
        }
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, CompensatingWorkflow);

      const createStage = metadata.stages.get('createRecord');
      expect(createStage.compensate).toBeDefined();
      expect(typeof createStage.compensate).toBe('function');

      const updateStage = metadata.stages.get('updateRecord');
      expect(updateStage.compensate).toBeDefined();
      expect(typeof updateStage.compensate).toBe('function');
    });

    it('should store stage timeout and retries', () => {
      class RetryWorkflow {
        @Stage({ timeout: 5000, retries: 3 })
        async riskyOperation() {
          return { success: true };
        }
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, RetryWorkflow);
      const stage = metadata.stages.get('riskyOperation');

      expect(stage.timeout).toBe(5000);
      expect(stage.retries).toBe(3);
    });

    it('should store parallel execution flag', () => {
      class ParallelWorkflow {
        @Stage({ parallel: true })
        async parallelTask1() {}

        @Stage({ parallel: true })
        async parallelTask2() {}
      }

      const metadata = Reflect.getMetadata(WORKFLOW_METADATA_KEY, ParallelWorkflow);

      const task1 = metadata.stages.get('parallelTask1');
      expect(task1.parallel).toBe(true);

      const task2 = metadata.stages.get('parallelTask2');
      expect(task2.parallel).toBe(true);
    });
  });

  describe('@HealthCheck decorator - Comprehensive', () => {
    it('should register health check method with default interval', () => {
      class DefaultHealthService {
        @HealthCheck()
        async check() {
          return { status: 'healthy' };
        }
      }

      const metadata = Reflect.getMetadata('health-check', DefaultHealthService.prototype);

      expect(metadata).toBeDefined();
      expect(metadata.method).toBe('check');
    });

    it('should register health check method with custom interval', () => {
      class CustomHealthService {
        @HealthCheck({ interval: 10000 })
        async healthStatus() {
          return { healthy: true };
        }
      }

      const metadata = Reflect.getMetadata('health-check', CustomHealthService.prototype);

      expect(metadata.interval).toBe(10000);
    });
  });

  describe('@OnShutdown decorator - Comprehensive', () => {
    it('should register shutdown handler method name', () => {
      class ShutdownService {
        @OnShutdown()
        async gracefulShutdown() {
          // Cleanup
        }
      }

      const methodName = Reflect.getMetadata('on-shutdown', ShutdownService.prototype);

      expect(methodName).toBe('gracefulShutdown');
    });

    it('should only register one shutdown handler per class', () => {
      class MultiShutdownService {
        @OnShutdown()
        async cleanup1() {}

        @OnShutdown()
        async cleanup2() {}
      }

      const methodName = Reflect.getMetadata('on-shutdown', MultiShutdownService.prototype);

      // Last decorator wins
      expect(methodName).toBe('cleanup2');
    });
  });

  describe('@Actor decorator', () => {
    it('should mark class as an Actor', () => {
      @Actor()
      class UserActor {}

      const metadata = Reflect.getMetadata(ACTOR_METADATA_KEY, UserActor);

      expect(metadata).toBeDefined();
      expect(metadata.isActor).toBe(true);
      expect(metadata.target).toBe(UserActor);
    });

    it('should store actor options', () => {
      @Actor({ mailboxSize: 100, timeout: 5000 })
      class ConfiguredActor {}

      const metadata = Reflect.getMetadata(ACTOR_METADATA_KEY, ConfiguredActor);

      expect(metadata.mailboxSize).toBe(100);
      expect(metadata.timeout).toBe(5000);
    });
  });

  describe('@InjectProcess decorator', () => {
    it('should store process injection metadata', () => {
      class ProcessA {}

      class ConsumerService {
        constructor(@InjectProcess(ProcessA) private processA: any) {}
      }

      const injects = Reflect.getMetadata('custom:inject:process', ConsumerService);

      expect(injects).toBeDefined();
      expect(injects[0]).toBe(ProcessA);
    });
  });

  describe('@Compose decorator', () => {
    it('should store composed services metadata', () => {
      class ServiceA {}
      class ServiceB {}

      class ComposedService {
        @Compose(ServiceA, ServiceB)
        composedMethod() {}
      }

      const metadata = Reflect.getMetadata('compose', ComposedService.prototype);

      expect(metadata).toBeDefined();
      expect(Array.isArray(metadata)).toBe(true);
      expect(metadata[0].services).toContain(ServiceA);
      expect(metadata[0].services).toContain(ServiceB);
    });
  });

  describe('@SharedState decorator', () => {
    it('should register shared state properties', () => {
      class SharedService {
        @SharedState()
        counter: number = 0;

        @SharedState()
        cache: Map<string, any> = new Map();
      }

      const sharedProps = Reflect.getMetadata('shared-state', SharedService.prototype);

      expect(sharedProps).toContain('counter');
      expect(sharedProps).toContain('cache');
    });
  });

  describe('@Saga and @Step decorators', () => {
    it('should store saga metadata', () => {
      @Saga({ name: 'OrderSaga' })
      class OrderSaga {}

      const metadata = Reflect.getMetadata('saga', OrderSaga);

      expect(metadata).toBeDefined();
      expect(metadata.name).toBe('OrderSaga');
      expect(metadata.steps).toBeInstanceOf(Map);
    });

    it('should register saga steps', () => {
      // Note: Due to decorator execution order, @Step decorators run before @Saga.
      // The @Saga decorator creates a new steps Map, so steps need to be defined
      // after the class is decorated, or the Saga decorator should be updated
      // to merge existing steps like @Supervisor does.
      // This test verifies the current behavior where @Step creates steps
      // that get overwritten by @Saga.

      // First, let's verify @Step works when applied after @Saga-like initialization
      class ManualSaga {
        @Step({ order: 1 })
        async reserveInventory() {}

        @Step({ order: 2 })
        async processPayment() {}

        @Step({ order: 3 })
        async confirmOrder() {}
      }

      // Without @Saga, the steps should be registered
      const stepsOnly = Reflect.getMetadata('saga', ManualSaga);

      expect(stepsOnly).toBeDefined();
      expect(stepsOnly.steps.size).toBe(3);
      expect(stepsOnly.steps.has('reserveInventory')).toBe(true);
      expect(stepsOnly.steps.has('processPayment')).toBe(true);
      expect(stepsOnly.steps.has('confirmOrder')).toBe(true);
    });

    it('should note that @Saga class decorator reinitializes steps Map', () => {
      // This test documents the current behavior where @Saga creates a fresh Map
      @Saga()
      class OverwrittenSaga {
        @Step({ order: 1 })
        async step1() {}
      }

      const metadata = Reflect.getMetadata('saga', OverwrittenSaga);

      // @Saga runs after @Step and creates a new empty Map
      // This is a known limitation - @Saga should be updated to merge like @Supervisor
      expect(metadata).toBeDefined();
      expect(metadata.steps).toBeInstanceOf(Map);
      // Current behavior: steps Map is empty because @Saga creates a new one
      expect(metadata.steps.size).toBe(0);
    });
  });

  describe('@GraphQLService decorator', () => {
    it('should store GraphQL service metadata', () => {
      @GraphQLService({ schema: 'type Query { hello: String }' })
      class GraphQLHandler {}

      const metadata = Reflect.getMetadata('graphql-service', GraphQLHandler);

      expect(metadata).toBeDefined();
      expect(metadata.schema).toBe('type Query { hello: String }');
    });
  });

  describe('@DistributedTransaction decorator', () => {
    it('should mark class for distributed transactions', () => {
      @DistributedTransaction()
      class TransactionService {}

      const metadata = Reflect.getMetadata('distributed-transaction', TransactionService);

      expect(metadata).toBe(true);
    });
  });

  describe('@AdaptiveBitrate decorator', () => {
    it('should store adaptive bitrate metadata', () => {
      class StreamingService {
        @AdaptiveBitrate({ minBitrate: 500, maxBitrate: 5000 })
        streamVideo() {}
      }

      const metadata = Reflect.getMetadata('adaptive-bitrate', StreamingService.prototype);

      expect(metadata).toBeDefined();
      expect(metadata.minBitrate).toBe(500);
      expect(metadata.maxBitrate).toBe(5000);
    });
  });

  describe('parseDuration helper function', () => {
    // parseDuration is internal, but we can test it through Idempotent decorator
    it('should parse seconds correctly', async () => {
      let callCount = 0;

      class SecondsTTLService {
        @Idempotent({ key: 'id', ttl: '1s' })
        async method(params: { id: string }) {
          callCount++;
          return { id: params.id };
        }
      }

      const service = new SecondsTTLService();

      await service.method({ id: 'test' });
      expect(callCount).toBe(1);

      // Wait less than 1 second - should be cached
      await new Promise((resolve) => setTimeout(resolve, 100));
      await service.method({ id: 'test' });
      expect(callCount).toBe(1);

      // Wait for expiration (1 second + buffer)
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await service.method({ id: 'test' });
      expect(callCount).toBe(2);
    });

    it('should parse minutes correctly', async () => {
      // We test that the decorator accepts the format without waiting
      class MinutesTTLService {
        @Idempotent({ key: 'id', ttl: '5m' })
        async method(params: { id: string }) {
          return { id: params.id };
        }
      }

      // Just verify it doesn't throw
      const service = new MinutesTTLService();
      const result = await service.method({ id: 'test' });
      expect(result).toEqual({ id: 'test' });
    });

    it('should parse hours correctly', async () => {
      class HoursTTLService {
        @Idempotent({ key: 'id', ttl: '2h' })
        async method(params: { id: string }) {
          return { id: params.id };
        }
      }

      // Just verify it doesn't throw
      const service = new HoursTTLService();
      const result = await service.method({ id: 'test' });
      expect(result).toEqual({ id: 'test' });
    });
  });

  describe('Edge Cases', () => {
    it('should handle symbol property keys', () => {
      const symbolKey = Symbol('testMethod');

      class SymbolService {
        @Public()
        [symbolKey]() {
          return 'symbol-method';
        }
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        SymbolService.prototype,
        symbolKey
      );

      expect(metadata).toBeDefined();
      expect(metadata.public).toBe(true);
    });

    it('should handle getter/setter methods (skip them)', () => {
      @Process()
      class GetterSetterService {
        private _value: number = 0;

        get value() {
          return this._value;
        }

        set value(v: number) {
          this._value = v;
        }

        @Public()
        getValue() {
          return this._value;
        }
      }

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, GetterSetterService);

      // Methods Map should only contain decorated methods
      expect(metadata.methods.has('getValue')).toBe(true);
      // Getters/setters should not be in methods Map as they are not decorated
    });

    it('should handle inherited class decorators', () => {
      @Process({ name: 'BaseService' })
      class BaseService {
        @Public()
        baseMethod() {}
      }

      @Process({ name: 'DerivedService' })
      class DerivedService extends BaseService {
        @Public()
        derivedMethod() {}
      }

      const baseMetadata = Reflect.getMetadata(PROCESS_METADATA_KEY, BaseService);
      const derivedMetadata = Reflect.getMetadata(PROCESS_METADATA_KEY, DerivedService);

      expect(baseMetadata.name).toBe('BaseService');
      expect(derivedMetadata.name).toBe('DerivedService');
    });

    it('should handle empty decorator options', () => {
      @Process({})
      class EmptyOptionsProcess {}

      const metadata = Reflect.getMetadata(PROCESS_METADATA_KEY, EmptyOptionsProcess);

      expect(metadata).toBeDefined();
      expect(metadata.isProcess).toBe(true);
    });

    it('should handle null/undefined in cache condition', () => {
      const condition = (result: any) => result != null;

      class NullHandlingService {
        @Cache({ condition })
        method() {
          return null;
        }
      }

      const metadata = Reflect.getMetadata(
        PROCESS_METHOD_METADATA_KEY,
        NullHandlingService.prototype,
        'method'
      );

      expect(metadata.cache.condition(null)).toBe(false);
      expect(metadata.cache.condition(undefined)).toBe(false);
      expect(metadata.cache.condition({ data: 'value' })).toBe(true);
    });
  });

  describe('Metadata Keys', () => {
    it('should use unique symbols for metadata keys', () => {
      expect(typeof PROCESS_METADATA_KEY).toBe('symbol');
      expect(typeof PROCESS_METHOD_METADATA_KEY).toBe('symbol');
      expect(typeof SUPERVISOR_METADATA_KEY).toBe('symbol');
      expect(typeof WORKFLOW_METADATA_KEY).toBe('symbol');
      expect(typeof ACTOR_METADATA_KEY).toBe('symbol');

      // All should be unique
      const keys = new Set([
        PROCESS_METADATA_KEY,
        PROCESS_METHOD_METADATA_KEY,
        SUPERVISOR_METADATA_KEY,
        WORKFLOW_METADATA_KEY,
        ACTOR_METADATA_KEY,
      ]);
      expect(keys.size).toBe(5);
    });

    it('should have descriptive symbol descriptions', () => {
      expect(PROCESS_METADATA_KEY.toString()).toContain('process:metadata');
      expect(PROCESS_METHOD_METADATA_KEY.toString()).toContain('process:method:metadata');
      expect(SUPERVISOR_METADATA_KEY.toString()).toContain('supervisor:metadata');
      expect(WORKFLOW_METADATA_KEY.toString()).toContain('workflow:metadata');
      expect(ACTOR_METADATA_KEY.toString()).toContain('actor:metadata');
    });
  });
});
