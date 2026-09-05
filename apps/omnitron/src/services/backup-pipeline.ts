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

  try {
    const out = fs.createWriteStream(outputPath);

    // Both of these must be awaited together. Awaiting only the stream would
    // resolve on a clean EOF from a command that then exits non-zero — which
    // is exactly the failure the shell version could not see.
    const [, code] = await Promise.all([
      compress ? pipeline(child.stdout, createGzip(), out) : pipeline(child.stdout, out),
      new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }),
    ]);

    if (code !== 0) {
      throw new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    }
  } catch (err) {
    // A partial file is worse than none: it has a plausible size and restores
    // nothing.
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

  try {
    const input = fs.createReadStream(inputPath);

    const [, code] = await Promise.all([
      compressed
        ? pipeline(input, createGunzip(), child.stdin)
        : pipeline(input, child.stdin),
      new Promise<number>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      }),
    ]);

    if (code !== 0) {
      throw new Error(`${command} exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`);
    }
  } finally {
    clearTimeout(timer);
  }
}
