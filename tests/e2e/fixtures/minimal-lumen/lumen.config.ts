import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  title: 'Minimal Lumen Docs',
  tagline: 'Typed SSG Baseline',
  url: 'https://docs.example.com',
  baseUrl: '/',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  locales: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  sidebars: {
    docs: [
      { type: 'doc', id: 'intro' },
      { type: 'doc', id: 'getting-started' },
    ],
  },
});
