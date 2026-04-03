import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'omnitron',
  name: 'Omnitron Supervisor',
  tags: ['daemon', 'cli', 'orchestrator', 'process-manager', 'fleet', 'cluster'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Module', 'Inject', 'Service', 'Public'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-auth', 'titan-pm', 'titan-health', 'titan-metrics', 'titan-scheduler'],
  },
});
