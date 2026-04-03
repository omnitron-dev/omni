import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-ratelimit',
  name: 'Titan Rate Limiting',
  tags: ['rate-limit', 'throttle', 'algorithms', 'redis'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject', 'RateLimit', 'Throttle'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-redis'],
  },
});
