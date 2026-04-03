import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-notifications',
  name: 'Titan Notifications',
  tags: ['notifications', 'email', 'sms', 'push', 'webhook', 'multi-channel'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-events', 'titan-redis'],
  },
});
