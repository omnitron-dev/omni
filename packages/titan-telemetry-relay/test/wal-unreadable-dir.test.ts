/**
 * An unreadable WAL directory must not present as an empty WAL.
 *
 * `listSegments()` returned `[]` on any failure, and six call sites read it.
 * Two matter: `readAll()` then finds nothing to forward, and `stats()` reports
 * `segments: 0`. So a directory that had become unreadable — removed underneath
 * the process, permissions changed, an I/O fault — looked exactly like a WAL
 * that had been drained: the relay quietly stopped forwarding telemetry, and
 * the statistics confirmed there was nothing to forward.
 *
 * There is no ambiguity to preserve: the constructor creates the directory, so
 * by the time `listSegments()` runs it exists. Any failure is abnormal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { TelemetryWal } from '../src/telemetry-wal.js';

describe('TelemetryWal — unreadable segment directory', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wal-unreadable-'));
  });

  afterEach(() => {
    try {
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('reports no listError while the directory is readable', async () => {
    const wal = new TelemetryWal({ directory: dir });
    wal.append([{ ts: Date.now(), name: 'probe', value: 1 } as never]);
    await wal.flush();

    const stats = wal.stats();
    expect(stats.segments).toBeGreaterThan(0);
    expect(stats.listError).toBeUndefined();
  });

  it('distinguishes "could not look" from "nothing there"', async () => {
    const wal = new TelemetryWal({ directory: dir });
    wal.append([{ ts: Date.now(), name: 'probe', value: 1 } as never]);
    await wal.flush();
    expect(wal.stats().segments).toBeGreaterThan(0);

    // Remove the directory out from under the WAL — the shape of an operator
    // clearing disk, or a tmpfs being recycled.
    fs.rmSync(dir, { recursive: true, force: true });

    const stats = wal.stats();
    // The count is still zero — callers iterate segments and must not crash —
    // but it now says why, so `segments: 0` cannot be read as "all forwarded".
    expect(stats.segments).toBe(0);
    expect(stats.listError).toBeDefined();
    expect(stats.listError).toMatch(/ENOENT|no such file/i);
  });

  it('clears the error once the directory can be read again', async () => {
    const wal = new TelemetryWal({ directory: dir });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(wal.stats().listError).toBeDefined();

    fs.mkdirSync(dir, { recursive: true });

    expect(wal.stats().listError).toBeUndefined();
  });
});
