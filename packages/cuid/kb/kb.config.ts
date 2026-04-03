import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'cuid',
  name: 'CUID Generator',
  tags: ['id', 'cuid', 'collision-resistant'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {},
});
