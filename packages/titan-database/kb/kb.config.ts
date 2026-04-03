import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-database',
  name: 'Titan Database',
  tags: ['database', 'kysely', 'orm', 'migrations', 'rls', 'repository'],
  extract: {
    symbols: true,
    decorators: [
      'Injectable',
      'Inject',
      'Repository',
      'Migration',
      'SoftDelete',
      'Timestamps',
      'Audit',
      'RunInTransaction',
      'AutoTransactional',
    ],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
  },
});
