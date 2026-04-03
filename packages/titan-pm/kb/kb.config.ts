import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-pm',
  name: 'Titan Process Management',
  tags: ['process', 'supervision', 'pools', 'circuit-breaker', 'workers'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject', 'Supervisor', 'Child', 'CircuitBreaker'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan-metrics'],
  },
});
