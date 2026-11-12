import { describe, it, expect } from 'vitest';
import { defineLumenConfig } from '@omnitron-dev/lumen';

describe('Feature 17: Configuration Loader Boundaries', () => {
  it('TC-B17-01: applies robust default values when minimal configuration is provided', () => {
    const config = defineLumenConfig({
      title: 'Minimal Boundaries Config',
    });

    expect(config.title).toBe('Minimal Boundaries Config');
    expect(config.baseUrl).toBe('/');
    expect(config.srcDir).toBe('docs');
    expect(config.outDir).toBe('dist');
    expect(config.defaultLocale).toBe('en');
    expect(config.locales).toEqual(['en']);
    expect(config.theme?.defaultMode).toBe('dark');
    expect(config.gates).toEqual([]);
    expect(config).not.toHaveProperty('titan');
    expect(config.pdf).toBeUndefined();
  });

  it('TC-B17-02: preserves subpath baseUrl formats with leading and trailing slashes', () => {
    const config = defineLumenConfig({
      title: 'Subpath Config',
      baseUrl: '/documentation/v2/',
    });

    expect(config.baseUrl).toBe('/documentation/v2/');
  });

  it('TC-B17-03: supports multiple configured locales and matching defaultLocale', () => {
    const config = defineLumenConfig({
      title: 'Multilingual Boundaries',
      locales: ['en', 'ru', 'zh', 'ja'],
      defaultLocale: 'ru',
    });

    expect(config.locales).toHaveLength(4);
    expect(config.defaultLocale).toBe('ru');
    expect(config.locales).toContain('ru');
  });

  it('TC-B17-04: handles empty theme and sidebars configurations safely', () => {
    const config = defineLumenConfig({
      title: 'Empty Theme Config',
      theme: {},
      sidebars: {},
      katexMacros: {},
    });

    expect(config.sidebars).toEqual({});
    expect(config.katexMacros).toEqual({});
  });

  it('TC-B17-05: handles empty gates array without verification pipeline errors', () => {
    const config = defineLumenConfig({
      title: 'No Gates Config',
      gates: [],
    });

    expect(Array.isArray(config.gates)).toBe(true);
    expect(config.gates).toHaveLength(0);
  });

  it('TC-B17-06: rejects obsolete deployment switches and retains explicit PDF selection', () => {
    const config = defineLumenConfig({ title: 'Paper', pdf: { paperSections: ['docs/paper.md'] } });
    expect(config.pdf).toEqual({ paperSections: ['docs/paper.md'] });
    for (const extra of [{ titan: { enabled: true } }, { pdf: { enabled: true } }]) {
      expect(() => defineLumenConfig({ title: 'Paper', ...extra } as unknown as Parameters<typeof defineLumenConfig>[0]))
        .toThrow(/Invalid Lumen configuration/);
    }
  });
});
