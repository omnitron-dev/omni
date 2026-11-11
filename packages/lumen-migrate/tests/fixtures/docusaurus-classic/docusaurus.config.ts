import type { Config } from '@docusaurus/types';

const config: Config = {
  title: 'Classic Docusaurus Site',
  tagline: 'Legacy documentation system',
  url: 'https://classic.example.com',
  baseUrl: '/',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: 'docs',
        },
      },
    ],
  ],
  themeConfig: {
    navbar: {
      title: 'Classic Docs',
      items: [
        { type: 'docSidebar', sidebarId: 'tutorialSidebar', position: 'left', label: 'Tutorial' },
        { type: 'docSidebar', sidebarId: 'advancedSidebar', position: 'left', label: 'Advanced' },
      ],
    },
  },
};

export default config;
