/**
 * Running a dump or restore without a shell.
 *
 * Every one of these was `execFile('/bin/sh', ['-c', "pg_dump … | gzip > file"])`,
 * which has three faults and the first is the serious one:
 *
 *   1. **A shell pipeline reports only the LAST command's exit status.**
 *      `pg_dump … | gzip > file` exits 0 when pg_dump fails, because gzip
 *      succeeded in writing its (empty) output. Verified: a pipeline whose
 *      first command does not exist exits 0 and leaves a 20-byte file. So a
 *      backup that dumped nothing was recorded as a backup — with a row in
 *      the store, a size, and a timestamp — and the operator found out when
 *      they tried to restore it.
 *   2. Names and paths were interpolated into a command string. A container,
 *      user or database name containing a space or a quote breaks the
 *      command; the values come from a project's own config, so this is a
 *      correctness problem before it is anything else.
 *   3. The uncompressed local path buffered the entire dump in memory with a
 *      100 MB ceiling, which an ordinary database exceeds.
 *
 * Streaming through `spawn` fixes all three: both ends of the pipe are real
 * processes whose exit codes are observed, arguments are passed as an array
 * so nothing is parsed, and nothing is held in memory.
 *
 * ## …and the file only takes its name once it is whole
 *
 * All of that catches a dump that FAILS. None of it catches a dump that is
 * never allowed to finish: the process killed, the host disk full, the VM
 * stopped mid-write. There no catch of ours runs, and the stream has been
 * writing under the FINAL name since its first byte.
 *
 * Measured in `~/.omnitron/backups` after this host filled on 2026-09-14 —
 * `main_…07-51….sql.gz` at 98 304 bytes and `priceverse_…sql.gz` at 1.5 MB,
 * both a gzip header with the body cut off, both sitting under their final
 * names where a restore would have taken them. So the write goes to
 * `<name>.partial` and is renamed once the exit code has been checked.
 */

import { spawn } from 'node:child_process';
import { createGzip, createGunzip } from 'node:zlib';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

/**
 * Render a byte count so a small backup cannot be mistaken for an empty one.
 *
 * `backup list` printed `(size / 1024 / 1024).toFixed(2) + ' MB'`, which shows
 * every backup under ten kilobytes as `0.00 MB`. On this host that is 261 of
 * 391 files — mostly legitimate dumps of small databases, rendered
 * indistinguishable from a dump that captured nothing.
 */
export function formatBackupSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes === 0) return 'empty';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export interface PipelineOptions {
  /** Milliseconds before both processes are killed. */
  timeoutMs?: number;
  /** Extra environment for the spawned command (e.g. PGPASSWORD). */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 600_000;

/**
 * Run `command args…`, sending stdout to `outputPath`, optionally gzipped.
 *
 * @throws when the command exits non-zero, carrying its stderr — which the
 *         shell version discarded along with the exit status.
 */
export async function dumpToFile(
  command: string,
  args: string[],
  outputPath: string,
  compress: boolean,
  options: PipelineOptions = {}
): Promise<void> {
  // Written under a name that is not a backup, and renamed once it is one.
  const staging = `${outputPath}.partial`;
  await fs.promises.rm(staging, { force: true });

  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    // Bounded: a failing pg_dump can be talkative, and the reason is at the
    // start rather than the end.
    if (stderr.length < 8192) stderr += String(chunk);
  });

  const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // Attached before anything is awaited, so neither event can be missed and
  // no 'error' arrives without a listener.
  const started = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  // A spawn failure rejects both promises, and only `started` is awaited on
  // that path — leaving `exited` rejected with nobody listening, which under
  // Node's default is a crash of the whole process. Marking it handled here
  // costs nothing and is not a swallowed error: the same failure still
  // arrives through `started`.
  exited.catch(() => undefined);

  let pumping: Promise<void> | undefined;

  try {
    // Wait for the process to exist before creating the file. `spawn` reports
    // ENOENT asynchronously, so the previous version had already opened the
    // write stream by then: the catch below removed the file, and the stream
    // — still opening — recreated it a moment later. A failed dump left an
    // empty file on disk, which is the one thing this module's own comment
    // says must not happen. It showed up as a test failing only in a loaded
    // full run, because load is what decides which side of the race wins.
    await started;

    const out = fs.createWriteStream(staging);
    pumping = compress ? pipeline(child.stdout, createGzip(), out) : pipeline(child.stdout, out);

    // Both of these must be awaited together. Awaiting only the stream would
    // resolve on a clean EOF from a command that then exits non-zero — which
    // is exactly the failure the shell version could not see.
    const [, code] = await Promise.all([pumping, exited]);

    if (code !== 0) {
      throw new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    }

    // Only now does the name exist. Rename within a directory is atomic, so
    // the visible state is binary: either no file, or a complete one. The
    // guard above covers a dump that FAILED; this covers one that was never
    // allowed to finish — the process killed, the host disk full — where no
    // catch of ours runs at all.
    await fs.promises.rename(staging, outputPath);
  } catch (err) {
    // Let the pipeline finish failing before removing the file. Otherwise the
    // same race returns by the other door: `Promise.all` rejects on the exit
    // code while the stream is still writing, and the write lands after the
    // removal. Its rejection is also the one nothing else is waiting on.
    if (pumping) await pumping.catch(() => undefined);
    // A partial file is worse than none: it has a plausible size and restores
    // nothing. Both names, because the rename may have happened before a
    // later step threw.
    await fs.promises.rm(staging, { force: true });
    await fs.promises.rm(outputPath, { force: true });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Feed `inputPath` into `command args…` on stdin, optionally gunzipping.
 *
 * @throws when the command exits non-zero, carrying its stderr.
 */
export async function restoreFromFile(
  command: string,
  args: string[],
  inputPath: string,
  compressed: boolean,
  options: PipelineOptions = {}
): Promise<void> {
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: ['pipe', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    if (stderr.length < 8192) stderr += String(chunk);
  });

  const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const started = new Promise<void>((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
  const exited = new Promise<number>((resolve, reject) => {
    child.once('close', resolve);
    child.once('error', reject);
  });
  // A spawn failure rejects both promises, and only `started` is awaited on
  // that path — leaving `exited` rejected with nobody listening, which under
  // Node's default is a crash of the whole process. Marking it handled here
  // costs nothing and is not a swallowed error: the same failure still
  // arrives through `started`.
  exited.catch(() => undefined);

  let pumping: Promise<void> | undefined;

  try {
    // Same reason as `dumpToFile`: nothing is opened until the process is
    // known to exist. Here it costs less — a read stream on a missing command
    // leaves no artefact — but a file handle opened for a process that never
    // started is still a handle nobody closes.
    await started;

    const input = fs.createReadStream(inputPath);
    pumping = compressed ? pipeline(input, createGunzip(), child.stdin) : pipeline(input, child.stdin);

    const [, code] = await Promise.all([pumping, exited]);

    if (code !== 0) {
      throw new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    }
  } catch (err) {
    if (pumping) await pumping.catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
