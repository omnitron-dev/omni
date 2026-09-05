/**
 * Running a dump or restore without a shell.
 *
 * These were `execFile('/bin/sh', ['-c', "pg_dump … | gzip > file"])`, and a
 * shell pipeline reports only the LAST command's exit status. So a `pg_dump`
 * that failed still exited 0 — gzip had succeeded in writing its empty output
 * — and the service recorded a backup: a row in the store, a size, a
 * timestamp. The operator found out when they tried to restore it.
 *
 * Verified directly before the change: a pipeline whose first command does
 * not exist exits 0 and leaves a 20-byte file.
 *
 * These tests use real processes rather than mocks, because what is being
 * pinned is exactly the exit-status and stream behaviour a mock would have to
 * assume.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createGunzip } from 'node:zlib';

import { dumpToFile, restoreFromFile, formatBackupSize } from '../../src/services/backup-pipeline.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-pipeline-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (p: string) => fs.readFileSync(p, 'utf8');

async function readGzipped(p: string): Promise<string> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(p)
      .pipe(createGunzip())
      .on('data', (c) => chunks.push(c as Buffer))
      .on('end', resolve)
      .on('error', reject);
  });
  return Buffer.concat(chunks).toString('utf8');
}

describe('dumpToFile', () => {
  it('writes what the command produced', async () => {
    const out = path.join(dir, 'plain.sql');
    await dumpToFile('printf', ['CREATE TABLE t;'], out, false);

    expect(read(out)).toBe('CREATE TABLE t;');
  });

  it('gzips when asked, and the result decompresses to the same bytes', async () => {
    const out = path.join(dir, 'dump.sql.gz');
    await dumpToFile('printf', ['CREATE TABLE t;'], out, true);

    expect(await readGzipped(out)).toBe('CREATE TABLE t;');
  });

  it('fails when the command fails, which the shell pipeline did not', async () => {
    // The defect this module exists for. `false | gzip > file` exits 0.
    const out = path.join(dir, 'failed.sql.gz');

    await expect(dumpToFile('false', [], out, true)).rejects.toThrow(/exited with code 1/);
  });

  it('leaves no file behind when the command fails', async () => {
    // A partial file is worse than none: it has a plausible size, gets a row
    // in the backup store, and restores nothing.
    const out = path.join(dir, 'failed.sql.gz');

    await expect(dumpToFile('false', [], out, true)).rejects.toThrow();
    expect(fs.existsSync(out)).toBe(false);
  });

  it('carries the command stderr into the error', async () => {
    // The shell version discarded stderr along with the exit status, so a
    // failed backup gave the operator nothing to act on.
    const out = path.join(dir, 'x.sql');

    await expect(
      dumpToFile('sh', ['-c', 'echo "FATAL: database does not exist" >&2; exit 1'], out, false)
    ).rejects.toThrow(/database does not exist/);
  });

  it('fails when the command does not exist at all', async () => {
    const out = path.join(dir, 'x.sql');

    await expect(dumpToFile('definitely-not-a-command', [], out, false)).rejects.toThrow();
    expect(fs.existsSync(out)).toBe(false);
  });

  it('passes arguments without a shell parsing them', async () => {
    // A database or container name containing a space or a quote broke the
    // interpolated command string. As an argv entry it is just a string.
    const out = path.join(dir, 'quoted.sql');
    await dumpToFile('printf', ['%s', 'a name; with "quotes" and $VARS'], out, false);

    expect(read(out)).toBe('a name; with "quotes" and $VARS');
  });

  it('streams rather than buffering, so a large dump is not capped', async () => {
    // The uncompressed local path buffered the whole dump with a 100 MB
    // ceiling. This is only 8 MB — enough to exceed any small buffer without
    // making the suite slow.
    const out = path.join(dir, 'big.sql');
    await dumpToFile('sh', ['-c', 'yes "0123456789abcdef" | head -c 8000000'], out, false);

    expect(fs.statSync(out).size).toBe(8_000_000);
  });
});

describe('restoreFromFile', () => {
  it('feeds the file into the command on stdin', async () => {
    const input = path.join(dir, 'in.sql');
    const output = path.join(dir, 'out.txt');
    fs.writeFileSync(input, 'SELECT 1;');

    await restoreFromFile('sh', ['-c', `cat > "${output}"`], input, false);

    expect(read(output)).toBe('SELECT 1;');
  });

  it('gunzips a compressed backup on the way in', async () => {
    const gz = path.join(dir, 'in.sql.gz');
    const output = path.join(dir, 'out.txt');
    await dumpToFile('printf', ['SELECT 2;'], gz, true);

    await restoreFromFile('sh', ['-c', `cat > "${output}"`], gz, true);

    expect(read(output)).toBe('SELECT 2;');
  });

  it('fails when the restore command fails', async () => {
    const input = path.join(dir, 'in.sql');
    fs.writeFileSync(input, 'SELECT 1;');

    await expect(
      restoreFromFile('sh', ['-c', 'cat >/dev/null; echo "ERROR: relation exists" >&2; exit 3'], input, false)
    ).rejects.toThrow(/exited with code 3.*relation exists/s);
  });

  it('fails rather than reporting success when the input is missing', async () => {
    await expect(
      restoreFromFile('cat', [], path.join(dir, 'nope.sql'), false)
    ).rejects.toThrow();
  });
});

describe('formatBackupSize', () => {
  /**
   * `backup list` printed `(size / 1024 / 1024).toFixed(2) + ' MB'`, which
   * renders everything under ten kilobytes as `0.00 MB`. On this host that is
   * 261 of 391 backup files — mostly legitimate dumps of small databases,
   * shown identically to a dump that captured nothing.
   */
  it('distinguishes an empty backup from a small one', () => {
    expect(formatBackupSize(0)).toBe('empty');
    expect(formatBackupSize(1085)).toBe('1.1 KB');
    // Both of these used to read "0.00 MB".
    expect(formatBackupSize(0)).not.toBe(formatBackupSize(1085));
  });

  it('scales to the unit that carries information', () => {
    expect(formatBackupSize(512)).toBe('512 B');
    expect(formatBackupSize(84_348_233)).toBe('80.4 MB');
    expect(formatBackupSize(530_382_848)).toBe('505.8 MB');
    expect(formatBackupSize(3 * 1024 ** 3)).toBe('3.00 GB');
  });

  it('does not render a nonsensical size as a number', () => {
    expect(formatBackupSize(-1)).toBe('—');
    expect(formatBackupSize(Number.NaN)).toBe('—');
  });
});
