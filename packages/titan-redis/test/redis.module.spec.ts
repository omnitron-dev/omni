/**
 * Tests for TitanRedisModule
 *
 * Tests module creation, provider registration, and client initialization
 * without any NestJS dependencies
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { Container, Provider, ProviderInput, ServiceIdentifier } from '@omnitron-dev/titan/nexus';
import { TitanRedisModule } from '../src/redis.module.js';
import { RedisService } from '../src/redis.service.js';
import { RedisManager } from '../src/redis.manager.js';
import { RedisHealthIndicator } from '../src/redis.health.js';
import { REDIS_MANAGER, getRedisClientToken } from '../src/redis.constants.js';
import { RedisModuleOptions } from '../src/redis.types.js';
import { createMockRedisClient, createMockLogger } from '@omnitron-dev/testing/titan';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';

// Mock redis.utils to use mock clients
vi.mock('../../../src/modules/redis/redis.utils.js', () => ({
  createRedisClient: vi.fn(() => createMockRedisClient()),
  waitForConnection: vi.fn(async () => {}),
  mergeOptions: vi.fn((a, b) => ({ ...a, ...b })),
  getClientNamespace: vi.fn((client, fallback = 'default') => client?.namespace || fallback),
  createRetryStrategy: vi.fn(() => (times: number) => Math.min(times * 50, 2000)),
  generateScriptSha: vi.fn((content: string) => 'mock-sha'),
  loadScriptContent: vi.fn(() => 'mock-script'),
}));

/**
 * Configuration object type for async factory
 */
interface RedisConfig {
  redis: {
    host: string;
    port: number;
  };
}

/**
 * Helper to register providers from module metadata
 */
function registerProviders(container: Container, providers: ProviderInput[] | undefined): void {
  if (!providers) {
    return;
  }

  for (const provider of providers) {
    if (Array.isArray(provider)) {
      const [token, providerConfig] = provider as [ServiceIdentifier<unknown>, Provider<unknown>];
      container.register(token, providerConfig);
    } else {
      container.register(provider, provider);
    }
  }
}

describe('TitanRedisModule', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();

    // Register mock logger service
    const mockLoggerModule = {
      create: vi.fn(() => createMockLogger()),
    };
    container.register(LOGGER_SERVICE_TOKEN, { useValue: mockLoggerModule });
  });

  afterEach(async () => {
    // Clean up any resources
    const manager = container.has(REDIS_MANAGER) ? await container.resolveAsync<RedisManager>(REDIS_MANAGER) : null;

    if (manager) {
      await manager.destroy();
    }

    container.dispose();
    vi.clearAllMocks();
  });

  describe('forRoot', () => {
    it('should create module with default configuration', async () => {
      const module = TitanRedisModule.forRoot();

      expect(module.module).toBe(TitanRedisModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toContain(REDIS_MANAGER);
      expect(module.exports).toContain(RedisService);
      expect(module.exports).toContain(RedisHealthIndicator);
    });

    it('should create module with custom configuration', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: 'localhost',
          port: 6379,
          namespace: 'test',
        },
      };

      const module = TitanRedisModule.forRoot(options);

      expect(module.module).toBe(TitanRedisModule);
      expect(module.providers).toBeDefined();

      // Register providers in container
      registerProviders(container, module.providers);

      // Verify manager can be resolved
      const manager = await container.resolveAsync<RedisManager>(REDIS_MANAGER);
      expect(manager).toBeInstanceOf(RedisManager);
      expect(manager.hasClient('test')).toBe(true);
    });

    it('should create global module when isGlobal is true', async () => {
      const options: RedisModuleOptions = {
        isGlobal: true,
        config: {
          host: 'localhost',
          port: 6379,
        },
      };

      const module = TitanRedisModule.forRoot(options);

      expect(module.global).toBe(true);
      expect(module.providers).toBeDefined();
      expect(module.exports).toContain(RedisService);
    });

    it('should handle multiple client configurations', async () => {
      const options: RedisModuleOptions = {
        clients: [
          { namespace: 'cache', db: 0 },
          { namespace: 'sessions', db: 1 },
        ],
        commonOptions: {
          host: 'localhost',
          port: 6379,
        },
      };

      const module = TitanRedisModule.forRoot(options);

      // Register providers
      registerProviders(container, module.providers);

      const manager = await container.resolveAsync<RedisManager>(REDIS_MANAGER);
      expect(manager).toBeInstanceOf(RedisManager);
      expect(manager.hasClient('cache')).toBe(true);
      expect(manager.hasClient('sessions')).toBe(true);
    });
  });

  describe('forRootAsync', () => {
    it('should create module with async factory', async () => {
      const module = TitanRedisModule.forRootAsync({
        useFactory: () => ({
          config: {
            host: 'localhost',
            port: 6379,
          },
        }),
      });

      expect(module.module).toBe(TitanRedisModule);
      expect(module.providers).toBeDefined();
      expect(module.exports).toContain(REDIS_MANAGER);
    });

    it('should support inject tokens', async () => {
      const CONFIG_TOKEN = Symbol('CONFIG');

      const module = TitanRedisModule.forRootAsync({
        inject: [CONFIG_TOKEN],
        useFactory: (config: RedisConfig) => ({
          config: {
            host: config.redis.host,
            port: config.redis.port,
          },
        }),
      });

      expect(module.providers).toBeDefined();
      expect(module.imports).toBeDefined();
    });

    it('should support useClass', async () => {
      class ConfigService {
        createRedisOptions(): RedisModuleOptions {
          return {
            config: {
              host: 'localhost',
              port: 6379,
            },
          };
        }
      }

      const module = TitanRedisModule.forRootAsync({
        useClass: ConfigService,
      });

      expect(module.providers).toBeDefined();
      expect(module.providers?.length).toBeGreaterThan(0);
    });

    it('should create global async module', async () => {
      const module = TitanRedisModule.forRootAsync({
        isGlobal: true,
        useFactory: () => ({
          config: {
            host: 'localhost',
            port: 6379,
          },
        }),
      });

      expect(module.global).toBe(true);
    });
  });

  describe('forFeature', () => {
    it('should create feature module for specific clients', () => {
      const module = TitanRedisModule.forFeature(['cache', 'sessions']);

      expect(module.module).toBe(TitanRedisModule);
      expect(module.providers).toBeDefined();
      expect(module.providers?.length).toBe(2);
      expect(module.exports?.length).toBe(2);
    });

    it('should provide access to named clients', async () => {
      // Register the root module with named clients
      const rootModule = TitanRedisModule.forRoot({
        clients: [
          { namespace: 'cache', db: 0 },
          { namespace: 'sessions', db: 1 },
        ],
      });

      // Register root providers
      registerProviders(container, rootModule.providers);

      // Verify we can access the named clients via their tokens
      const manager = await container.resolveAsync<RedisManager>(REDIS_MANAGER);
      const cacheClient = await container.resolveAsync(getRedisClientToken('cache'));
      const sessionsClient = await container.resolveAsync(getRedisClientToken('sessions'));

      expect(cacheClient).toBeDefined();
      expect(sessionsClient).toBeDefined();
      expect(manager.hasClient('cache')).toBe(true);
      expect(manager.hasClient('sessions')).toBe(true);
    });
  });

  describe('Client initialization', () => {
    it('should initialize default client when no config provided', async () => {
      const module = TitanRedisModule.forRoot();

      registerProviders(container, module.providers);

      const manager = await container.resolveAsync<RedisManager>(REDIS_MANAGER);
      expect(manager.hasClient('default')).toBe(true);
    });

    it('should merge common options with client-specific options', async () => {
      const options: RedisModuleOptions = {
        commonOptions: {
          host: 'redis.example.com',
          password: 'secret',
        },
        clients: [
          { namespace: 'cache', db: 0 },
          { namespace: 'sessions', db: 1, port: 6380 }, // Override port
        ],
      };

      const module = TitanRedisModule.forRoot(options);

      registerProviders(container, module.providers);

      const manager = await container.resolveAsync<RedisManager>(REDIS_MANAGER);

      expect(manager.hasClient('cache')).toBe(true);
      expect(manager.hasClient('sessions')).toBe(true);
    });
  });
});
