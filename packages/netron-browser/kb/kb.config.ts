import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'netron-browser',
  name: 'Netron Browser Client',
  tags: ['rpc', 'browser', 'http', 'websocket', 'client'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: { integrates: ['common', 'cuid', 'eventemitter', 'msgpack'] },
});
