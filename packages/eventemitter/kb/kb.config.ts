import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'eventemitter',
  name: 'Event Emitter',
  tags: ['events', 'emitter', 'async', 'wildcard'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: { extends: ['common'] },
});
