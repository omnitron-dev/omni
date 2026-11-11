import type { Config } from '@docusaurus/types';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';

const katexMacros = {
  '\\braket': '\\langle #1 \\rangle',
  '\\energy': 'E = mc^2',
  '\\H': '\\mathcal{H}',
};

const config: Config = {
  title: 'Bilingual Scientific Docs',
  url: 'https://bilingual.example.com',
  baseUrl: '/',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'ru'],
    localeConfigs: {
      en: { label: 'English', htmlLang: 'en-US' },
      ru: { label: 'Русский', htmlLang: 'ru-RU', path: 'ru' },
    },
  },
  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          remarkPlugins: [remarkMath],
          rehypePlugins: [[rehypeKatex, { macros: katexMacros }]],
        },
      },
    ],
  ],
};

export default config;
