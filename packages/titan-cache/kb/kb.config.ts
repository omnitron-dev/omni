import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-cache',
  name: 'Titan Cache',
  tags: ['cache', 'lru', 'lfu', 'multi-tier', 'redis'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject', 'RedisCache'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-redis'],
  },
});
