import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'msgpack',
  name: 'MessagePack Serialization',
  tags: ['serialization', 'messagepack', 'binary'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: { extends: ['common'] },
});
