/**
 * Test Fixtures
 *
 * Reusable test data and configurations
 */

import { z } from 'zod';
import { Module, Injectable } from '../decorators/index.js';
import type { IConfigModuleOptions as ConfigModuleOptions } from '../modules/config/types.js';
import type { RedisOptions } from 'ioredis';

/**
 * Test schemas for configuration
 */
export const TestSchemas = {
  AppConfig: z.object({
    app: z.object({
      name: z.string(),
      port: z.number(),
      version: z.string().optional(),
    }),
  }),

  DatabaseConfig: z.object({
    database: z.object({
      host: z.string(),
      port: z.number(),
      name: z.string(),
      user: z.string().optional(),
      password: z.string().optional(),
    }),
  }),

  RedisConfig: z.object({
    redis: z.object({
      host: z.string(),
      port: z.number(),
      password: z.string().optional(),
      db: z.number().optional(),
    }),
  }),

  FullConfig: z.object({
    app: z.object({
      name: z.string(),
      port: z.number(),
      version: z.string().optional(),
    }),
    database: z.object({
      host: z.string(),
      port: z.number(),
      name: z.string(),
    }),
    redis: z.object({
      host: z.string(),
      port: z.number(),
    }),
  }),
};

/**
 * Test configuration fixtures
 */
export const TestConfigs = {
  minimal: {
    sources: [
      {
        type: 'object' as const,
        data: {
          app: {
            name: 'test',
            port: 3000,
          },
        },
      },
    ],
  } as ConfigModuleOptions,

  standard: {
    sources: [
      {
        type: 'object' as const,
        data: {
          app: {
            name: 'test-app',
            port: 3000,
            version: '1.0.0',
          },
          database: {
            host: 'localhost',
            port: 5432,
            name: 'testdb',
          },
          redis: {
            host: 'localhost',
            port: 6379,
          },
        },
      },
    ],
  } as ConfigModuleOptions,

  withEnv: {
    sources: [
      {
        type: 'object' as const,
        data: {
          app: {
            name: 'default-app',
            port: 3000,
          },
        },
      },
      {
        type: 'env' as const,
        prefix: 'TEST_',
        separator: '__',
      },
    ],
  } as ConfigModuleOptions,

  withValidation: {
    schema: TestSchemas.FullConfig,
    sources: [
      {
        type: 'object' as const,
        data: {
          app: {
            name: 'validated-app',
            port: 3000,
            version: '2.0.0',
          },
          database: {
            host: 'localhost',
            port: 5432,
            name: 'validdb',
          },
          redis: {
            host: 'localhost',
            port: 6379,
          },
        },
      },
    ],
    validateOnStartup: true,
  } as ConfigModuleOptions,
};

/**
 * Test Redis configurations
 */
export const TestRedisConfigs = {
  local: {
    host: 'localhost',
    port: 6379,
    retryStrategy: () => null, // Disable retries in tests
    maxRetriesPerRequest: 1,
    enableReadyCheck: false,
    lazyConnect: true,
  } as RedisOptions,

  cluster: [
    { host: 'localhost', port: 7000 },
    { host: 'localhost', port: 7001 },
    { host: 'localhost', port: 7002 },
  ],

  sentinel: {
    sentinels: [
      { host: 'localhost', port: 26379 },
      { host: 'localhost', port: 26380 },
    ],
    name: 'mymaster',
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  } as RedisOptions,
};

/**
 * Test module definitions
 */
export const TestModules = {
  /**
   * Create a simple test module
   */
  createSimple: (name: string, providers: any[] = []) => {
    @Module({
      providers,
      exports: providers.map(p => (Array.isArray(p) ? p[0] : p)),
    })
    class TestModule {
      static __name = name;
    }

    return TestModule;
  },

  /**
   * Create a test service
   */
  createService: (name: string, methods: Record<string, any> = {}) => {
    @Injectable()
    class TestService {
      static __name = name;

      constructor() {
        Object.assign(this, methods);
      }
    }

    return TestService;
  },
};

/**
 * Test data generators
 */
export const TestData = {
  /**
   * Generate random string
   */
  randomString: (length = 10): string => {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
    return result;
  },

  /**
   * Generate random port number
   */
  randomPort: (): number => Math.floor(Math.random() * (65535 - 1024) + 1024),

  /**
   * Generate test user object
   */
  user: (overrides = {}) => ({
    id: TestData.randomString(),
    name: 'Test User',
    email: 'test@example.com',
    createdAt: new Date(),
    ...overrides,
  }),

  /**
   * Generate test task object
   */
  task: (overrides = {}) => ({
    id: TestData.randomString(),
    title: 'Test Task',
    description: 'Test Description',
    status: 'pending',
    priority: 'medium',
    createdAt: new Date(),
    ...overrides,
  }),
};

/**
 * Test timing utilities
 */
export const TestTiming = {
  /**
   * Short delay for immediate async operations
   */
  IMMEDIATE: 0,

  /**
   * Minimal delay for fast async operations
   */
  MINIMAL: 10,

  /**
   * Short delay for quick operations
   */
  SHORT: 50,

  /**
   * Standard delay for most operations
   */
  STANDARD: 100,

  /**
   * Long delay for slow operations
   */
  LONG: 500,

  /**
   * Very long delay for very slow operations
   */
  VERY_LONG: 1000,

  /**
   * Default timeout for async operations
   */
  DEFAULT_TIMEOUT: 5000,

  /**
   * Extended timeout for slow operations
   */
  EXTENDED_TIMEOUT: 10000,
};