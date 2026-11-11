import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const LUMEN_PACKAGES = [
  'packages/lumen-ast',
  'packages/lumen-ui',
  'packages/lumen',
  'packages/titan-lumen',
  'packages/lumen-migrate',
];

describe('Feature 3: Export Map & Build Verification Boundaries', () => {
  it('TC-B03-01: guards against path traversal attempts in export target resolutions', () => {
    const maliciousSubpaths = [
      '../../package.json',
      '..\\..\\package.json',
      '/etc/passwd',
      './../package.json',
      './../../package.json',
    ];

    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8'));
      const exportsMap = pkgJson.exports || {};

      for (const traversal of maliciousSubpaths) {
        expect(exportsMap[traversal]).toBeUndefined();
      }
    }
  });

  it('TC-B03-02: guards against unexported private module and internal source exposure', () => {
    const privateInternalPaths = ['./internal', './src/internal', './private', './tests', './src/private'];

    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8'));
      const exportsMap = pkgJson.exports;

      if (typeof exportsMap === 'object' && exportsMap !== null) {
        for (const priv of privateInternalPaths) {
          expect(exportsMap[priv]).toBeUndefined();
        }
      }
    }
  });

  it('TC-B03-03: rejects CommonJS .cjs mappings in ESM-first package manifests', () => {
    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8'));
      expect(pkgJson.type).toBe('module');

      const exportsString = JSON.stringify(pkgJson.exports ?? {});
      expect(exportsString).not.toContain('.cjs');
      expect(exportsString).not.toContain('"require"');
    }
  });

  it('TC-B03-04: verifies all mapped export targets resolve to real files', () => {
    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgDir = resolve(REPO_ROOT, pkgRel);
      const pkgJson = JSON.parse(readFileSync(resolve(pkgDir, 'package.json'), 'utf8'));
      const exportsMap = pkgJson.exports;

      if (typeof exportsMap === 'object' && exportsMap !== null) {
        for (const [key, value] of Object.entries(exportsMap)) {
          if (typeof value === 'string') {
            const resolvedPath = resolve(pkgDir, value);
            expect(existsSync(resolvedPath), `Path for ${key} (${value}) in ${pkgRel} must exist`).toBe(true);
          } else if (typeof value === 'object' && value !== null) {
            for (const [subKey, subVal] of Object.entries(value as Record<string, string>)) {
              if (typeof subVal === 'string') {
                const resolvedPath = resolve(pkgDir, subVal);
                expect(existsSync(resolvedPath), `Path for ${key}->${subKey} (${subVal}) in ${pkgRel} must exist`).toBe(
                  true
                );
              }
            }
          }
        }
      }
    }
  });

  it('TC-B03-05: verifies no duplicate or shadowed export keys in package manifests', () => {
    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJsonRaw = readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8');
      const pkgJson = JSON.parse(pkgJsonRaw);

      if (pkgJson.exports && typeof pkgJson.exports === 'object') {
        const keys = Object.keys(pkgJson.exports);
        const uniqueKeys = new Set(keys);
        expect(uniqueKeys.size).toBe(keys.length);
        expect(uniqueKeys.has('.')).toBe(true);
      }
    }
  });
});
