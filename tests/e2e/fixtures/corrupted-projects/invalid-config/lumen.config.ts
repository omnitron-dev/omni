import { defineLumenConfig } from '@omnitron-dev/lumen';

export default defineLumenConfig({
  // @ts-expect-error Invalid URL schema
  url: 'not-a-valid-http-url',
  baseUrl: 'missing-leading-slash',
  locales: {
    defaultLocale: 'fr',
    locales: ['en', 'de'],
  },
});
