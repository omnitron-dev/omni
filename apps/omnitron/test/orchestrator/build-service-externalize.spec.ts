/**
 * Verifies the smarter behavior of build-service's externalizeNonRelativePlugin (LOW-15):
 *   - non-relative specifiers that resolve to .ts/.tsx/.mts files (workspace
 *     packages without a built dist/) are BUNDLED, not left external
 *     (preventing ERR_UNKNOWN_FILE_EXTENSION at runtime).
 *   - non-relative specifiers that resolve to .js/.cjs/.mjs files stay external.
 *   - unresolvable specifiers (genuine npm deps to be installed in runtime
 *     environment) stay external.
 *
 * We verify the behavior end-to-end by running esbuild with the plugin
 * against a synthetic project tree and inspecting the produced bundle.
 */
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BuildService } from '../../src/orchestrator/build-service.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-service-externalize-'));

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

/**
 * Construct a synthetic tree:
 *   <tmp>/<id>/
 *     entry.ts                     — entry point importing both deps
 *     node_modules/
 *       @ws/source-only/           — ts entry, no dist (must be bundled)
 *         package.json
 *         src/index.ts
 *       @ws/built/                 — js entry (must stay external)
 *         package.json
 *         dist/index.js
 *
 * Returns the entry path and the project dir.
 */
function makeTree(id: string, entryBody: string): { entry: string; root: string } {
  const root = path.join(tmpRoot, id);
  fs.mkdirSync(root, { recursive: true });

  // Workspace package: source-only (no dist)
  const srcOnly = path.join(root, 'node_modules', '@ws', 'source-only');
  fs.mkdirSync(path.join(srcOnly, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(srcOnly, 'package.json'),
    JSON.stringify({
      name: '@ws/source-only',
      version: '0.0.0',
      type: 'module',
      main: './src/index.ts',
      exports: { '.': './src/index.ts' },
    }),
  );
  fs.writeFileSync(
    path.join(srcOnly, 'src', 'index.ts'),
    'export const fromSourceOnly: string = "src-only-marker-12345";\n',
  );

  // Workspace package: prebuilt
  const built = path.join(root, 'node_modules', '@ws', 'built');
  fs.mkdirSync(path.join(built, 'dist'), { recursive: true });
  fs.writeFileSync(
    path.join(built, 'package.json'),
    JSON.stringify({
      name: '@ws/built',
      version: '0.0.0',
      type: 'module',
      main: './dist/index.js',
      exports: { '.': './dist/index.js' },
    }),
  );
  fs.writeFileSync(
    path.join(built, 'dist', 'index.js'),
    'export const fromBuilt = "built-marker-67890";\n',
  );

  // Entry
  const entry = path.join(root, 'entry.ts');
  fs.writeFileSync(entry, entryBody);

  return { entry, root };
}

describe('externalizeNonRelativePlugin (LOW-15)', () => {
  it('bundles workspace packages whose entry is untranspiled .ts', async () => {
    const { entry } = makeTree(
      'src-only',
      `
import { fromSourceOnly } from '@ws/source-only';
export const out = fromSourceOnly;
      `,
    );
    const outFile = path.join(path.dirname(entry), '.build', 'entry.js');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    const svc = new BuildService(false);
    // buildEntry is private; call via reflection. The plugin & post-process
    // run inside it, which is exactly what we want to exercise.
    const esbuild = (await import('esbuild'));
    await (svc as any).buildEntry(esbuild, entry, outFile);

    const bundle = fs.readFileSync(outFile, 'utf8');
    // The marker from the source-only package MUST appear inline (bundled).
    expect(bundle).toContain('src-only-marker-12345');
    // And must NOT appear as a runtime import of '@ws/source-only' — the
    // import would have to be transformed away once bundled.
    expect(bundle).not.toContain('"@ws/source-only"');
  }, 30000);

  it('leaves workspace packages with a prebuilt dist/ external', async () => {
    const { entry } = makeTree(
      'built',
      `
import { fromBuilt } from '@ws/built';
export const out = fromBuilt;
      `,
    );
    const outFile = path.join(path.dirname(entry), '.build', 'entry.js');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    const svc = new BuildService(false);
    const esbuild = (await import('esbuild'));
    await (svc as any).buildEntry(esbuild, entry, outFile);

    const bundle = fs.readFileSync(outFile, 'utf8');
    // The marker from the built package must NOT appear inline — it's
    // expected to be loaded at runtime via the import.
    expect(bundle).not.toContain('built-marker-67890');
    // And the import must be preserved as a runtime specifier.
    expect(bundle).toContain('"@ws/built"');
  }, 30000);

  it('leaves unresolvable npm specifiers external', async () => {
    const { entry } = makeTree(
      'unresolvable',
      `
import { something } from 'this-package-definitely-does-not-exist-anywhere';
export const out = something;
      `,
    );
    const outFile = path.join(path.dirname(entry), '.build', 'entry.js');
    fs.mkdirSync(path.dirname(outFile), { recursive: true });

    const svc = new BuildService(false);
    const esbuild = (await import('esbuild'));
    await (svc as any).buildEntry(esbuild, entry, outFile);

    const bundle = fs.readFileSync(outFile, 'utf8');
    // Specifier must be preserved as-is for runtime resolution.
    expect(bundle).toContain('"this-package-definitely-does-not-exist-anywhere"');
  }, 30000);
});
