import type { Config } from '@docusaurus/types';

const config: Config = {
  title: 'Hybrid Math Documentation',
  tagline: 'Formal mathematical models',
  url: 'https://math.example.com',
  baseUrl: '/',
  katexMacros: {
    '\\braket': '\\langle #1 \\rangle',
    '\\energy': 'E = mc^2',
    '\\H': '\\mathcal{H}',
    '\\R': '\\mathbb{R}',
  },
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ru'],
  },
};

export default config;
