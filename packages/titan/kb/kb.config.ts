import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan',
  name: 'Titan Core Framework',
  tags: ['di', 'rpc', 'decorators', 'validation', 'nexus', 'netron', 'framework'],
  extract: {
    symbols: true,
    decorators: [
      'Injectable',
      'Module',
      'Inject',
      'Service',
      'Public',
      'Auth',
      'RateLimit',
      'Cache',
      'Contract',
      'Validate',
      'PostConstruct',
      'PreDestroy',
      'Singleton',
      'Transient',
    ],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {},
});
