/**
 * A backup interrupted half-way took its final name anyway.
 *
 * Everything in `backup-pipeline.ts` catches a dump that FAILS: exit codes on
 * both ends of the pipe, a stream error, a spawn that never happened. None of
 * it catches a dump that is never allowed to FINISH — the process killed, the
 * host disk full, the VM stopped mid-write. There no catch of ours runs, and
 * the stream has been writing under the final name since its first byte.
 *
 * Measured in `~/.omnitron/backups` after this host filled on 2026-09-14:
 *
 *     main_2026-09-14T07-51…sql.gz          98 304 B   gzip header, body cut off
 *     priceverse_2026-09-10T06-27…sql.gz      1.5 MB   same
 *     storage-objects_2026-07-02T10-22…gz       122 B  «OCI runtime exec failed:
 *                                                       "tar": not found in $PATH»
 *
 * Four files under backup names, none of which opens. The check they passed
 * was `size === 0`, and **"not empty" is not "not corrupt"** — 98 KB of
 * truncated gzip is not empty, and neither is a 122-byte shell error message
 * sitting under a `.tar.gz` name.
 *
 * Two changes, and they answer two different questions:
 *
 *   - the write goes to `<name>.partial` and is renamed after the exit code
 *     is checked, so the visible state is binary — rename within a directory
 *     is atomic;
 *   - `execToFile` OPENS the result (`gzip -t`, `PRAGMA integrity_check`)
 *     before the rename, so a command that exits zero having produced
 *     nonsense does not publish it.
 *
 * Found by a colleague auditing the backup directory after the outage; the
 * four measurements above are theirs.
 *
 * Related: [[a_zero_is_not_an_absence]] — the same shape, one layer down: a
 * property that matters (does it open) measured by a proxy (how many bytes).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { dumpToFile } from '../../src/services/backup-pipeline.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'bk-partial-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the final name appears only when the file is whole', () => {
  it('a successful dump lands under its name, readable', async () => {
    const out = path.join(dir, 'ok.sql.gz');
    await dumpToFile('/bin/sh', ['-c', 'printf "CREATE TABLE t();"'], out, true);
    expect(existsSync(out)).toBe(true);
    expect(gunzipSync(readFileSync(out)).toString()).toBe('CREATE TABLE t();');
  });

  it('and nothing is left beside it', () => {
    // The staging name is an implementation detail; a leftover would sit in
    // the backup directory forever, in no listing.
    expect(existsSync(path.join(dir, 'ok.sql.gz.partial'))).toBe(false);
  });

  it('a dump killed mid-write leaves no file under the backup name', async () => {
    // The shape of the outage: bytes are produced, then the producer dies
    // before it finishes. The old version had been writing to `out` from the
    // first byte, so this left a truncated archive under a backup name.
    const out = path.join(dir, 'killed.sql.gz');
    await expect(
      dumpToFile('/bin/sh', ['-c', 'printf "PARTIAL DATA…"; sleep 5'], out, true, { timeoutMs: 300 }),
    ).rejects.toThrow();
    expect(existsSync(out), 'a truncated dump took the backup name').toBe(false);
    expect(existsSync(`${out}.partial`), 'and left its staging file behind').toBe(false);
  });

  it('a command that fails after writing output leaves nothing either', async () => {
    // `pg_dump` can emit a header and then fail. The exit code is the tell,
    // and the file must not survive it.
    //
    // This is also what pins the ORDER: renaming before the exit code is
    // checked publishes a complete-looking archive of a failed dump. The
    // first version of this file asserted only `existsSync(out) === false`
    // after the throw, which a rename-then-check version satisfies by
    // deleting the file it had just published — correct at rest, and wrong
    // for however long the removal takes.
    const out = path.join(dir, 'failed.sql.gz');
    await expect(
      dumpToFile('/bin/sh', ['-c', 'printf "SOME SQL"; exit 3'], out, true),
    ).rejects.toThrow(/exited with code 3/);
    expect(existsSync(out)).toBe(false);
  });

  it('and the name is never published while the dump is still running', async () => {
    // Watched rather than inferred: poll for the final name while the dump
    // is producing output. The stream must be writing somewhere else.
    const out = path.join(dir, 'watched.sql.gz');
    let seenEarly = false;
    const watching = setInterval(() => {
      if (existsSync(out)) seenEarly = true;
    }, 5);

    await expect(
      dumpToFile('/bin/sh', ['-c', 'printf "HEADER"; sleep 0.4; exit 3'], out, true),
    ).rejects.toThrow(/exited with code 3/);
    clearInterval(watching);

    expect(seenEarly, 'the backup name existed before the dump had finished').toBe(false);
    expect(existsSync(out)).toBe(false);
  });

  it('a leftover staging file does not survive a failure', async () => {
    // Otherwise every failed attempt adds a file to the backup directory:
    // invisible to the index, counted by nothing, and removed by no one.
    const out = path.join(dir, 'leftover.sql.gz');
    await expect(
      dumpToFile('/bin/sh', ['-c', 'printf "X"; exit 1'], out, true),
    ).rejects.toThrow();
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it('a command that does not exist leaves nothing', async () => {
    const out = path.join(dir, 'enoent.sql.gz');
    await expect(dumpToFile('/nonexistent/command', [], out, false)).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
    expect(existsSync(`${out}.partial`)).toBe(false);
  });

  it('a stale staging file from an earlier attempt is not what gets published', async () => {
    const out = path.join(dir, 'retry.sql.gz');
    writeFileSync(`${out}.partial`, 'LEFTOVER FROM A KILLED RUN');

    await dumpToFile('/bin/sh', ['-c', 'printf "FRESH"'], out, true);
    expect(gunzipSync(readFileSync(out)).toString()).toBe('FRESH');
    expect(statSync(out).size).toBeLessThan(100);
  });
});

/**
 * Two of these are ORDER, and order is not fully observable from behaviour.
 *
 * Renaming before the exit code is checked, rather than after, publishes a
 * complete-looking archive of a failed dump — and then the catch removes it.
 * At rest the two orders are indistinguishable: no file either way. The
 * difference is a window of microseconds in which a restore reads a
 * truncated archive, and a mutation of that order passes every behavioural
 * assertion above, measured.
 *
 * The same holds for clearing a stale staging file before the run: the catch
 * clears it too, and `createWriteStream` truncates, so only a process killed
 * between the two leaves anything behind.
 *
 * Both are worth keeping and neither is worth pretending a behaviour test
 * pins. So they are pinned as what they are — the shape of the code — with
 * this note saying why, rather than by an assertion that reads as behavioural
 * and is not.
 */
describe('the order, which behaviour cannot distinguish', () => {
  const SRC = readFileSync(new URL('../../src/services/backup-pipeline.ts', import.meta.url), 'utf8');
  const FN = SRC.slice(
    SRC.indexOf('export async function dumpToFile('),
    SRC.indexOf('export async function', SRC.indexOf('export async function dumpToFile(') + 10),
  );

  it('the rename comes after the exit code is checked', () => {
    expect(FN.indexOf('exited with code')).toBeLessThan(FN.indexOf('rename(staging, outputPath)'));
  });

  it('and the staging file is cleared before the process starts', () => {
    expect(FN.indexOf('rm(staging')).toBeLessThan(FN.indexOf('spawn(command'));
  });
});
