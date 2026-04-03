import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'common',
  name: 'Common Utilities',
  tags: ['utilities', 'predicates', 'promises'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {},
});
