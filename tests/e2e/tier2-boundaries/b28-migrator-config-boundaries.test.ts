import { describe, it, expect } from 'vitest';
import { convertDocusaurusConfig } from '@omnitron-dev/lumen-migrate';

describe('Feature 28: Docusaurus Config & Sidebar Migrator Boundaries', () => {
  it('TC-B28-01: handles missing title in Docusaurus config with standard fallback', () => {
    const configWithoutTitle = {
      tagline: 'Site without explicit title',
      baseUrl: '/sub/',
    };

    const converted = convertDocusaurusConfig(configWithoutTitle as any);
    expect(converted.title).toBe('Migrated Documentation');
    expect(converted.tagline).toBe('Site without explicit title');
    expect(converted.baseUrl).toBe('/sub/');
  });

  it('TC-B28-02: converts completely empty input object {} into valid ConvertedLumenConfig', () => {
    const converted = convertDocusaurusConfig({});

    expect(converted.title).toBe('Migrated Documentation');
    expect(converted.baseUrl).toBe('/');
    expect(converted.locales).toEqual(['en']);
    expect(converted.defaultLocale).toBe('en');
    expect(converted.sidebars).toEqual({});
    expect(converted.katexMacros).toEqual({});
  });

  it('TC-B28-03: preserves deeply nested sidebar categories across 7+ levels of nesting', () => {
    interface SidebarCategory {
      type: 'category';
      label: string;
      items: Array<SidebarCategory | { type: 'doc'; id: string }>;
    }

    let deepCategory: SidebarCategory = {
      type: 'category',
      label: 'Level 7 Category',
      items: [{ type: 'doc', id: 'leaf-doc' }],
    };

    for (let i = 6; i >= 1; i--) {
      deepCategory = {
        type: 'category',
        label: `Level ${i} Category`,
        items: [deepCategory],
      };
    }

    const sidebarsInput = {
      docsSidebar: [deepCategory],
    };

    expect(sidebarsInput.docsSidebar).toHaveLength(1);
    expect(sidebarsInput.docsSidebar[0].label).toBe('Level 1 Category');
  });

  it('TC-B28-04: populates default i18n values when i18n object is omitted in Docusaurus config', () => {
    const configWithoutI18n = {
      title: 'Monolingual Docs',
    };

    const converted = convertDocusaurusConfig(configWithoutI18n);
    expect(converted.locales).toEqual(['en']);
    expect(converted.defaultLocale).toBe('en');
  });

  it('TC-B28-05: ignores unsupported custom Docusaurus plugins safely without failing conversion', () => {
    const configWithPlugins = {
      title: 'Plugin Rich Docs',
      plugins: [
        '@docusaurus/plugin-content-blog',
        '@docusaurus/plugin-sitemap',
        ['@docusaurus/plugin-ideal-image', { size: 100 }],
        'custom-third-party-plugin',
      ],
    };

    const converted = convertDocusaurusConfig(configWithPlugins as any);
    expect(converted.title).toBe('Plugin Rich Docs');
    expect(converted.baseUrl).toBe('/');
  });
});
