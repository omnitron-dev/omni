import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-discovery',
  name: 'Titan Service Discovery',
  tags: ['discovery', 'service-discovery', 'redis', 'registry'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-redis'],
  },
});
