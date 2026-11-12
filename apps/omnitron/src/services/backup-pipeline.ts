/**
 * Streaming backup transfers with one deadline for the local command, streams
 * and durable file publication. Partial files never take the final backup name;
 * uncertain cleanup retains private staging and reports the unresolved state.
 * Container exec ownership must be verified by its caller: closing the local
 * Docker client alone is not evidence that its remote process has stopped.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { FileHandle } from 'node:fs/promises';
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

/**
 * A moment as UTC, to the second, with the zone written on it.
 *
 * `backup list` printed `new Date(createdAt).toLocaleString()` — the daemon
 * host's local time with no zone at all — beside filenames that carry UTC.
 * Measured on the master: `geo_2026-09-23T08-19-04-…` listed as
 * `9/23/2026, 11:19:04 AM`, three hours apart and nothing saying which of the
 * two was right. Lives here, beside `formatBackupSize`, because this is the
 * one module both the daemon and the CLI load without the service's graph.
 */
export function formatUtc(moment: string | number | Date): string {
  const d = new Date(moment);
  if (Number.isNaN(d.getTime())) return String(moment);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Shortest id prefix of at least `min` characters that still tells every id apart. */
export function uniqueIdPrefixLength(ids: string[], min = 8): number {
  const longest = ids.reduce((n, id) => Math.max(n, id.length), 0);
  for (let len = min; len < longest; len++) {
    if (new Set(ids.map((id) => id.slice(0, len))).size === ids.length) return len;
  }
  return Math.max(min, longest);
}

/** Below this, a prefix names a handful of backups at random rather than one on purpose. */
export const MIN_BACKUP_ID_PREFIX = 4;

/**
 * The one backup an id — or an unambiguous prefix of one — names.
 *
 * `restoreBackup` compared the argument with `===` against a full UUID, and
 * nothing the CLI printed carried one: `backup list` showed Database,
 * Filename cut to 24 characters (`geo_2026-09-23T08-19-04-`, the id is after
 * the cut) and Size; `backup create` printed `[a63dbcf4]`, eight characters
 * that restore then refused as "not found". Shared by the daemon and the CLI,
 * so both sides read a prefix the same way.
 *
 * @throws naming every candidate when the prefix matches more than one, and
 *         saying so when it matches none — never a guess.
 */
export function resolveBackupId<T extends { id: string }>(
  rows: T[],
  idOrPrefix: string,
  describe: (row: T) => string = (row) => row.id,
): T {
  const wanted = String(idOrPrefix ?? '').trim().toLowerCase();
  const exact = rows.find((r) => r.id.toLowerCase() === wanted);
  if (exact) return exact;
  if (wanted.length < MIN_BACKUP_ID_PREFIX) {
    throw new Error(
      `Backup '${idOrPrefix}' not found — an id prefix needs at least ${MIN_BACKUP_ID_PREFIX} characters`,
    );
  }
  const matches = rows.filter((r) => r.id.toLowerCase().startsWith(wanted));
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`Backup '${idOrPrefix}' not found`);
  throw new Error(
    `Backup id prefix '${idOrPrefix}' matches ${matches.length} backups: ` +
      `${matches.map(describe).join('; ')} — give more of the id`,
  );
}

export interface PipelineOptions {
  /** Total time for process execution, streams and file publication, in milliseconds. */
  timeoutMs?: number;
  /** Environment for the spawned command (e.g. PGPASSWORD). */
  env?: NodeJS.ProcessEnv;
}

const DEFAULT_TIMEOUT_MS = 600_000;
const MAX_TIMEOUT_MS = 86_400_000;
const CLEANUP_TIMEOUT_MS = 3_000;

type ProcessResult = { code: number | null; signal: NodeJS.Signals | null };

interface FileTransfer {
  direction: 'dump' | 'restore';
  location: string;
  prepare?(): Promise<void>;
  pipe(child: ChildProcess, signal: AbortSignal): Promise<void>;
  publish?(checkDeadline: () => void): Promise<void>;
  cleanup?(settled: boolean): Promise<void>;
}

async function withinCleanup<T>(task: Promise<T>, deadline: number, location: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Pipeline cleanup did not settle within ${CLEANUP_TIMEOUT_MS} ms; inspect ${location}`)),
        Math.max(0, deadline - performance.now()));
    })]);
  } finally { clearTimeout(timer); }
}

/** One lifecycle for a local child and its streams; remote exec ownership is separate. */
async function runFileTransfer(command: string, args: string[], options: PipelineOptions, transfer: FileTransfer): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS)
    throw new Error(`Backup pipeline timeout must be an integer between 1 and ${MAX_TIMEOUT_MS} ms`);

  const deadline = performance.now() + timeoutMs;
  const controller = new AbortController();
  let stderr = '';
  const expire = () => {
    const limit = timeoutMs >= 1000 ? `${timeoutMs / 1000} s` : `${timeoutMs} ms`;
    controller.abort(new Error(`${command} pipeline exceeded its ${limit} deadline${stderr ? `: ${stderr.trim()}` : ''}`));
  };
  const timer = setTimeout(expire, timeoutMs);
  const checkDeadline = () => {
    if (performance.now() >= deadline && !controller.signal.aborted) expire();
    controller.signal.throwIfAborted();
  };
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  // A deadline can expire during setup, before the execution race is awaited.
  void aborted.catch(() => undefined);

  let child: ChildProcess | undefined;
  let stopChild: ((graceMs: number) => Promise<boolean>) | undefined;
  const pending = new Set<Promise<unknown>>();
  const track = <T>(task: Promise<T>): Promise<T> => {
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  const wait = <T>(task: Promise<T>) => Promise.race([track(task), aborted]);
  let cleanupDeadline: number | undefined;
  let failure: unknown;
  const cleanupErrors: unknown[] = [];
  try {
    // Keep the CLI formatting/read path free of the PM graph. Load the existing
    // verified shutdown primitive before spawning, never only after a failure.
    const [{ killChildAndVerify }, { createNullLogger }] = await Promise.race([Promise.all([
      import('@omnitron-dev/titan-pm'), import('@omnitron-dev/titan/module/logger'),
    ]), aborted]);
    checkDeadline();
    const preparation = transfer.prepare?.();
    if (preparation) await wait(preparation);
    checkDeadline();
    const processGroup = process.platform !== 'win32';
    child = spawn(command, args, {
      env: options.env ?? process.env,
      detached: processGroup,
      stdio: transfer.direction === 'dump' ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'ignore', 'pipe'],
    });
    const ownedChild = child;
    stopChild = graceMs => killChildAndVerify(ownedChild, createNullLogger(), { command }, 0,
      { force: true, processGroup, killGraceMs: graceMs });
    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, Math.max(0, 8192 - stderr.length));
    });
    const started = new Promise<void>((resolve, reject) => {
      ownedChild.once('spawn', resolve);
      ownedChild.once('error', reject);
    });
    const exited = new Promise<ProcessResult>((resolve, reject) => {
      ownedChild.once('exit', (code, signal) => resolve({ code, signal }));
      ownedChild.once('error', reject);
    });
    const closed = track(new Promise<void>(resolve => ownedChild.once('close', () => resolve())));
    void exited.catch(() => undefined);
    await wait(started);
    checkDeadline();
    const pumping = track(transfer.pipe(child, controller.signal));
    const successfulExit = exited.then(({ code, signal }) => {
      if (code !== 0) throw new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}${stderr ? `: ${stderr.trim()}` : ''}`);
    });
    await wait(Promise.all([pumping, successfulExit, closed]));
    checkDeadline();
    const publication = transfer.publish?.(checkDeadline);
    if (publication) await wait(publication);
    checkDeadline();
  } catch (error) {
    failure = controller.signal.aborted ? controller.signal.reason : error;
    controller.abort(failure);
    cleanupDeadline = performance.now() + CLEANUP_TIMEOUT_MS;
    if (child) {
      // Abort the transfer as well as its process. A dead producer does not
      // settle a blocked gzip/file stream, and a broken output does not kill
      // a producer that ignores a closed pipe.
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
      try {
        const stopped = await withinCleanup(stopChild!(Math.max(0, cleanupDeadline - performance.now())), cleanupDeadline, transfer.location);
        if (!stopped) throw new Error(`Local process cleanup was not confirmed for ${command} (pid ${child.pid})`, { cause: error });
      } catch (cleanupError) { cleanupErrors.push(cleanupError); }
    }
    try { await withinCleanup(Promise.allSettled([...pending]), cleanupDeadline, transfer.location); }
    catch (cleanupError) { cleanupErrors.push(cleanupError); }
  } finally {
    clearTimeout(timer);
    try {
      const cleanup = transfer.cleanup?.(pending.size === 0);
      if (cleanup) await withinCleanup(cleanup, cleanupDeadline ?? performance.now() + CLEANUP_TIMEOUT_MS, transfer.location);
    } catch (cleanupError) { cleanupErrors.push(cleanupError); }
  }
  if (cleanupErrors.length) {
    throw new AggregateError(failure === undefined ? cleanupErrors : [failure, ...cleanupErrors],
      `${failure === undefined ? 'Backup pipeline' : failure instanceof Error ? failure.message : String(failure)}; cleanup failed: ${cleanupErrors.map(error => error instanceof Error ? error.message : String(error)).join('; ')}`,
      failure === undefined ? undefined : { cause: failure });
  }
  if (failure !== undefined) throw failure;
}

/** Stream a command into a private file, then durably publish it without replacing any destination. */
export async function dumpToFile(
  command: string,
  args: string[],
  outputPath: string,
  compress: boolean,
  options: PipelineOptions = {},
): Promise<void> {
  const staging = `${outputPath}.${randomUUID()}.partial`;
  let file: FileHandle | undefined;
  let output: fs.WriteStream | undefined;
  let owned: { dev: number; ino: number } | undefined;
  let created = false;
  let published = false;
  const closeFile = async () => {
    output?.destroy();
    await file?.close();
    file = undefined;
  };
  try {
    await runFileTransfer(command, args, options, {
      direction: 'dump',
      location: staging,
      async prepare() {
        // Refuse before spawning, and independently protect the publication race
        // with link(), which atomically refuses an occupied final name.
        try {
          await fs.promises.lstat(outputPath);
          throw new Error(`Backup destination already exists: ${outputPath}`);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        file = await fs.promises.open(staging, 'wx', 0o600);
        created = true;
        const { dev, ino } = await file.stat();
        owned = { dev, ino };
      },
      pipe(child, signal) {
        output = file!.createWriteStream({ autoClose: false });
        return compress
          ? pipeline(child.stdout!, createGzip(), output, { signal })
          : pipeline(child.stdout!, output, { signal });
      },
      async publish(checkDeadline) {
        await file!.sync();
        checkDeadline();
        await closeFile();
        checkDeadline();
        await fs.promises.link(staging, outputPath);
        published = true;
        // The complete file may already be visible if fsync/deadline fails. Never
        // unlink that name: another writer could have replaced it in the meantime.
        checkDeadline();
        await fs.promises.unlink(staging);
        owned = undefined;
        created = false;
        checkDeadline();
        const directory = await fs.promises.open(path.dirname(outputPath), 'r');
        try { checkDeadline(); await directory.sync(); } finally { await directory.close(); }
        checkDeadline();
      },
      async cleanup(settled) {
        // Closing a FileHandle waits for its pending kernel I/O. Even if the
        // bounded caller stops waiting, this continuation only closes our handle
        // and retains the staging name; it can never publish or unlink a final.
        await closeFile();
        if (!settled) throw new Error(`Transfer settlement was not confirmed; retained backup staging ${staging}`);
        if (!created) return;
        if (!owned) throw new Error(`Backup staging identity was not confirmed; retained ${staging}`);
        const current = await fs.promises.lstat(staging);
        if (current.dev !== owned.dev || current.ino !== owned.ino)
          throw new Error(`Backup staging identity changed; retained ${staging}`);
        await fs.promises.unlink(staging);
      },
    });
  } catch (error) {
    if (published) throw new Error(`Backup publication was not confirmed; destination left at ${outputPath}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    throw error;
  }
}

/** Stream a file into a command; report explicitly if local cleanup cannot be confirmed. */
export async function restoreFromFile(
  command: string,
  args: string[],
  inputPath: string,
  compressed: boolean,
  options: PipelineOptions = {},
): Promise<void> {
  await runFileTransfer(command, args, options, {
    direction: 'restore',
    location: inputPath,
    pipe(child, signal) {
      const input = fs.createReadStream(inputPath);
      return compressed
        ? pipeline(input, createGunzip(), child.stdin!, { signal })
        : pipeline(input, child.stdin!, { signal });
    },
  });
}
