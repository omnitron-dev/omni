import { describe, it, expect } from 'vitest';
import { convertDocusaurusConfig } from '../src/docusaurus/config-migrator.js';

describe('convertDocusaurusConfig', () => {
  it('converts basic config with title, tagline, url, baseUrl', () => {
    const config = convertDocusaurusConfig({
      title: 'My Docs',
      tagline: 'Tagline',
      url: 'https://example.com',
      baseUrl: '/docs/',
    });

    expect(config.title).toBe('My Docs');
    expect(config.tagline).toBe('Tagline');
    expect(config.url).toBe('https://example.com');
    expect(config.baseUrl).toBe('/docs/');
  });

  it('provides default fallbacks for missing values', () => {
    const config = convertDocusaurusConfig({});
    expect(config.title).toBe('Migrated Documentation');
    expect(config.baseUrl).toBe('/');
    expect(config.locales).toEqual(['en']);
    expect(config.defaultLocale).toBe('en');
    expect(config.sidebars).toEqual({});
    expect(config.katexMacros).toEqual({});
  });

  it('preserves i18n locales and defaultLocale', () => {
    const config = convertDocusaurusConfig({
      i18n: {
        defaultLocale: 'ru',
        locales: ['en', 'ru'],
      },
    });

    expect(config.defaultLocale).toBe('ru');
    expect(config.locales).toEqual(['en', 'ru']);
  });

  it('safely ignores unsupported plugins', () => {
    const config = convertDocusaurusConfig({
      title: 'Plugin Docs',
      plugins: ['@docusaurus/plugin-sitemap', ['custom-plugin', { option: 1 }]],
    });

    expect(config.title).toBe('Plugin Docs');
    expect(config.baseUrl).toBe('/');
  });
});
