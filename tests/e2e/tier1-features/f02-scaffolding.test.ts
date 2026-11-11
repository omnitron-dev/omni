import { describe, it, expect } from 'vitest';
import { resolve, join } from 'node:path';
import { statSync, readFileSync, existsSync } from 'node:fs';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const LUMEN_PACKAGES = [
  'packages/lumen-ast',
  'packages/lumen-ui',
  'packages/lumen',
  'packages/titan-lumen',
  'packages/lumen-migrate',
];

describe('Feature 2: Monorepo Scaffolding', () => {
  it('TC-F02-01: verifies all 5 Lumen package directories exist under packages/', () => {
    for (const pkgRelPath of LUMEN_PACKAGES) {
      const fullPath = resolve(REPO_ROOT, pkgRelPath);
      expect(existsSync(fullPath)).toBe(true);
      expect(statSync(fullPath).isDirectory()).toBe(true);
    }
  });

  it('TC-F02-02: verifies ESM package.json manifests with @omnitron-dev scope', () => {
    for (const pkgRelPath of LUMEN_PACKAGES) {
      const pkgJsonPath = resolve(REPO_ROOT, pkgRelPath, 'package.json');
      expect(existsSync(pkgJsonPath)).toBe(true);

      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
      expect(pkgJson.name).toMatch(/^@omnitron-dev\/(lumen|titan-lumen)/);
      expect(pkgJson.type).toBe('module');
      expect(pkgJson.version).toBeDefined();
    }
  });

  it('TC-F02-03: verifies TypeScript configuration inheritance in all packages', () => {
    for (const pkgRelPath of LUMEN_PACKAGES) {
      const tsconfigPath = resolve(REPO_ROOT, pkgRelPath, 'tsconfig.json');
      expect(existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf8'));
      expect(tsconfig.compilerOptions).toBeDefined();
    }
  });

  it('TC-F02-04: verifies workspace and Turborepo configuration covers packages/*', () => {
    const workspacePath = resolve(REPO_ROOT, 'pnpm-workspace.yaml');
    const turboPath = resolve(REPO_ROOT, 'turbo.json');

    expect(existsSync(workspacePath)).toBe(true);
    expect(existsSync(turboPath)).toBe(true);

    const workspaceContent = readFileSync(workspacePath, 'utf8');
    expect(workspaceContent).toContain('packages/*');

    const turboJson = JSON.parse(readFileSync(turboPath, 'utf8'));
    expect(turboJson.tasks.build).toBeDefined();
    expect(turboJson.tasks.test).toBeDefined();
  });

  it('TC-F02-05: verifies non-empty src/index.ts entrypoint in each package', () => {
    for (const pkgRelPath of LUMEN_PACKAGES) {
      const indexPath = resolve(REPO_ROOT, pkgRelPath, 'src/index.ts');
      expect(existsSync(indexPath)).toBe(true);

      const content = readFileSync(indexPath, 'utf8');
      expect(content.trim().length).toBeGreaterThan(0);
    }
  });
});
