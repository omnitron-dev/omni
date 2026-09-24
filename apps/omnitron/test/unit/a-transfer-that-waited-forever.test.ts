/**
 * A transfer that waited forever.
 *
 * 2026-09-24, deploying a release to `daos/test`: three artifact transfers
 * started, a lease renewal behind them timed out at 30 s, and from then on
 * the log said «Still delivering 6 artifact(s)» every thirty seconds for 19
 * minutes — the node's deploy lease held — until the master was restarted.
 *
 * Read in `@xec-sh/core`: every channel to a node rides one pooled SSH
 * connection; the timed-out command made the pool close it with a graceful
 * `end()`, which also stops ssh2's keepalive; a transfer still running on it
 * received neither an error nor an end. Nothing on our side bounded it.
 *
 * Two things now hold, and this file holds them: a node takes one transfer
 * at a time (side by side they only queue megabytes in front of the small
 * commands that share the connection), and a transfer that does not finish
 * by its deadline is given up with its words — and the next one goes.
 */

import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExecutionService, uploadDeadlineMs } from '../../src/execution/execution.service.js';

const NODE_A = { host: '37.27.130.185', username: 'root' } as never;
const NODE_B = { host: '203.0.113.9', username: 'root' } as never;

function fileOf(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'transfer-'));
  const p = join(dir, 'app.tar.gz');
  writeFileSync(p, Buffer.alloc(bytes, 1));
  return p;
}

/**
 * The service with an engine whose transfers end only when the test says so
 * (or never), and a node that reports whatever size was sent.
 */
function service(bytes: number) {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const svc: any = Object.create(ExecutionService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getEngine: async () => ({
      ssh: (cfg: { host: string }) => ({
        uploadFile: (_local: string, remote: string) =>
          new Promise<void>((resolve) => {
            started.push(`${cfg.host} ${remote}`);
            finish.set(remote, resolve);
          }),
      }),
    }),
    ssh: async () => ({ exitCode: 0, stdout: `${bytes}\n`, stderr: '' }),
  });
  return { svc, started, finish };
}

/**
 * Wait until `n` transfers have started — the service reads the file's size
 * from the disk first, which is real I/O — then a little longer, so a
 * transfer that should NOT have started has had every chance to.
 */
async function startedCount(started: string[], n: number): Promise<void> {
  await vi.waitFor(() => expect(started).toHaveLength(n), { timeout: 5000, interval: 5 });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('a node takes one transfer at a time', () => {
  it('starts the second transfer to a node only when the first has ended', async () => {
    const { svc, started, finish } = service(4096);
    const file = fileOf(4096);
    const one = svc.uploadFile(NODE_A, file, '/opt/omnitron/a.tar.gz');
    const two = svc.uploadFile(NODE_A, file, '/opt/omnitron/b.tar.gz');
    await startedCount(started, 1);
    expect(started).toEqual(['37.27.130.185 /opt/omnitron/a.tar.gz']);

    finish.get('/opt/omnitron/a.tar.gz')!();
    await one;
    await startedCount(started, 2);
    expect(started).toEqual(['37.27.130.185 /opt/omnitron/a.tar.gz', '37.27.130.185 /opt/omnitron/b.tar.gz']);
    finish.get('/opt/omnitron/b.tar.gz')!();
    await two;
  });

  it('runs transfers to two different nodes side by side', async () => {
    const { svc, started, finish } = service(4096);
    const file = fileOf(4096);
    const a = svc.uploadFile(NODE_A, file, '/opt/omnitron/a.tar.gz');
    const b = svc.uploadFile(NODE_B, file, '/opt/omnitron/b.tar.gz');
    await startedCount(started, 2);
    finish.get('/opt/omnitron/a.tar.gz')!();
    finish.get('/opt/omnitron/b.tar.gz')!();
    await Promise.all([a, b]);
  });
});

describe('a transfer that does not end is given up at its deadline', () => {
  it('rejects naming the file, its size and the time it was given — and the next transfer goes', async () => {
    // Only the clock the deadline reads: the service's disk read and this
    // file's own waiting use I/O and `setImmediate`, which must stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const bytes = 7 * 1024 * 1024;
    const { svc, started, finish } = service(bytes);
    const file = fileOf(bytes);

    const stuck = svc.uploadFile(NODE_A, file, '/opt/omnitron/main.tar.gz');
    const verdict = stuck.then(
      () => 'resolved',
      (err: Error) => err.message,
    );
    const next = svc.uploadFile(NODE_A, file, '/opt/omnitron/geo.tar.gz');
    // Its deadline is armed in the same turn the transfer starts.
    await startedCount(started, 1);
    expect(started).toEqual(['37.27.130.185 /opt/omnitron/main.tar.gz']);

    await vi.advanceTimersByTimeAsync(uploadDeadlineMs(bytes) - 1000);
    expect(started).toHaveLength(1); // still waiting, still in its time

    await vi.advanceTimersByTimeAsync(1000);
    const said = await verdict;
    expect(said).toMatch(/app\.tar\.gz \(7340032 bytes\) to 37\.27\.130\.185:\/opt\/omnitron\/main\.tar\.gz did not finish in 284 s/);
    expect(said).toMatch(/incomplete and was not used/);

    // The queue did not stay behind the one that never ended.
    await startedCount(started, 2);
    expect(started).toEqual(['37.27.130.185 /opt/omnitron/main.tar.gz', '37.27.130.185 /opt/omnitron/geo.tar.gz']);
    finish.get('/opt/omnitron/geo.tar.gz')!();
    await next;
  });

  it('gives a larger file more time, and every file at least a minute', () => {
    expect(uploadDeadlineMs(0)).toBe(60_000);
    expect(uploadDeadlineMs(7 * 1024 * 1024)).toBeGreaterThan(uploadDeadlineMs(1024 * 1024));
    // 26 MB crossed in ~70 s on 2026-09-25; the largest artifact (6.9 MB)
    // took seconds. Its deadline is minutes, not seconds.
    expect(uploadDeadlineMs(6_867_744)).toBeGreaterThan(4 * 60_000);
  });
});
