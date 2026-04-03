import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-events',
  name: 'Titan Events',
  tags: ['events', 'event-bus', 'scheduling', 'validation', 'pub-sub'],
  extract: {
    symbols: true,
    decorators: [
      'Injectable',
      'Inject',
      'OnEvent',
      'OnceEvent',
      'EmitEvent',
      'ScheduleEvent',
      'BatchEvents',
    ],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
  },
});
