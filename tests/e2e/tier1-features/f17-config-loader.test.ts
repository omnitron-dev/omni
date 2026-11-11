import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { defineLumenConfig } from '@omnitron-dev/lumen';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

describe('Feature 17: Configuration Loader', () => {
  it('TC-F17-01: defines configuration with default values for omitted fields', () => {
    const config = defineLumenConfig({
      title: 'Minimal Config',
    });

    expect(config.title).toBe('Minimal Config');
    expect(config.baseUrl).toBe('/');
    expect(config.outDir).toBe('dist');
    expect(config.srcDir).toBe('docs');
    expect(config.defaultLocale).toBe('en');
  });

  it('TC-F17-02: preserves custom baseUrl, outDir, and theme options', () => {
    const config = defineLumenConfig({
      title: 'Custom Config',
      baseUrl: '/subpath/',
      outDir: 'build/docs',
      theme: { defaultMode: 'light' },
    });

    expect(config.baseUrl).toBe('/subpath/');
    expect(config.outDir).toBe('build/docs');
    expect(config.theme?.defaultMode).toBe('light');
  });

  it('TC-F17-03: handles multilingual locales configuration', () => {
    const config = defineLumenConfig({
      title: 'Bilingual Portal',
      locales: ['en', 'ru'],
      defaultLocale: 'en',
    });

    expect(config.locales).toEqual(['en', 'ru']);
    expect(config.defaultLocale).toBe('en');
  });

  it('TC-F17-04: registers KaTeX macros dictionary in configuration', () => {
    const config = defineLumenConfig({
      title: 'Math Portal',
      katexMacros: {
        '\\R': '\\mathbb{R}',
        '\\C': '\\mathbb{C}',
      },
    });

    expect(config.katexMacros).toBeDefined();
    expect(config.katexMacros?.['\\R']).toBe('\\mathbb{R}');
    expect(config.katexMacros?.['\\C']).toBe('\\mathbb{C}');
  });

  it('TC-F17-05: verifies fixture configuration file exists and exports valid config', async () => {
    const fixtureConfigPath = resolve(REPO_ROOT, 'tests/e2e/fixtures/minimal-lumen/lumen.config.ts');
    expect(existsSync(fixtureConfigPath)).toBe(true);

    const imported = await import(fixtureConfigPath);
    expect(imported.default).toBeDefined();
    expect(imported.default.title).toBe('Minimal Lumen Docs');
  });
});
