import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'testing',
  name: 'Test Utilities',
  tags: ['testing', 'vitest', 'bun', 'deno', 'docker'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: { integrates: ['titan', 'titan-database', 'titan-pm'] },
});
