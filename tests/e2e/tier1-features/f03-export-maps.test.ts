import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const LUMEN_PACKAGES = [
  'packages/lumen-ast',
  'packages/lumen-ui',
  'packages/lumen',
  'packages/titan-lumen',
  'packages/lumen-migrate',
];

describe('Feature 3: Export Map & Build Verification', () => {
  it('TC-F03-01: passes check-package-exports script verification', () => {
    const scriptPath = resolve(REPO_ROOT, 'scripts/check-package-exports.mjs');
    expect(existsSync(scriptPath)).toBe(true);

    const result = execFileSync(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, TMPDIR: '/tmp' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result).toContain('targets: all files present');
  });

  it('TC-F03-02: passes undeclared dependencies audit', () => {
    const scriptPath = resolve(REPO_ROOT, 'scripts/undeclared-dependencies.mjs');
    expect(existsSync(scriptPath)).toBe(true);

    const result = execFileSync(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(result).toBeDefined();
  });

  it('TC-F03-03: verifies exports map in all 5 packages conforms to ESM and type declarations', () => {
    for (const pkgRelPath of LUMEN_PACKAGES) {
      const pkgJsonPath = resolve(REPO_ROOT, pkgRelPath, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

      expect(pkgJson.exports).toBeDefined();
      const dotExport = pkgJson.exports['.'];
      expect(dotExport).toBeDefined();

      if (typeof dotExport === 'object') {
        expect(dotExport.import).toBeDefined();
        expect(dotExport.types).toBeDefined();
      }
    }
  });

  it('TC-F03-04: verifies build scripts defined across all Lumen packages', () => {
    for (const pkgRelPath of LUMEN_PACKAGES) {
      const pkgJsonPath = resolve(REPO_ROOT, pkgRelPath, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

      expect(pkgJson.scripts).toBeDefined();
      expect(pkgJson.scripts.build).toBeDefined();
    }
  });

  it('TC-F03-05: verifies CLI executable shebang and bin entries in lumen and lumen-migrate', () => {
    const clis = [
      { pkg: 'packages/lumen', binKey: 'lumen', binFile: 'bin/lumen.js' },
      { pkg: 'packages/lumen-migrate', binKey: 'lumen-migrate', binFile: 'bin/lumen-migrate.js' },
    ];

    for (const cli of clis) {
      const pkgJsonPath = resolve(REPO_ROOT, cli.pkg, 'package.json');
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

      expect(pkgJson.bin).toBeDefined();
      expect(pkgJson.bin[cli.binKey]).toBeDefined();

      const launcherPath = resolve(REPO_ROOT, cli.pkg, cli.binFile);
      expect(existsSync(launcherPath)).toBe(true);

      const content = readFileSync(launcherPath, 'utf8');
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true);
    }
  });
});
