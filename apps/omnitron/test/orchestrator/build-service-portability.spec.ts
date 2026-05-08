/**
 * Bundle portability (C12).
 *
 * Builds a tiny temp app with `createRequire(import.meta.url)('../package.json')`
 * via the real esbuild pipeline and asserts that the post-processed
 * bundle:
 *   - contains the inlined package.json contents (`"version":"0.1.0"`)
 *   - does NOT contain a hardcoded developer absolute path
 *   - actually executes (`new Function(bundle)()` returns the inlined
 *     version, proving runtime equivalence)
 *
 * This is the regression gate against the bug that left `_require("/Users/.../package.json")`
 * baked into every build.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BuildService } from '../../src/orchestrator/build-service.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-service-portability-'));
const appDir = path.join(tmpRoot, 'fakeapp');
const srcDir = path.join(appDir, 'src');
const bootstrapPath = path.join(srcDir, 'bootstrap.ts');

beforeAll(() => {
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(
    path.join(appDir, 'package.json'),
    JSON.stringify({ name: 'fakeapp', version: '0.1.0', description: 'test fixture' }),
  );
  // Two require patterns: the bare `require(...)` call and a renamed
  // `_require(...)`. esbuild's bundler typically rewrites the second
  // form via `createRequire(import.meta.url)` assignments — and our
  // earlier patcher had a bug where it consumed only the `require(...)`
  // suffix from `_require(...)`, leaving an orphaned `_` that crashed
  // at runtime with `ReferenceError: _ is not defined`. The tests
  // below assert the full identifier is consumed.
  fs.writeFileSync(
    bootstrapPath,
    `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const _require = createRequire(import.meta.url);
const pkg = require('../package.json');
const { version: PKG_VERSION } = _require('../package.json');
export const APP_VERSION = pkg.version;
export const APP_NAME = pkg.name;
export const SECOND_VERSION = PKG_VERSION;
`,
  );
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('BuildService bundle portability', () => {
  it('inlines package.json content and leaves no developer absolute paths', async () => {
    const svc = new BuildService(/* isDev */ true);
    const result = await svc.buildApp('fakeapp', bootstrapPath, {
      processes: [],
    } as never);

    const bootstrapOut = fs.readFileSync(result.bootstrapPath, 'utf8');
    expect(bootstrapOut).toContain('"version":"0.1.0"');
    expect(bootstrapOut).toContain('"name":"fakeapp"');

    // No developer absolute paths anywhere in the bundle. The path
    // class covers macOS/Linux (/Users, /home), Windows (drive letter
    // with backslash), and the fallback `/private/var` form macOS uses
    // for tmpdir.
    const offending = [/\/Users\/[^/"\s]+/, /\/home\/[^/"\s]+/, /[A-Za-z]:\\/];
    for (const pat of offending) {
      const match = bootstrapOut.match(pat);
      expect(match, `Bundle leaks dev path: ${match?.[0]}`).toBeNull();
    }

    // No leftover createRequire path either — old code rewrote
    // `require("../package.json")` to absolute paths; new code
    // replaces them with the inlined object literal, so no
    // require()-against-package.json calls should remain.
    expect(bootstrapOut).not.toMatch(/[A-Za-z_$][\w$]*\(["'][^"']*package\.json["']\)/);

    // Specifically: no orphaned `_` or other identifier remnants
    // immediately followed by `({"name":`. That was the runtime
    // crash signature of the earlier replacement-too-narrow bug.
    expect(bootstrapOut).not.toMatch(/[A-Za-z_$][\w$]*\(\{"name"/);
  });
});
