/** Bulk transfer connections are isolated, serialized per node and bounded by progress. */
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionService, UPLOAD_STALL_MS, uploadDeadlineMs } from '../../src/execution/execution.service.js';
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'isolated-upload-'));
  dirs.push(dir);
  const source = join(dir, 'source');
  writeFileSync(source, Buffer.alloc(7 * 1024 * 1024, 1));
  const started: { host: string; remote: string; finish: () => void }[] = [];
  const dispose = vi.fn(async () => {});
  const svc: any = Object.create(ExecutionService.prototype);
  Object.assign(svc, {
    logger: { warn: vi.fn() },
    getEngine: async () => {
      throw Error('Bulk connection leaked into control pool');
    },
    createTransferEngine: vi.fn(async () => ({
      ssh: (config: { host: string }) => ({
        uploadFile: (local: string, remote: string) =>
          new Promise<void>((resolve) => {
            started.push({
              host: config.host,
              remote,
              finish: () => {
                copyFileSync(local, remote);
                resolve();
              },
            });
          }),
      }),
      dispose,
    })),
    ssh: async (_: unknown, command: string) => ({
      exitCode: 0,
      stdout: execFileSync('sh', ['-c', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }),
      stderr: '',
    }),
  });
  return { dir, source, started, dispose, svc };
}
async function count(started: unknown[], n: number) {
  await vi.waitFor(() => expect(started).toHaveLength(n), { timeout: 5000, interval: 5 });
}
it('serializes uploads to one node while a different node may transfer independently', async () => {
  const f = fixture();
  const one = f.svc.uploadFile({ host: 'a' }, f.source, join(f.dir, 'one'));
  const two = f.svc.uploadFile({ host: 'a' }, f.source, join(f.dir, 'two'));
  const other = f.svc.uploadFile({ host: 'b' }, f.source, join(f.dir, 'other'));
  await count(f.started, 2);
  expect(f.started.map((s) => s.host).sort()).toEqual(['a', 'b']);
  f.started.find((s) => s.host === 'b')!.finish();
  await other;
  f.started.find((s) => s.host === 'a')!.finish();
  await one;
  await count(f.started, 3);
  f.started[2]!.finish();
  await two;
  expect(f.dispose).toHaveBeenCalledTimes(3);
});
it('abandons two stalled isolated connections, preserves the destination and releases the queue', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const f = fixture();
  const destination = join(f.dir, 'first');
  writeFileSync(destination, 'prior');
  const stuck = f.svc.uploadFile({ host: 'a' }, f.source, destination);
  const verdict = stuck.then(
    () => 'resolved',
    (e: Error) => e.message
  );
  const next = f.svc.uploadFile({ host: 'a' }, f.source, join(f.dir, 'next'));
  await count(f.started, 1);
  await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS);
  await count(f.started, 2);
  await vi.advanceTimersByTimeAsync(UPLOAD_STALL_MS);
  expect(await verdict).toContain('made no progress for 120 s');
  await count(f.started, 3);
  f.started[2]!.finish();
  await next;
  expect(f.dispose).toHaveBeenCalledTimes(3);
});
it('retains a size-dependent total deadline in addition to no-progress detection', () => {
  expect(uploadDeadlineMs(0)).toBe(60000);
  expect(uploadDeadlineMs(7 * 1024 * 1024)).toBe(284000);
  expect(uploadDeadlineMs(7 * 1024 * 1024)).toBeGreaterThan(uploadDeadlineMs(1024 * 1024));
});
