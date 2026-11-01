import fs, { type FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { Writable, type WritableOptions } from 'node:stream';
import { finished } from 'node:stream/promises';
import { ExecutionEngine } from '@xec-sh/core';
import { fileNameError } from '../shared/file-policy.js';
import type { ArchiveFormatCapability, FileArchiveCapabilities, FileArchiveFormat, FileArchiveManifest } from '../shared/dto/files.js';

export const ARCHIVE_LIMITS = { entries: 10_000, depth: 32, bytes: 100 * 1024 ** 3, pathBytes: 4096 } as const;
const COMMAND_TIMEOUT = 30 * 60_000;
const DIAGNOSTIC_BYTES = 64 * 1024;
const FORMATS: ArchiveFormatCapability[] = [
  { format: 'tar', label: 'TAR', extension: '.tar', outputs: ['archive', 'directory'] },
  { format: 'tar.gz', label: 'TAR + gzip', extension: '.tar.gz', outputs: ['archive', 'directory'] },
  { format: 'tar.bz2', label: 'TAR + bzip2', extension: '.tar.bz2', outputs: ['archive', 'directory'] },
  { format: 'tar.xz', label: 'TAR + xz', extension: '.tar.xz', outputs: ['archive', 'directory'] },
  { format: 'tar.zst', label: 'TAR + Zstandard', extension: '.tar.zst', outputs: ['archive', 'directory'] },
  { format: 'zip', label: 'ZIP', extension: '.zip', outputs: ['archive', 'directory'] },
  { format: '7z', label: '7-Zip', extension: '.7z', outputs: ['archive'] },
];
const COMPRESSION: Partial<Record<FileArchiveFormat, string>> = {
  'tar.gz': '-z', 'tar.bz2': '-j', 'tar.xz': '-J', 'tar.zst': '--zstd',
};
const environment = { LC_ALL: 'C', TAR_OPTIONS: '', ZIPOPT: '', UNZIP: '', UNZIPOPT: '',
  GZIP: '', BZIP: '', BZIP2: '', XZ_OPT: '', XZ_DEFAULTS: '', COPYFILE_DISABLE: '1' };
type Entry = FileArchiveManifest['entries'][number];
interface ArchiveOperation {
  format: FileArchiveFormat;
  manifest: FileArchiveManifest;
  signal: AbortSignal;
  /** Bytes written by this phase; archiving reports encoded bytes, restoring reports source bytes. */
  onProgress?: (completedBytes: number) => void;
}
export interface CreateArchiveOptions extends ArchiveOperation { sourceDirectory: string; outputFile: string }
export interface RestoreArchiveOptions extends ArchiveOperation {
  archiveFile: string; outputDirectory: string;
  /** A publisher can verify the private tree before applying its final permissions. */
  preserveModes?: boolean;
}

/** One admission rule shared by source snapshots and destination uploads. */
export function validateArchiveManifest(manifest: FileArchiveManifest): void {
  if (!manifest || manifest.protocol !== 1 || fileNameError(manifest.rootName) || !Array.isArray(manifest.entries) ||
      !manifest.entries.length || manifest.entries.length > ARCHIVE_LIMITS.entries) throw new Error('Invalid archive manifest');
  const directories = new Set<string>();
  const seen = new Set<string>();
  let total = 0;
  for (const [index, entry] of manifest.entries.entries()) {
    if (!entry || typeof entry.path !== 'string' || Buffer.byteLength(entry.path) > ARCHIVE_LIMITS.pathBytes ||
        entry.path.split('/').length > ARCHIVE_LIMITS.depth || entry.path.split('/').some(part => fileNameError(part)) ||
        (entry.path !== manifest.rootName && !entry.path.startsWith(manifest.rootName + '/')) || seen.has(entry.path) ||
        !Number.isSafeInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 ||
        !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > ARCHIVE_LIMITS.bytes ||
        (entry.kind !== 'file' && entry.kind !== 'directory')) throw new Error('Invalid or unsafe archive entry');
    if (index === 0 && (entry.path !== manifest.rootName || entry.kind !== 'directory')) throw new Error('Archive manifest must begin with its root directory');
    if (index > 0 && !directories.has(path.posix.dirname(entry.path))) throw new Error('Archive parent directory must be declared before its children');
    if (entry.kind === 'directory') {
      if (entry.size !== 0 || entry.sha256 !== undefined) throw new Error('Invalid archive directory metadata');
      directories.add(entry.path);
    } else {
      if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('An archive file requires a SHA-256 digest');
      total += entry.size;
      if (total > ARCHIVE_LIMITS.bytes) throw new Error('Archive source exceeds its byte limit');
    }
    seen.add(entry.path);
  }
}

async function privateDirectory(directory: string): Promise<void> {
  if (!path.isAbsolute(directory)) throw new Error('Archive staging requires an absolute private directory');
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 ||
      (process.getuid && stat.uid !== process.getuid())) throw new Error('Archive staging directory must be private and owned by this user');
}

async function writeAll(file: FileHandle, data: Buffer): Promise<void> {
  let offset = 0;
  while (offset < data.length) {
    const written = await file.write(data, offset, data.length - offset);
    if (!written.bytesWritten) throw new Error('Archive output made no write progress');
    offset += written.bytesWritten;
  }
}

/** Only bounded stdout bytes enter this sink; the external decoder never controls paths. */
export class ArchivePayloadWriter extends Writable {
  private readonly files: Entry[];
  private index = 0;
  private file: FileHandle | undefined;
  private hash = createHash('sha256');
  private offset = 0;
  private bytes = 0;
  private pending: Promise<void> = Promise.resolve();
  private readonly preserveModes: boolean;
  constructor(private readonly directory: string, manifest: FileArchiveManifest,
    private readonly signal: AbortSignal, private readonly progress?: (bytes: number) => void, options?: WritableOptions & { preserveModes?: boolean }) {
    super({ ...options, highWaterMark: 256 * 1024 });
    validateArchiveManifest(manifest);
    this.files = manifest.entries.filter(entry => entry.kind === 'file');
    this.preserveModes = options?.preserveModes ?? true;
  }
  private async advance(): Promise<void> {
    while (this.index < this.files.length) {
      this.signal.throwIfAborted();
      const entry = this.files[this.index]!;
      this.file ??= await fs.open(path.join(this.directory, entry.path), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      if (this.destroyed) throw new Error('Archive decoder was cancelled while opening a file');
      if (this.offset !== entry.size) return;
      if (this.hash.digest('hex') !== entry.sha256) throw new Error(`Archive payload checksum mismatch: ${entry.path}`);
      if (this.preserveModes) await this.file.chmod(entry.mode);
      await this.file.sync(); await this.file.close(); this.file = undefined;
      this.index++; this.offset = 0; this.hash = createHash('sha256');
    }
  }
  private async consume(chunk: Buffer): Promise<void> {
    let cursor = 0;
    await this.advance();
    while (cursor < chunk.length) {
      this.signal.throwIfAborted();
      const entry = this.files[this.index];
      if (!entry) throw new Error('Archive decoder emitted bytes beyond the declared manifest');
      const count = Math.min(chunk.length - cursor, entry.size - this.offset);
      const part = chunk.subarray(cursor, cursor + count);
      await writeAll(this.file!, part); this.hash.update(part);
      cursor += count; this.offset += count; this.bytes += count; this.progress?.(this.bytes);
      await this.advance();
    }
  }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.pending = this.consume(chunk); void this.pending.then(() => callback(), callback);
  }
  override _final(callback: (error?: Error | null) => void): void {
    this.pending = this.advance().then(() => {
      if (this.index !== this.files.length) throw new Error('Archive decoder ended before the declared manifest was complete');
      this.signal.throwIfAborted();
    }); void this.pending.then(() => callback(), callback);
  }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    // destroy can race an awaited open/write. Wait for that operation before
    // taking the descriptor; otherwise an open resolving later leaks its fd.
    void this.pending.catch(() => {}).then(async () => {
      const file = this.file; this.file = undefined; await file?.close();
    }).then(() => callback(error), closeError => callback(error ?? closeError));
  }
}

class ArchiveFileWriter extends Writable {
  private bytes = 0;
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly file: FileHandle, private readonly signal: AbortSignal,
    private readonly progress?: (bytes: number) => void) { super({ highWaterMark: 256 * 1024 }); }
  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.pending = (async () => {
      this.signal.throwIfAborted();
      if (this.bytes + chunk.length > ARCHIVE_LIMITS.bytes) throw new Error('Encoded archive exceeds its byte limit');
      await writeAll(this.file, chunk); this.bytes += chunk.length; this.progress?.(this.bytes);
    })(); void this.pending.then(() => callback(), callback);
  }
  override _final(callback: (error?: Error | null) => void): void { this.pending = this.file.sync(); void this.pending.then(() => callback(), callback); }
  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    void this.pending.catch(() => {}).then(() => callback(error));
  }
}

async function command(program: string, args: string[], options: { cwd: string; signal: AbortSignal; stdin?: string; stdout?: Writable; timeout?: number }): Promise<void> {
  options.signal.throwIfAborted();
  const controller = new AbortController();
  // Keep the caller's longer-lived cancellation token detached once this command
  // exits. It must never signal a recycled native PID after the operation ends.
  const signal = controller.signal;
  let active = true;
  const engine = new ExecutionEngine({ defaultShell: false, maxBuffer: DIAGNOSTIC_BYTES, enableEvents: false,
    adapters: { local: { forceImplementation: 'node', killSignal: 'SIGKILL' } } });
  const sink = options.stdout;
  const sinkFailure = (error: Error) => { if (active) controller.abort(error); };
  const cancel = () => {
    if (active) controller.abort(options.signal.reason);
    sink?.destroy(options.signal.reason instanceof Error ? options.signal.reason : new Error('Archive operation cancelled'));
  };
  options.signal.addEventListener('abort', cancel, { once: true });
  sink?.on('error', sinkFailure);
  const draining = sink ? finished(sink) : Promise.resolve();
  void draining.catch(() => {});
  const executing = engine.execute({ command: program, args, shell: false, adapter: 'local', env: environment,
    cwd: options.cwd, ...(options.stdin !== undefined && { stdin: options.stdin }), stdout: sink ?? 'ignore', stderr: 'pipe', maxBuffer: DIAGNOSTIC_BYTES,
    signal, timeout: options.timeout ?? COMMAND_TIMEOUT, throwOnNonZeroExit: true })
    .finally(() => { active = false; });
  try {
    await Promise.all([executing, draining]);
    signal.throwIfAborted();
  } catch (error) {
    if (active) controller.abort(error); sink?.destroy(error instanceof Error ? error : new Error(String(error)));
    await Promise.allSettled([executing, draining]); throw error;
  } finally {
    options.signal.removeEventListener('abort', cancel);
    // finished() rejects on error before an asynchronous _destroy necessarily
    // finishes. The caller must not close its output fd until work has drained.
    if (sink?.destroyed && !sink.closed) await new Promise<void>(resolve => sink.once('close', resolve));
    sink?.off('error', sinkFailure); await engine.dispose();
  }
}

function capability(format: FileArchiveFormat): ArchiveFormatCapability {
  const result = FORMATS.find(item => item.format === format);
  if (!result) throw new Error('Unsupported archive format');
  return result;
}

async function validateSnapshot(directory: string, manifest: FileArchiveManifest, signal: AbortSignal): Promise<void> {
  await privateDirectory(directory);
  const expected = new Map(manifest.entries.map(entry => [entry.path, entry]));
  const visit = async (relative: string): Promise<void> => {
    for (const name of await fs.readdir(path.join(directory, relative))) {
      signal.throwIfAborted();
      const child = relative ? relative + '/' + name : name;
      const entry = expected.get(child);
      if (!entry) throw new Error('Archive snapshot contains an undeclared entry');
      const stat = await fs.lstat(path.join(directory, child));
      if (stat.isSymbolicLink() || (entry.kind === 'directory' ? !stat.isDirectory() : !stat.isFile()))
        throw new Error('Archive snapshot contains a symbolic link or special entry');
      if (entry.kind === 'directory') await visit(child);
    }
  };
  await visit('');
  for (const entry of manifest.entries) {
    signal.throwIfAborted();
    const stat = await fs.lstat(path.join(directory, entry.path));
    if (stat.isSymbolicLink() || (entry.kind === 'file' ? !stat.isFile() || stat.size !== entry.size || stat.nlink !== 1 : !stat.isDirectory()))
      throw new Error(`Archive snapshot disagrees with its manifest: ${entry.path}`);
  }
}

/** Archives are built from a private immutable snapshot, with an explicit ordered entry list. */
export async function createArchive(options: CreateArchiveOptions): Promise<void> {
  capability(options.format); validateArchiveManifest(options.manifest); options.signal.throwIfAborted();
  await validateSnapshot(options.sourceDirectory, options.manifest, options.signal);
  await privateDirectory(path.dirname(options.outputFile));
  const sourceRoot = await fs.realpath(options.sourceDirectory);
  const outputPath = path.join(await fs.realpath(path.dirname(options.outputFile)), path.basename(options.outputFile));
  if (!path.isAbsolute(options.outputFile) || outputPath === sourceRoot || outputPath.startsWith(sourceRoot + path.sep)) throw new Error('Archive output must be outside its source snapshot');
  if (options.format === '7z') { await createSevenZip(options); return; }
  const file = await fs.open(options.outputFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  const sink = new ArchiveFileWriter(file, options.signal, options.onProgress);
  const entries = options.manifest.entries.map(entry => './' + entry.path + (entry.kind === 'directory' ? '/' : ''));
  try {
    if (options.format === 'zip') {
      await command('zip', ['-q', '-X', '-', '-@'], { cwd: options.sourceDirectory, signal: options.signal, stdin: entries.join('\n') + '\n', stdout: sink });
    } else {
      const compression = COMPRESSION[options.format];
      await command('tar', [...(compression ? [compression] : []), '-c', '-f', '-', '--no-recursion', '--no-xattrs', '--null', '-T', '-'],
        { cwd: options.sourceDirectory, signal: options.signal, stdin: entries.join('\0') + '\0', stdout: sink });
    }
  } catch (error) { await fs.unlink(options.outputFile).catch(() => {}); throw error; }
  finally { await file.close(); }
}

/** Native tools only write stdout. Validated manifest paths are the sole filesystem authority. */
export async function restoreArchive(options: RestoreArchiveOptions): Promise<void> {
  const format = capability(options.format); validateArchiveManifest(options.manifest); options.signal.throwIfAborted();
  if (!format.outputs.includes('directory')) throw new Error('This format is available as an archive file only');
  if (!path.isAbsolute(options.archiveFile)) throw new Error('Archive input requires an absolute private staging path');
  await privateDirectory(path.dirname(options.archiveFile));
  await privateDirectory(options.outputDirectory);
  if ((await fs.readdir(options.outputDirectory)).length) throw new Error('Archive restore requires an empty private staging directory');
  const source = await fs.lstat(options.archiveFile);
  if (!source.isFile() || source.isSymbolicLink() || source.size > ARCHIVE_LIMITS.bytes) throw new Error('Archive input must be a bounded regular file');
  for (const entry of options.manifest.entries) if (entry.kind === 'directory') {
    options.signal.throwIfAborted(); await fs.mkdir(path.join(options.outputDirectory, entry.path), { mode: 0o700 });
  }
  const sink = new ArchivePayloadWriter(options.outputDirectory, options.manifest, options.signal, options.onProgress,
    { preserveModes: options.preserveModes ?? true });
  if (options.format === 'zip') {
    await command('unzip', ['-p', options.archiveFile], { cwd: options.outputDirectory, signal: options.signal, stdout: sink });
  } else {
    const compression = COMPRESSION[options.format];
    await command('tar', [...(compression ? [compression] : []), '-x', '-O', '-f', options.archiveFile],
      { cwd: options.outputDirectory, signal: options.signal, stdout: sink });
  }
  if (options.preserveModes !== false) for (const entry of [...options.manifest.entries].reverse()) if (entry.kind === 'directory')
      await fs.chmod(path.join(options.outputDirectory, entry.path), entry.mode);
}

/** 7z requires a seekable destination; it is never offered as an automatic extraction format. */
async function createSevenZip(options: CreateArchiveOptions): Promise<void> {
  try { await fs.lstat(options.outputFile); throw new Error('Archive output already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  let checking: Promise<void> | undefined;
  const check = async () => {
    if (checking) return checking;
    checking = (async () => { try {
      const stat = await fs.lstat(options.outputFile);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ARCHIVE_LIMITS.bytes) throw new Error('Encoded archive exceeds its byte limit or changed type');
      options.onProgress?.(stat.size);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') controller.abort(error); }
    finally { checking = undefined; } })();
    return checking;
  };
  const timer = setInterval(() => { void check(); }, 100); timer.unref();
  try {
    await command('7z', ['a', '-t7z', '-sae', '-bd', '-bso0', '-bsp0', '-bse2', '--', options.outputFile, './' + options.manifest.rootName],
      { cwd: options.sourceDirectory, signal });
    clearInterval(timer); await checking; await check(); signal.throwIfAborted(); await fs.chmod(options.outputFile, 0o600);
    await command('7z', ['t', '-bd', '-bso0', '-bsp0', '-bse2', '--', options.outputFile], { cwd: options.sourceDirectory, signal });
  } catch (error) { await fs.unlink(options.outputFile).catch(() => {}); throw error; }
  finally { clearInterval(timer); await checking; }
}

let observed: { until: number; value: FileArchiveCapabilities } | undefined;
let probing: Promise<FileArchiveCapabilities> | undefined;
/** The selected node proves actual encoding/decoding, rather than guessing from executable versions. */
export async function probeArchiveFormats(): Promise<FileArchiveCapabilities> {
  if (observed && observed.until > Date.now()) return structuredClone(observed.value);
  probing ??= probe().finally(() => { probing = undefined; });
  return structuredClone(await probing);
}

async function probe(): Promise<FileArchiveCapabilities> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-archive-probe-'));
  await fs.chmod(directory, 0o700);
  const formats: ArchiveFormatCapability[] = [];
  try {
    const snapshot = path.join(directory, 'snapshot'); await fs.mkdir(snapshot, { mode: 0o700 });
    const rootName = 'probe'; await fs.mkdir(path.join(snapshot, rootName), { mode: 0o700 });
    const entries: FileArchiveManifest['entries'] = [{ path: rootName, kind: 'directory', size: 0, mode: 0o700 }];
    // Deliberately non-alphabetic order, binary bytes, spaces, an empty file and an empty directory.
    for (const [name, data] of [['z file', Buffer.from([0, 255, 127, 32])], ['a file', Buffer.from('second')], ['empty', Buffer.alloc(0)]] as const) {
      await fs.writeFile(path.join(snapshot, rootName, name), data, { mode: 0o600 });
      entries.push({ path: rootName + '/' + name, kind: 'file', size: data.length, mode: 0o600, sha256: createHash('sha256').update(data).digest('hex') });
    }
    await fs.mkdir(path.join(snapshot, rootName, 'empty-dir'), { mode: 0o700 });
    entries.push({ path: rootName + '/empty-dir', kind: 'directory', size: 0, mode: 0o700 });
    const manifest: FileArchiveManifest = { protocol: 1, rootName, entries };
    // Each probe owns separate output paths. Bound the entire RPC to one probe
    // window rather than seven consecutive tool timeouts.
    const availableFormats = await Promise.all(FORMATS.map(async format => {
      const signal = AbortSignal.timeout(10_000);
      try {
        const outputFile = path.join(directory, 'encoded-' + format.format);
        await createArchive({ format: format.format, sourceDirectory: snapshot, outputFile, manifest, signal });
        const available: ArchiveFormatCapability = { ...format, outputs: ['archive'] };
        if (format.outputs.includes('directory')) {
          const outputDirectory = path.join(directory, 'decoded-' + format.format); await fs.mkdir(outputDirectory, { mode: 0o700 });
          try {
            await restoreArchive({ format: format.format, archiveFile: outputFile, outputDirectory, manifest, signal });
            available.outputs.push('directory');
          } catch { /* A working encoder remains useful even when safe decoding is unavailable. */ }
        }
        return available;
      } catch { /* An unavailable codec is omitted; actual operations still fail visibly if it changes later. */ }
      return undefined;
    }));
    formats.push(...availableFormats.filter((format): format is ArchiveFormatCapability => format !== undefined));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
  const value: FileArchiveCapabilities = { formats, observedAt: new Date().toISOString(), limitations: [
    'Availability is verified on this node and cached for one minute; destination decoding is checked independently.',
    'Archives include regular files and directories only: at most 10,000 entries, 32 path components and 100 GiB of source or encoded bytes.',
    'Automatic restoration requires the transfer manifest and exact SHA-256 hashes; 7-Zip is available as an archive file only.',
    'Destination directory support currently requires a verified local encoder/decoder pair; an installed decoder alone is not advertised.',
    'Archive files preserve executable and group/other permission bits; snapshots add owner read/traverse access. Directory transfers restore the exact manifest modes.',
  ] };
  observed = { until: Date.now() + 60_000, value }; return value;
}
