import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-metrics',
  name: 'Titan Metrics',
  tags: ['metrics', 'collection', 'storage', 'monitoring', 'observability'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject', 'Metrics'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
  },
});
