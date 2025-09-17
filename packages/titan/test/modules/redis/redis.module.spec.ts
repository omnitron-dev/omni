import { Test, TestingModule } from '@nestjs/testing';
import { TitanRedisModule } from '../../../src/modules/redis/redis.module.js';
import { RedisService } from '../../../src/modules/redis/redis.service';
import { RedisManager } from '../../../src/modules/redis/redis.manager.js';
import { RedisHealthIndicator } from '../../../src/modules/redis/redis.health.js';
import { REDIS_MANAGER, getRedisToken } from '../../../src/modules/redis/redis.constants.js';
import { RedisModuleOptions } from '../../../src/modules/redis/redis.types.js';

describe('TitanRedisModule', () => {
  let module: TestingModule;

  afterEach(async () => {
    if (module) {
      await module.close();
    }
  });

  describe('forRoot', () => {
    it('should create module with default configuration', async () => {
      module = await Test.createTestingModule({
        imports: [TitanRedisModule.forRoot()],
      }).compile();

      const redisManager = module.get(REDIS_MANAGER);
      const redisService = module.get(RedisService);
      const redisHealth = module.get(RedisHealthIndicator);

      expect(redisManager).toBeDefined();
      expect(redisService).toBeDefined();
      expect(redisHealth).toBeDefined();
    });

    it('should create module with custom configuration', async () => {
      const options: RedisModuleOptions = {
        config: {
          host: 'localhost',
          port: 6379,
          namespace: 'test',
        },
      };

      module = await Test.createTestingModule({
        imports: [TitanRedisModule.forRoot(options)],
      }).compile();

      const redisManager = module.get(REDIS_MANAGER);
      expect(redisManager).toBeDefined();
    });

    it('should create global module when isGlobal is true', async () => {
      const options: RedisModuleOptions = {
        isGlobal: true,
        config: {
          host: 'localhost',
          port: 6379,
        },
      };

      module = await Test.createTestingModule({
        imports: [TitanRedisModule.forRoot(options)],
      }).compile();

      const redisService = module.get(RedisService);
      expect(redisService).toBeDefined();
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

      module = await Test.createTestingModule({
        imports: [TitanRedisModule.forRoot(options)],
      }).compile();

      const redisManager = module.get<RedisManager>(REDIS_MANAGER);
      expect(redisManager).toBeDefined();
    });
  });

  describe('forRootAsync', () => {
    it('should create module with async factory', async () => {
      module = await Test.createTestingModule({
        imports: [
          TitanRedisModule.forRootAsync({
            useFactory: () => ({
              config: {
                host: 'localhost',
                port: 6379,
              },
            }),
          }),
        ],
      }).compile();

      const redisService = module.get(RedisService);
      expect(redisService).toBeDefined();
    });

    it('should create module with async class', async () => {
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

      module = await Test.createTestingModule({
        imports: [
          TitanRedisModule.forRootAsync({
            useClass: ConfigService,
          }),
        ],
      }).compile();

      const redisService = module.get(RedisService);
      expect(redisService).toBeDefined();
    });

    it('should handle dependencies injection', async () => {
      class ConfigService {
        getRedisConfig() {
          return {
            host: 'localhost',
            port: 6379,
          };
        }
      }

      const ConfigModule = {
        module: class ConfigModule { },
        providers: [ConfigService],
        exports: [ConfigService],
      };

      module = await Test.createTestingModule({
        imports: [
          ConfigModule,
          TitanRedisModule.forRootAsync({
            imports: [ConfigModule],
            useFactory: (configService: ConfigService) => ({
              config: configService.getRedisConfig(),
            }),
            inject: [ConfigService],
          }),
        ],
      }).compile();

      const redisService = module.get(RedisService);
      expect(redisService).toBeDefined();
    });
  });

  describe('forFeature', () => {
    it('should return correct module configuration', () => {
      const clients = ['cache', 'sessions'];
      const moduleConfig = TitanRedisModule.forFeature(clients);

      expect(moduleConfig).toBeDefined();
      expect(moduleConfig.module).toBe(TitanRedisModule);
      expect(moduleConfig.providers).toHaveLength(2);
      expect(moduleConfig.exports).toHaveLength(2);

      // Check that correct tokens are provided
      const cacheToken = getRedisToken('cache');
      const sessionToken = getRedisToken('sessions');

      const providerTokens = moduleConfig.providers?.map(p => (p as any).provide);
      expect(providerTokens).toContain(cacheToken);
      expect(providerTokens).toContain(sessionToken);
    });
  });
});