/**
 * Tests for TitanRedisModule
 *
 * Tests module creation, provider registration, and client initialization
 * without any NestJS dependencies
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { Container } from '../../../src/nexus/index.js';
import { TitanRedisModule } from '../../../src/modules/redis/redis.module.js';
import { RedisService } from '../../../src/modules/redis/redis.service.js';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisHealthIndicator } from '../../../src/modules/redis/redis.health.js';
import { REDIS_MANAGER, getRedisClientToken } from '../../../src/modules/redis/redis.constants.js';
import { RedisModuleOptions } from '../../../src/modules/redis/redis.types.js';
import { createMockRedisClient } from '../../../src/testing/test-helpers.js';

// Mock redis.utils to use mock clients
jest.mock('../../../src/modules/redis/redis.utils.js', () => ({
  createRedisClient: jest.fn(() => createMockRedisClient()),
  waitForConnection: jest.fn(async () => {}),
}));

describe('TitanRedisModule', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
  });

  afterEach(async () => {
    // Clean up any resources
    const manager = container.has(REDIS_MANAGER) ? await container.resolveAsync<RedisManager>(REDIS_MANAGER) : null;

    if (manager) {
      await manager.destroy();
    }

    container.dispose();
    jest.clearAllMocks();
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
      if (module.providers) {
        for (const provider of module.providers as any[]) {
          if (Array.isArray(provider)) {
            const [token, providerConfig] = provider;
            container.register(token, providerConfig);
          } else {
            container.register(provider, provider);
          }
        }
      }

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
      if (module.providers) {
        for (const provider of module.providers as any[]) {
          if (Array.isArray(provider)) {
            const [token, providerConfig] = provider;
            container.register(token, providerConfig);
          } else {
            container.register(provider, provider);
          }
        }
      }

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
        useFactory: (config: any) => ({
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
      if (rootModule.providers) {
        for (const provider of rootModule.providers as any[]) {
          if (Array.isArray(provider)) {
            const [token, providerConfig] = provider;
            container.register(token, providerConfig);
          }
        }
      }

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

      if (module.providers) {
        for (const provider of module.providers as any[]) {
          if (Array.isArray(provider)) {
            const [token, providerConfig] = provider;
            container.register(token, providerConfig);
          }
        }
      }

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

      if (module.providers) {
        for (const provider of module.providers as any[]) {
          if (Array.isArray(provider)) {
            const [token, providerConfig] = provider;
            container.register(token, providerConfig);
          }
        }
      }

      const manager = await container.resolveAsync<RedisManager>(REDIS_MANAGER);

      expect(manager.hasClient('cache')).toBe(true);
      expect(manager.hasClient('sessions')).toBe(true);
    });
  });
});
