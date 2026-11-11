import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { readFileSync, existsSync, statSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const LUMEN_PACKAGES = [
  'packages/lumen-ast',
  'packages/lumen-ui',
  'packages/lumen',
  'packages/titan-lumen',
  'packages/lumen-migrate',
];

describe('Feature 2: Monorepo Scaffolding Boundaries', () => {
  it('TC-B02-01: detects missing package manifest boundary in non-existent directory', () => {
    const phantomDir = resolve(REPO_ROOT, 'packages/__phantom_package_404__');
    const phantomPkgJson = resolve(phantomDir, 'package.json');

    expect(existsSync(phantomPkgJson)).toBe(false);
    expect(() => readFileSync(phantomPkgJson, 'utf8')).toThrow();
  });

  it('TC-B02-02: rejects malformed and non-standard package name patterns', () => {
    const validNamePattern = /^@omnitron-dev\/[a-z0-9-]+$/;
    const invalidNames = [
      'Lumen',
      '@other/lumen',
      'lumen_pkg',
      '@omnitron-dev/',
      '@omnitron-dev/lumen/nested',
      '@omnitron-dev/LUMEN-AST',
      'packages/lumen',
    ];

    for (const name of invalidNames) {
      expect(validNamePattern.test(name)).toBe(false);
    }

    // Verify all 5 real packages satisfy standard pattern
    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8'));
      expect(validNamePattern.test(pkgJson.name)).toBe(true);
    }
  });

  it('TC-B02-03: rejects negative and non-semver version strings', () => {
    const semverPattern = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
    const invalidVersions = ['', '0.0.-1', 'alpha', 'v1.0.0', '1.0', '1.0.0.0', 'beta.1'];

    for (const v of invalidVersions) {
      expect(semverPattern.test(v)).toBe(false);
    }

    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8'));
      expect(semverPattern.test(pkgJson.version)).toBe(true);
    }
  });

  it('TC-B02-04: verifies strictly acyclic dependency DAG among all 5 Lumen packages', () => {
    const packageNames = new Set<string>();
    const depsMap = new Map<string, string[]>();

    for (const pkgRel of LUMEN_PACKAGES) {
      const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, pkgRel, 'package.json'), 'utf8'));
      packageNames.add(pkgJson.name);
      const internalDeps: string[] = [];
      const allDeps = {
        ...(pkgJson.dependencies || {}),
        ...(pkgJson.devDependencies || {}),
      };
      for (const dep of Object.keys(allDeps)) {
        if (dep.startsWith('@omnitron-dev/lumen') || dep.startsWith('@omnitron-dev/titan-lumen')) {
          internalDeps.push(dep);
        }
      }
      depsMap.set(pkgJson.name, internalDeps);
    }

    // Detect cycles via DFS traversal
    const visited = new Set<string>();
    const recStack = new Set<string>();

    function hasCycle(node: string): boolean {
      visited.add(node);
      recStack.add(node);

      const neighbors = depsMap.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycle(neighbor)) return true;
        } else if (recStack.has(neighbor)) {
          return true;
        }
      }

      recStack.delete(node);
      return false;
    }

    for (const pkg of packageNames) {
      if (!visited.has(pkg)) {
        expect(hasCycle(pkg)).toBe(false);
      }
    }
  });

  it('TC-B02-05: guards against zero-byte or whitespace-only entrypoints', () => {
    for (const pkgRel of LUMEN_PACKAGES) {
      const entryPath = resolve(REPO_ROOT, pkgRel, 'src/index.ts');
      expect(existsSync(entryPath)).toBe(true);

      const stats = statSync(entryPath);
      expect(stats.size).toBeGreaterThan(50);

      const content = readFileSync(entryPath, 'utf8');
      expect(content.trim().length).toBeGreaterThan(50);
      expect(content).toContain('export');
    }
  });
});
