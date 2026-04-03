import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-lock',
  name: 'Titan Distributed Locking',
  tags: ['lock', 'distributed-lock', 'mutex', 'redis'],
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
