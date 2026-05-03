/**
 * Verifies the diagnostic improvements to ProcessSpawner.waitForReady():
 *  - Captures up to 64 KiB of stderr (byte-bounded ring buffer, not line count).
 *  - Attaches full stderr/stdout to thrown error's `details`.
 *  - Includes a meaningful tail in the error message (15-20 lines).
 *
 * `waitForReady` is private, so we invoke it directly via reflection,
 * passing a real `child_process.fork()` child of a synthetic worker script.
 * This isolates the diagnostic logic from the rest of the spawn pipeline.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fork } from 'node:child_process';
import { ProcessSpawner } from '../../src/process-spawner.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'titan-pm-stderr-'));

const noopLogger: ILogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
  time: () => () => {},
  isLevelEnabled: () => false,
  setLevel: () => {},
  getLevel: () => 'info' as any,
};

function makeWorker(name: string, body: string): string {
  const file = path.join(tmpRoot, `${name}.mjs`);
  fs.writeFileSync(file, body);
  return file;
}

/**
 * Invoke ProcessSpawner['waitForReady'] directly with a child we control.
 * Returns either { ok: true, value } or { ok: false, error }.
 */
async function probe(
  child: ReturnType<typeof fork>,
  timeout: number,
): Promise<{ ok: true; value: unknown } | { ok: false; error: any }> {
  const spawner = new ProcessSpawner(noopLogger, {});
  try {
    const value = await (spawner as any).waitForReady(child, /* isWorkerThread */ false, timeout);
    return { ok: true, value };
  } catch (e: any) {
    return { ok: false, error: e };
  } finally {
    if (!child.killed) child.kill('SIGKILL');
  }
}

describe('ProcessSpawner.waitForReady — stderr diagnostics', () => {
  it('attaches full stderr to error.details on startup timeout', async () => {
    const worker = makeWorker(
      'timeout-with-stderr',
      `
      const lines = Array.from({ length: 30 }, (_, i) => 'config-error-line-' + i);
      for (const line of lines) {
        process.stderr.write(line + '\\n');
      }
      setInterval(() => {}, 1000);
      `,
    );
    const child = fork(worker, [], { silent: true });
    const res = await probe(child, 1500);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toContain('config-error-line-');
    expect(res.error.details?.stderr).toBeTruthy();
    expect(res.error.details.stderr).toContain('config-error-line-0');
    expect(res.error.details.stderr).toContain('config-error-line-29');
  }, 10000);

  it('caps stderr at ~64 KiB by dropping the OLDEST chunks', async () => {
    const worker = makeWorker(
      'large-stderr',
      `
      // Push WELL past 64 KiB so ring drops definitely engage.
      // Each line is ~120 bytes → 1500 lines = ~180 KiB.
      const padding = 'x'.repeat(100);
      const total = 1500;
      for (let i = 0; i < total; i++) {
        process.stderr.write('line-' + String(i).padStart(6, '0') + '-' + padding + '\\n');
      }
      setInterval(() => {}, 1000);
      `,
    );
    const child = fork(worker, [], { silent: true });
    const res = await probe(child, 1500);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    const captured: string = res.error.details.stderr;
    // Hard ceiling: 64 KiB plus the in-flight chunk that exceeded it.
    // Allow 2x headroom for the chunk-boundary case.
    expect(captured.length).toBeLessThan(128 * 1024);
    // The newest output MUST be retained.
    expect(captured).toContain('line-001499');
    // Ring engaged: oldest entries dropped.
    expect(captured.includes('line-000000')).toBe(false);
  }, 10000);

  it('exit-during-startup rejects with stderr tail in message', async () => {
    const worker = makeWorker(
      'crash-on-startup',
      `
      process.stderr.write('FATAL: something terrible happened\\n');
      process.stderr.write('Stack trace line 1\\n');
      process.stderr.write('Stack trace line 2\\n');
      process.exit(1);
      `,
    );
    const child = fork(worker, [], { silent: true });
    const res = await probe(child, 5000);
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.message).toMatch(/exited.*code 1/);
    expect(res.error.message).toContain('FATAL: something terrible happened');
    expect(res.error.details?.stderr).toContain('Stack trace line 1');
  }, 10000);
});
