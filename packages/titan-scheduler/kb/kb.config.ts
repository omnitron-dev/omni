import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-scheduler',
  name: 'Titan Scheduler',
  tags: ['scheduler', 'cron', 'interval', 'timeout', 'jobs'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject', 'Cron', 'Interval', 'Timeout', 'Schedulable'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-redis'],
  },
});
