import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-redis',
  name: 'Titan Redis',
  tags: ['redis', 'service', 'manager', 'cache', 'lock', 'rate-limit'],
  extract: {
    symbols: true,
    decorators: [
      'Injectable',
      'Inject',
      'Module',
      'InjectRedis',
      'InjectRedisManager',
      'RedisCache',
      'RedisLock',
      'RedisRateLimit',
    ],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
  },
});
