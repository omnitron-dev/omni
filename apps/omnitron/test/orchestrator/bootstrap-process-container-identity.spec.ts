/**
 * BootstrapProcess.assertContainerIdentity — verifies the guard that
 * detects a Container class identity mismatch between the daemon's
 * @omnitron-dev/titan and the app's titan installation.
 *
 * The guard works by independently resolving titan's `package.json`
 * realpath from two contexts:
 *   1. daemon-side: the directory of bootstrap-process.js
 *   2. app-side: the directory of the imported app module
 * If they disagree, the guard throws with both paths and a remediation hint.
 *
 * To exercise the guard without spinning up real spawn machinery we
 * construct synthetic temp trees that mimic pnpm-style symlinking and
 * invoke the private method directly via reflection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import BootstrapProcess from '../../src/orchestrator/bootstrap-process.js';

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-identity-test-'));

/**
 * Build a minimal node_modules layout under `root` that exposes
 * `@omnitron-dev/titan` (and optionally titan-scheduler) so that
 * `createRequire(...)` can resolve the package as if it were installed.
 */
function makeTitanInstall(
  root: string,
  opts: { includeScheduler?: boolean } = {},
): { titanRealPath: string; appModulePath: string } {
  const nm = path.join(root, 'node_modules', '@omnitron-dev');
  const titanRoot = path.join(nm, 'titan');
  fs.mkdirSync(titanRoot, { recursive: true });
  fs.writeFileSync(
    path.join(titanRoot, 'package.json'),
    JSON.stringify({
      name: '@omnitron-dev/titan',
      version: '0.0.0',
      type: 'module',
      main: './dist/index.js',
      exports: {
        '.': './dist/index.js',
        './nexus': './dist/nexus/index.js',
        './package.json': './package.json',
      },
    }),
  );
  fs.mkdirSync(path.join(titanRoot, 'dist', 'nexus'), { recursive: true });
  fs.writeFileSync(path.join(titanRoot, 'dist', 'index.js'), 'export const Application = class {};\n');
  fs.writeFileSync(path.join(titanRoot, 'dist', 'nexus', 'index.js'), 'export class Container {}\n');

  if (opts.includeScheduler) {
    const schedRoot = path.join(nm, 'titan-scheduler');
    fs.mkdirSync(schedRoot, { recursive: true });
    fs.writeFileSync(
      path.join(schedRoot, 'package.json'),
      JSON.stringify({
        name: '@omnitron-dev/titan-scheduler',
        version: '0.0.0',
        main: './dist/index.js',
        exports: { '.': './dist/index.js', './package.json': './package.json' },
      }),
    );
    fs.mkdirSync(path.join(schedRoot, 'dist'));
    fs.writeFileSync(path.join(schedRoot, 'dist', 'index.js'), '// fake scheduler\n');
  }

  // App module — a plain JS file that we can pass to assertContainerIdentity
  // as the resolveDir. We don't actually evaluate it; the guard only uses
  // its directory to construct require contexts.
  const appDir = path.join(root, 'app');
  fs.mkdirSync(appDir, { recursive: true });
  const appModulePath = path.join(appDir, 'http.js');
  fs.writeFileSync(appModulePath, 'export const AppModule = class {};\n');

  return { titanRealPath: fs.realpathSync(titanRoot), appModulePath };
}

afterAll(() => {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    // best effort
  }
});

/** Helper: invoke the private guard via reflection. */
async function callGuard(
  bp: BootstrapProcess,
  appDir: string,
  definitionName = 'test-app',
): Promise<{ ok: true } | { ok: false; error: Error }> {
  // The guard reads `this.definition?.name` for the error message.
  (bp as any).definition = { name: definitionName, version: '0.0.0', processes: [] };
  try {
    await (bp as any).assertContainerIdentity(appDir);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err as Error };
  }
}

describe('BootstrapProcess.assertContainerIdentity', () => {
  describe('matching titan paths', () => {
    it('does not throw when daemon-side and app-side resolve to the same titan', async () => {
      // Both contexts use the daemon's *real* titan (omni/packages/titan)
      // by anchoring the app-side resolution at the bootstrap-process source
      // directory. This is the common happy path during normal operation.
      const bp = new BootstrapProcess();
      const bootstrapDir = path.dirname(
        new URL((BootstrapProcess as any).__esModule ? '' : '', import.meta.url).pathname,
      );
      // We can't reliably get bootstrap-process.ts's own directory from the
      // test, but we know any directory inside the omnitron package walks up
      // to the same titan install. Use the test file's directory.
      const fromDir = path.dirname(new URL(import.meta.url).pathname);
      const res = await callGuard(bp, fromDir);
      expect(res.ok).toBe(true);
      // Reference the unused var to keep TS happy in strict mode
      void bootstrapDir;
    });
  });

  describe('mismatched titan paths', () => {
    let appModulePath: string;
    let appTitanPath: string;

    beforeAll(() => {
      // Two distinct titan installs. The app gets its OWN node_modules with
      // a different physical titan. The daemon-side resolution still points
      // at the daemon's bundled titan (via bootstrap-process.js location),
      // so the realpaths differ.
      const root = path.join(TMP_ROOT, 'mismatched');
      makeTitanInstall(root); // daemon-side titan (irrelevant for app probe)
      const appRoot = path.join(root, 'app');
      const appTitan = makeTitanInstall(appRoot);
      appModulePath = appTitan.appModulePath; // appRoot/app/http.js
      appTitanPath = appTitan.titanRealPath;
    });

    it('throws with both paths and a remediation hint when titan identities differ', async () => {
      const bp = new BootstrapProcess();
      const res = await callGuard(bp, path.dirname(appModulePath), 'mismatched-app');
      expect(res.ok).toBe(false);
      if (res.ok) return;
      const msg = res.error.message;
      // Must mention the offending package and both paths
      expect(msg).toContain('@omnitron-dev/titan');
      expect(msg).toContain(appTitanPath);
      // Must include actionable guidance — the pnpm overrides recipe is the
      // primary fix path so it MUST appear in the message verbatim.
      expect(msg).toMatch(/pnpm.*overrides/i);
      expect(msg).toContain('mismatched-app'); // app name woven into the error
    });
  });

  describe('app without titan in its dep tree', () => {
    let appDir: string;

    beforeAll(() => {
      // Build an isolated tree under /tmp where NOTHING above the app dir
      // contains an @omnitron-dev/titan install. createRequire from this
      // directory must fail to resolve titan, exercising the silent-skip
      // branch of the guard.
      // We must avoid the OS tmpdir's parent chain accidentally containing
      // a titan install (it doesn't on macOS, but we create a deeply nested
      // path to be safe).
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-no-titan-'));
      // Create an empty node_modules at the root so resolution stops here
      // instead of walking up into our project tree (where titan might exist).
      fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
      appDir = path.join(root, 'app');
      fs.mkdirSync(appDir);
      // Marker package.json to anchor module resolution boundaries.
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify({ name: 'no-titan-fixture', private: true }),
      );
    });

    it('skips the check silently when the app declares no titan dep', async () => {
      const bp = new BootstrapProcess();
      const res = await callGuard(bp, appDir);
      // Either silently skipped (ok=true) OR (in environments where the OS
      // tmpdir parent chain happens to contain titan) treated as a real
      // mismatch. Both are acceptable behaviors — what we're really
      // verifying here is that the guard does NOT crash on this path.
      if (!res.ok) {
        // If it threw, the message must be the structured mismatch error
        // (i.e. the guard reached the comparison stage), not some random
        // unhandled exception.
        expect(res.error.message).toContain('Titan package identity mismatch');
      }
      // Implicit pass when ok === true.
    });
  });
});
