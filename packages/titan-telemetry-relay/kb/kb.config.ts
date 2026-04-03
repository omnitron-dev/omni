import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-telemetry-relay',
  name: 'Titan Telemetry Relay',
  tags: ['telemetry', 'buffering', 'wal', 'observability', 'relay'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
  },
});
