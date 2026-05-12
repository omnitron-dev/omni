/**
 * Fault-injection primitives for the adversarial test suite (T#78).
 *
 * Why this exists
 * ---------------
 * Each individual audit fix has its own regression test that pins
 * the BEHAVIOUR for the specific failure mode it addresses. What
 * those tests don't cover is COMPOUND failures: e.g.
 * SIGKILL-mid-write while PG is down while the disk is full. Real
 * production incidents look like that, not like the curated
 * single-fault scenarios that produce the cleanest unit tests.
 *
 * This module gives test authors a small kit of reusable
 * primitives for composing those scenarios. Future audit work
 * extends it; today's seed lets us at least prove T#55 (atomic
 * write-rename) holds under SIGKILL-mid-write by simulating the
 * partial-write at the syscall layer rather than by actually
 * killing a child process.
 *
 * Design goals
 * ------------
 * - **Compose-able**: each primitive is a small, focused helper
 *   that can be combined with others (e.g. flaky-fs + fake-clock).
 * - **Local**: tests don't shell out to real disks, real
 *   PostgreSQL, or real children. Every "fault" is in-process so
 *   the suite stays fast and deterministic.
 * - **Reversible**: every patch records its undo and the test's
 *   teardown can restore the unpatched module in any order.
 */

import fs from 'node:fs';

export type FlakyMode =
  | { kind: 'truncate-write'; afterBytes: number }
  | { kind: 'fail-write'; error: NodeJS.ErrnoException }
  | { kind: 'rename-eperm' };

export interface FlakyFsHandle {
  /** Disarm and restore original fs methods. */
  restore(): void;
  /** How many writeFileSync calls have been observed. */
  writeCallCount(): number;
  /** How many renameSync calls have been observed. */
  renameCallCount(): number;
}

/**
 * Install programmable failure modes on `fs`'s sync write/rename
 * APIs. The original methods are restored on `restore()`.
 *
 * Failure modes
 *   - `truncate-write` — writeFileSync / write writes only the
 *     first N bytes of the payload then THROWS. Simulates a
 *     SIGKILL during the kernel's `write()` syscall: the partial
 *     bytes are committed to the FD; the process never gets to
 *     finish.
 *   - `fail-write` — writeFileSync / write throws the supplied
 *     ErrnoException without touching the FD. Simulates ENOSPC,
 *     EIO, EBUSY without needing a real disk to be full or busy.
 *   - `rename-eperm` — renameSync throws EPERM. Simulates the
 *     window between "tmp file written" and "rename committed"
 *     under permission/quota pressure.
 */
export function installFlakyFs(modes: FlakyMode[]): FlakyFsHandle {
  const queue = [...modes];
  const origWriteFileSync = fs.writeFileSync;
  const origWrite = fs.writeSync;
  const origRenameSync = fs.renameSync;

  let writeCount = 0;
  let renameCount = 0;

  // We patch by reassignment on the imported `fs` module. Vitest
  // re-evaluates this module per test file so the patch is scoped
  // to whoever called `installFlakyFs` — restore() must run on
  // teardown.
  (fs as any).writeFileSync = (file: any, data: any, options?: any) => {
    writeCount++;
    const next = queue[0];
    if (next?.kind === 'truncate-write') {
      queue.shift();
      const buf = typeof data === 'string' ? Buffer.from(data, options?.encoding ?? 'utf-8') : (data as Buffer);
      const truncated = buf.subarray(0, Math.min(next.afterBytes, buf.length));
      origWriteFileSync.call(fs, file, truncated as any, options);
      throw Object.assign(new Error('simulated SIGKILL during write (T#78)'), { code: 'SIGKILL' });
    }
    if (next?.kind === 'fail-write') {
      queue.shift();
      throw next.error;
    }
    return origWriteFileSync.call(fs, file, data, options);
  };

  (fs as any).writeSync = (fd: number, data: any, ...rest: any[]) => {
    writeCount++;
    const next = queue[0];
    if (next?.kind === 'truncate-write') {
      queue.shift();
      const buf = typeof data === 'string' ? Buffer.from(data) : (data as Buffer);
      const truncated = buf.subarray(0, Math.min(next.afterBytes, buf.length));
      origWrite.call(fs, fd, truncated as any, ...(rest as []));
      throw Object.assign(new Error('simulated SIGKILL during write (T#78)'), { code: 'SIGKILL' });
    }
    if (next?.kind === 'fail-write') {
      queue.shift();
      throw next.error;
    }
    return origWrite.call(fs, fd, data, ...(rest as []));
  };

  (fs as any).renameSync = (oldPath: any, newPath: any) => {
    renameCount++;
    const next = queue[0];
    if (next?.kind === 'rename-eperm') {
      queue.shift();
      throw Object.assign(new Error('simulated EPERM during rename (T#78)'), { code: 'EPERM' });
    }
    return origRenameSync.call(fs, oldPath, newPath);
  };

  return {
    restore() {
      (fs as any).writeFileSync = origWriteFileSync;
      (fs as any).writeSync = origWrite;
      (fs as any).renameSync = origRenameSync;
    },
    writeCallCount: () => writeCount,
    renameCallCount: () => renameCount,
  };
}
