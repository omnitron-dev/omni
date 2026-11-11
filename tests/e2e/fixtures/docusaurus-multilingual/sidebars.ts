import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  theorySidebar: [
    'intro',
    {
      type: 'category',
      label: 'Quantum Theory',
      items: ['theory/quantum'],
    },
  ],
};

export default sidebars;
