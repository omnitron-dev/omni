/**
 * Regression test for the esbuild rebuild storm.
 *
 * Symptom (production): `omni/dev/main` cycling through 10+ restarts per
 * second, esbuild Go sidecar at >300% CPU, app status oscillating between
 * starting/online/stopped instead of stabilising at online.
 *
 * Two compounding causes were fixed:
 *
 *   1. The rebuild-notify plugin called the change callback on every
 *      successful onEnd — even when the resulting bundle bytes were
 *      identical to the previous build. Editor saves, IDE auto-format,
 *      atime updates, and concurrent workspace-package rebuilds all
 *      emitted onEnd events that produced byte-equal output. The hash
 *      guard suppresses those.
 *
 *   2. The 300 ms tail-debounce was undersized: IDEs touch a file 2-3
 *      times within a few hundred ms on save (prettier, eslint --fix,
 *      LSP code action). The reset-on-each-touch behaviour delayed the
 *      restart instead of suppressing it, which is fine for ONE save
 *      but collapsed under steady editor activity. Bumped to 750 ms
 *      with a MAX_WAIT ceiling so a runaway upstream still gets through.
 *
 * The spec runs a real esbuild context against a temp source file and
 * counts how many times the change callback fires across a controlled
 * sequence of writes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { BuildService } from '../../src/orchestrator/build-service.js';
import type { IAppDefinition } from '../../src/config/types.js';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'build-service-rebuild-loop-'));
const appDir = path.join(tmpRoot, 'app');
const srcDir = path.join(appDir, 'src');
const sourceFile = path.join(srcDir, 'app.module.ts');
const bootstrapFile = path.join(srcDir, 'bootstrap.ts');

beforeAll(() => {
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'rebuild-loop-fixture', version: '0.0.0' }));
  fs.writeFileSync(sourceFile, `export const v = 1;\n`);
  // bootstrap imports the module so the watch graph includes sourceFile.
  fs.writeFileSync(bootstrapFile, `import { v } from './app.module.js';\nexport default { processes: [{ name: 'http', module: './app.module.js' }], v };\n`);
});

afterAll(() => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
});

const definition: IAppDefinition = {
  name: 'rebuild-loop-fixture',
  processes: [{ name: 'http', module: './app.module.js' }],
};

/**
 * `touch` a file without changing its content. mimics what an IDE
 * auto-formatter does when it processes a file but leaves the contents
 * idempotent.
 */
function touch(file: string): void {
  const now = new Date();
  fs.utimesSync(file, now, now);
}

describe('BuildService.watchApp — rebuild-loop guards', () => {
  it('does not fire onRebuild when the bundle output is byte-equal', { timeout: 30_000 }, async () => {
    const svc = new BuildService(true);
    let calls = 0;
    await svc.watchApp('rebuild-loop-fixture', bootstrapFile, definition, () => { calls += 1; });

    // Give esbuild a beat to settle the initial build.
    await sleep(800);

    // Idempotent touches. Bundle bytes should not change, so onRebuild
    // must stay at 0.
    for (let i = 0; i < 5; i++) {
      touch(sourceFile);
      await sleep(60);
    }
    // Wait well past the debounce window so any straggler would fire.
    await sleep(1_200);
    expect(calls).toBe(0);

    await svc.unwatchApp('rebuild-loop-fixture');
    await svc.dispose();
  });

  it('coalesces a burst of edits into a single onRebuild via tail-debounce', { timeout: 30_000 }, async () => {
    const svc = new BuildService(true);
    let calls = 0;
    await svc.watchApp('rebuild-loop-fixture', bootstrapFile, definition, () => { calls += 1; });

    await sleep(800);

    // Editor-save burst: 4 actual content changes within ~500ms. Each
    // is a real bundle delta, but the debounce should collapse them.
    for (let i = 2; i <= 5; i++) {
      fs.writeFileSync(sourceFile, `export const v = ${i};\n`);
      await sleep(120);
    }
    // Wait past the debounce + a generous build margin.
    await sleep(2_000);

    expect(calls).toBeGreaterThanOrEqual(1);
    expect(calls).toBeLessThanOrEqual(2);

    await svc.unwatchApp('rebuild-loop-fixture');
    await svc.dispose();
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
