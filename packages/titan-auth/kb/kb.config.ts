import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'titan-auth',
  name: 'Titan Authentication',
  tags: ['auth', 'jwt', 'middleware', 'guards', 'security'],
  extract: {
    symbols: true,
    decorators: ['Injectable', 'Inject', 'RequireAuth'],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: {
    extends: ['titan/nexus'],
    integrates: ['titan/netron'],
  },
});
