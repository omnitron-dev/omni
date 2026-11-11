import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { convertDocusaurusConfig } from '@omnitron-dev/lumen-migrate';
import { cliRunner } from '../harness/cli-runner.js';

describe('Feature 28: Docusaurus Config & Sidebar Migrator', () => {
  it('TC-F28-01: converts Docusaurus site title, tagline, and url to LumenConfig', () => {
    const docusaurusInput = {
      title: 'Classic Docusaurus Site',
      tagline: 'Legacy documentation system',
      url: 'https://classic.example.com',
      baseUrl: '/',
    };

    const converted = convertDocusaurusConfig(docusaurusInput);
    expect(converted.title).toBe('Classic Docusaurus Site');
    expect(converted.tagline).toBe('Legacy documentation system');
    expect(converted.url).toBe('https://classic.example.com');
    expect(converted.baseUrl).toBe('/');
  });

  it('TC-F28-02: converts Docusaurus i18n locales and defaultLocale configuration', () => {
    const docusaurusInput = {
      title: 'Multilingual Docs',
      i18n: {
        defaultLocale: 'en',
        locales: ['en', 'ru'],
      },
    };

    const converted = convertDocusaurusConfig(docusaurusInput);
    expect(converted.locales).toEqual(['en', 'ru']);
    expect(converted.defaultLocale).toBe('en');
  });

  it('TC-F28-03: populates default baseUrl and locales when omitted from Docusaurus config', () => {
    const docusaurusInput = {
      title: 'Sparse Config',
    };

    const converted = convertDocusaurusConfig(docusaurusInput);
    expect(converted.baseUrl).toBe('/');
    expect(converted.locales).toEqual(['en']);
    expect(converted.defaultLocale).toBe('en');
  });

  it('TC-F28-04: executes lumen-migrate CLI command with arguments', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'lumen-f28-migrated-'));
    try {
      const result = await cliRunner.runLumenMigrate('fixtures/docusaurus-classic', outDir);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('command: docusaurus');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('TC-F28-05: executes lumen-migrate --help and outputs usage guide', async () => {
    const result = await cliRunner.run('lumen-migrate', ['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stdout).toContain('lumen-migrate docusaurus');
  });
});
