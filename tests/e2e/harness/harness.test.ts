import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyUrlAndAnchorParity } from '@omnitron-dev/lumen-migrate';
import {
  IsolatedFixture,
  cliRunner,
  withFixture,
  loadFixture,
  fixtureLoader,
  createCorpusBuilder,
  normalizeAstNode,
  normalizeAnchor,
  expectAstParity,
  expectDiagnostics,
  expectRouteParity,
  expectAnchorParity,
  expectCriticalEmotionCss,
  expectPortalIsland,
  expectValidLlmsTxt,
} from './index.js';

describe('E2E Harness Self-Tests', () => {
  it('fixtureLoader.withFixture cleanly creates and destroys temporary sandbox', async () => {
    let capturedPath = '';
    await withFixture('minimal-lumen', async (fixture: IsolatedFixture) => {
      capturedPath = fixture.fixtureDir;
      expect(existsSync(capturedPath)).toBe(true);
      expect(fixture.exists('lumen.config.ts')).toBe(true);
      const content = await fixture.readFile('lumen.config.ts');
      expect(content).toContain('Minimal Lumen Docs');
    });

    expect(capturedPath).not.toBe('');
    expect(existsSync(capturedPath)).toBe(false);
  });

  it('fixtureLoader.createCustomFixture creates in-memory custom project and cleans up', async () => {
    let customDir = '';
    const fixture = await fixtureLoader.createCustomFixture({
      'test.pdx': '# Test Content',
      'sub/nested.json': JSON.stringify({ hello: 'world' }),
    });

    customDir = fixture.fixtureDir;
    expect(existsSync(customDir)).toBe(true);
    expect(fixture.exists('test.pdx')).toBe(true);
    expect(await fixture.readFile('test.pdx')).toBe('# Test Content');
    expect(await fixture.readJson('sub/nested.json')).toEqual({ hello: 'world' });

    await fixture.cleanup();
    expect(existsSync(customDir)).toBe(false);
  });

  it('fixtureLoader.validateFixtureIntegrity scans for blacklisted keywords', async () => {
    const fixturePath = resolve(import.meta.dirname, '../fixtures/minimal-lumen');
    const integrity = await fixtureLoader.validateFixtureIntegrity(fixturePath);
    expect(integrity.valid).toBe(true);
    expect(integrity.violations).toHaveLength(0);
  });

  it('cliRunner resolves executable and captures stdout and execution time', async () => {
    const result = await cliRunner.runLumen(['--version']);
    expect(result.exitCode).toBe(0);
    expect(result.durationMs).toBeGreaterThan(0);
    expect(result.timedOut).toBe(false);
    expect(result.stdout).toMatch(/0\.\d+\.\d+/);
  });

  it('closes unused stdin so a finite command can complete', async () => {
    await withFixture('minimal-lumen', async fixture => {
      await fixture.writeFile('read-stdin.js', "process.stdin.resume(); process.stdin.on('end', () => console.log('complete'));\n");
      const result = await cliRunner.runLumen([], { binPath: resolve(fixture.fixtureDir, 'read-stdin.js') });
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe('complete');
      expect(result.timedOut).toBe(false);
    });
  });

  it.skipIf(process.platform === 'win32')('reaps its own timed-out child after a refused graceful termination', async () => {
    await withFixture('minimal-lumen', async fixture => {
      await fixture.writeFile('ignore-term.js', "process.on('SIGTERM', () => console.log('termination refused')); setInterval(() => {}, 1000);\n");
      const result = await cliRunner.runLumen([], {
        binPath: resolve(fixture.fixtureDir, 'ignore-term.js'), timeoutMs: 1000,
      });
      expect(result.timedOut).toBe(true);
      expect(result.stdout).toContain('termination refused');
      expect(result.signal).toBe('SIGKILL');
    });
  });

  it('assertions helpers validate AST normalization, diagnostics, anchors, and reports', () => {
    const ast1 = { loc: { line: 1 }, type: 'doc', content: 'test', sha256: 'hash1' };
    const ast2 = { loc: { line: 99 }, type: 'doc', content: 'test', sha256: 'hash2' };

    expectAstParity(ast1, ast2);
    expect(normalizeAnchor('#My-Section')).toBe('#My-Section');
    expectAnchorParity(['#alpha', '#beta'], ['beta', 'alpha']);

    expectDiagnostics(
      [{ code: 'ERR_BROKEN_LINK', severity: 'error', message: 'Missing target' }],
      [{ code: 'ERR_BROKEN_LINK', severity: 'error', message: /Missing/ }]
    );

    expectRouteParity(verifyUrlAndAnchorParity(['/guide', '/guide#Intro'], ['/guide/', '/guide/#Intro']));
    const missing = verifyUrlAndAnchorParity(['/guide#Intro'], ['/guide#intro']);
    expect(missing).not.toHaveRouteParity();
    expect(() => expectRouteParity(missing)).toThrow();

    expectCriticalEmotionCss('<style data-emotion="css">body{margin:0}</style>');
    expectPortalIsland('<div data-lumen-island="x" data-hydrate="load"></div>', {
      hydrate: 'load',
    });
    expectValidLlmsTxt('# Title\n\n- [Link](/doc.md)');
  });
});
