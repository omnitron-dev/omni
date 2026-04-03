import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'netron-react',
  name: 'Netron React Hooks',
  tags: ['react', 'hooks', 'rpc', 'state'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: { extends: ['netron-browser'] },
});
