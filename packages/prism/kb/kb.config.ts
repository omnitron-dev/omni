import { defineKnowledge } from '@omnitron-dev/kb';

export default defineKnowledge({
  module: 'prism',
  name: 'Prism Design System',
  tags: ['ui', 'design-system', 'mui', 'components', 'forms'],
  extract: {
    symbols: true,
    decorators: [],
    entryPoints: ['src/index.ts'],
  },
  specs: './specs',
  relationships: { integrates: ['netron-browser', 'netron-react'] },
});
