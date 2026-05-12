/**
 * Adversarial test for T#55 under SIGKILL-mid-write (T#78).
 *
 * The T#55 regression test pins the atomic write-rename recipe
 * for the StateStore: tmp file → fsync → rename. This test
 * sharpens the assertion under an actively hostile fault model
 * using the `flaky-fs.ts` primitives: we DELIBERATELY truncate the
 * write to the temp file (simulating a SIGKILL caught mid-syscall)
 * and verify that the on-disk state at `stateFile` is EITHER the
 * full prior state OR absent — never half-written.
 *
 * Before T#55 this same scenario would have left a torn JSON file
 * at `stateFile`; `load()` returned null and the daemon's
 * supervised-process registry was silently wiped.
 *
 * Why an adversarial test in addition to the existing regression
 * test? The regression test verifies the happy-path recipe works.
 * The adversarial test verifies the FAILURE-PATH invariants hold:
 *   - no torn final file
 *   - no stale temp siblings
 *   - load() returns the previous-good state
 * These are the properties the design CLAIMS — pinning them lets a
 * future "optimisation" that breaks the recipe fail loudly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { StateStore, type PersistedState } from '../../src/daemon/state-store.js';
import { installFlakyFs, type FlakyFsHandle } from './flaky-fs.js';

const GOOD: PersistedState = {
  version: '0.1.0',
  updatedAt: 1_700_000_000_000,
  apps: [
    { name: 'main', pid: 100, status: 'online', mode: 'bootstrap', startedAt: 1, restarts: 0, port: 3001 },
  ],
};

const NEXT: PersistedState = {
  version: '0.1.0',
  updatedAt: 1_700_000_010_000,
  apps: [
    { name: 'main', pid: 100, status: 'online', mode: 'bootstrap', startedAt: 1, restarts: 1, port: 3001 },
    { name: 'storage', pid: 101, status: 'online', mode: 'bootstrap', startedAt: 2, restarts: 0, port: 3002 },
  ],
};

describe('StateStore — adversarial torn-write (T#78 × T#55)', () => {
  let tmpDir: string;
  let stateFile: string;
  let store: StateStore;
  let flaky: FlakyFsHandle | null = null;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnitron-t78-'));
    stateFile = path.join(tmpDir, 'state.json');
    store = new StateStore(stateFile);
    // Seed with a known-good prior state.
    store.save(GOOD);
  });

  afterEach(() => {
    flaky?.restore();
    flaky = null;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('SIGKILL during write to tmp leaves the prior state intact', () => {
    // Arm the next writeSync to truncate after 8 bytes and throw.
    flaky = installFlakyFs([{ kind: 'truncate-write', afterBytes: 8 }]);

    expect(() => store.save(NEXT)).toThrow();

    // The committed file at `stateFile` is STILL the prior good state —
    // the rename never happened because the tmp write threw before it.
    const onDisk = store.load();
    expect(onDisk).not.toBeNull();
    expect(onDisk!.updatedAt).toBe(GOOD.updatedAt);
    expect(onDisk!.apps).toHaveLength(1);

    // No stray .tmp.* sibling — the failed write cleanup path
    // unlinked it. This is the OTHER half of T#55's contract: a
    // failed save must not leak temp files for the next save's
    // unique-suffix logic to compete with.
    const stray = fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp.'));
    expect(stray).toEqual([]);
  });

  it('EPERM during rename leaves prior state intact and cleans temp', () => {
    flaky = installFlakyFs([{ kind: 'rename-eperm' }]);

    expect(() => store.save(NEXT)).toThrow(/EPERM|simulated/i);

    const onDisk = store.load();
    expect(onDisk!.updatedAt).toBe(GOOD.updatedAt);
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp.'))).toEqual([]);
  });

  it('two failed saves in a row do not leak temp files', () => {
    flaky = installFlakyFs([
      { kind: 'truncate-write', afterBytes: 4 },
      { kind: 'rename-eperm' },
    ]);
    expect(() => store.save(NEXT)).toThrow();
    expect(() => store.save(NEXT)).toThrow(/EPERM|simulated/i);

    // After two distinct failure modes back-to-back, no stale temp
    // sibling remains, the prior state is intact, and the next
    // (clean) save can proceed.
    expect(fs.readdirSync(tmpDir).filter((f) => f.includes('.tmp.'))).toEqual([]);
    expect(store.load()!.updatedAt).toBe(GOOD.updatedAt);

    flaky.restore();
    flaky = null;
    store.save(NEXT);
    expect(store.load()!.updatedAt).toBe(NEXT.updatedAt);
  });
});
