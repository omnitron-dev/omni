import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Guides',
      link: {
        type: 'generated-index',
        title: 'Guides Overview',
        slug: '/category/guides',
      },
      items: ['guides/installation', 'guides/configuration'],
    },
  ],
  advancedSidebar: [
    {
      type: 'category',
      label: 'Deep Dive',
      link: {
        type: 'doc',
        id: 'advanced/overview',
      },
      items: ['advanced/architecture'],
    },
  ],
};

export default sidebars;
