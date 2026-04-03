import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-health',
  name: 'Titan Health Checks',
  tags: ['health', 'health-checks', 'indicators', 'monitoring'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-redis', 'titan-database'],
  },
});
