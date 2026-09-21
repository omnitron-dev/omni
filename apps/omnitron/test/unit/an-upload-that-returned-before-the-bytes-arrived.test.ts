/**
 * An upload that returned before the bytes arrived.
 *
 * Measured 2026-09-21, delivering the portal to `daos-test`:
 * `uploadFile` returned without error, the next step ran `tar -xzf` on what
 * it had written, and the node answered
 *
 *     gzip: stdin: unexpected end of file
 *     tar: Unexpected EOF in archive
 *     tar: Error is not recoverable: exiting now
 *
 * A 19 687 584-byte archive had arrived short. Nothing between the transfer
 * and the extraction asked how long the file was, so the failure surfaced
 * three steps later as a corrupt archive — and its consequence was that the
 * gateway was configured with no static root and served nothing at `/`.
 *
 * The transfer is not finished when the call returns. It is finished when
 * the bytes are there, and that is a question with an answer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { ExecutionService } from '../../src/execution/execution.service.js';

const TARGET = { host: '37.27.130.185', username: 'root' } as never;

function localFileOf(bytes: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'upload-probe-'));
  const p = join(dir, 'static.tar.gz');
  writeFileSync(p, Buffer.alloc(bytes, 7));
  return p;
}

/**
 * The service with only what `uploadFile` touches: an engine that "uploads"
 * without moving anything, and an `ssh` that answers however the node would.
 */
function service(remoteSizes: Array<number | string>) {
  const uploaded = vi.fn(async () => {});
  const asked: string[] = [];
  const svc: any = Object.create(ExecutionService.prototype);
  Object.assign(svc, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    getEngine: async () => ({ ssh: () => ({ uploadFile: uploaded }) }),
    ssh: async (_t: unknown, cmd: string) => {
      asked.push(cmd);
      const next = remoteSizes.shift();
      return { exitCode: 0, stdout: `${next ?? ''}\n`, stderr: '' };
    },
  });
  return { svc, uploaded, asked };
}

describe('an upload is finished when the bytes are there', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns when the node has the size that was sent', async () => {
    const { svc, uploaded, asked } = service([4096]);
    await svc.uploadFile(TARGET, localFileOf(4096), '/opt/omnitron/x.tar.gz');
    expect(uploaded).toHaveBeenCalledTimes(1);
    // It asked, and it asked about the file it wrote.
    expect(asked[0]).toContain('/opt/omnitron/x.tar.gz');
  });

  it('retries once when the file landed short', async () => {
    const { svc, uploaded } = service([1024, 4096]);
    await svc.uploadFile(TARGET, localFileOf(4096), '/opt/omnitron/x.tar.gz');
    expect(uploaded).toHaveBeenCalledTimes(2);
  });

  it('refuses, naming both sizes, when it lands short twice', async () => {
    const { svc, uploaded } = service([1024, 2048]);
    await expect(
      svc.uploadFile(TARGET, localFileOf(4096), '/opt/omnitron/x.tar.gz')
    ).rejects.toThrow(/landed 2048 of 4096 bytes, twice/);
    expect(uploaded).toHaveBeenCalledTimes(2);
  });

  it('refuses when the node cannot say how big the file is', async () => {
    // An unreadable answer is not a passing one: `wc -c` on a path that is
    // not there prints nothing, and `NaN === expected` is false — which is
    // the behaviour wanted, said out loud so it is not "fixed" later.
    const { svc } = service(['', '']);
    await expect(
      svc.uploadFile(TARGET, localFileOf(4096), '/opt/omnitron/x.tar.gz')
    ).rejects.toThrow(/an unreadable size of 4096 bytes/);
  });
});
