/**
 * LogManager — Project-scoped log routing, error log separation, per-app rotation
 *
 * Directory layout:
 *   ~/.omnitron/logs/omnitron.log          — daemon all-level log
 *   ~/.omnitron/logs/omnitron.error.log    — daemon error+fatal only
 *   ~/.omnitron/projects/{project}/{stack}/logs/{app}/app.log
 *   ~/.omnitron/projects/{project}/{stack}/logs/{app}/error.log
 *   ~/.omnitron/logs/{app}/app.log         — standalone (no project context)
 *   ~/.omnitron/logs/{app}/error.log
 */

import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { ensurePrivateDir, sealFile, PRIVATE_FILE_MODE } from '../shared/private-files.js';
import { pipeline } from 'node:stream/promises';
import type { LogEntryDto } from '../config/types.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import { expandPath } from '../shared/paths.js';
import { LineAssembler, fileLineOf, type LogRecord } from './log-line.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogRotationConfig {
  maxSize: string;
  maxFiles: number;
  compress: boolean;
}

export interface LogManagerConfig {
  baseDir: string;                                       // ~/.omnitron
  defaults: LogRotationConfig;                           // Global defaults
  perApp?: Map<string, Partial<LogRotationConfig>>;      // Per-app overrides (keyed by short name)
}

/** @deprecated Use LogManagerConfig instead */
export type LegacyLogManagerConfig = {
  directory: string;
  maxSize: string;
  maxFiles: number;
  compress: boolean;
};

type LogType = 'app' | 'error';

/**
 * How much of an app's captured output `getLogs` can answer from. The file is
 * the record; this is the live end of it. Count-bounded like the ring buffer it
 * replaces, and size-bounded because a record is now a whole dump — the largest
 * measured is 7 KB — rather than one line of it.
 */
const CAPTURED_RECORDS_PER_APP = 1000;
const CAPTURED_CHARS_PER_APP = 2 * 1024 * 1024;

interface CapturedRing {
  entries: Array<{ seq: number; entry: LogEntryDto; chars: number }>;
  chars: number;
}

// ---------------------------------------------------------------------------
// LogManager
// ---------------------------------------------------------------------------

export class LogManager {
  private readonly baseDir: string;
  private readonly defaults: LogRotationConfig;
  private readonly perApp: Map<string, Partial<LogRotationConfig>>;
  private rotationCheckTimer: NodeJS.Timeout | null = null;

  /**
   * Async write-stream cache keyed by absolute log path. Pre-fix
   * `appendToFile` issued `fs.appendFileSync` per line — under a
   * managed app spamming 100k log lines/sec the daemon's event loop
   * blocked on disk every iteration; `omnitron list` timed out, WS
   * clients disconnected, the file watcher debounce fired repeatedly.
   * Streams hand the writes to Node's threadpool with native
   * backpressure (`write()` returns false when the buffer fills,
   * callers can pause or queue). P1-K.
   */
  private readonly writeStreams = new Map<string, fs.WriteStream>();

  /**
   * An app's lines become records here, once, at capture — see `log-line.ts`.
   *
   * `getLogs` used to re-read the orchestrator's ring of raw lines on every
   * call and date each non-JSON line `Date.now()` at that moment: `omnitron
   * logs paysys -f` printed 26 distinct lines 304 times in 7 s, because every
   * poll made the same old lines new again. A record is dated when it is
   * captured and never again.
   */
  private readonly assembler = new LineAssembler((app, record) => this.persist(app, record));

  /** Records as captured, per app, in the order they arrived. */
  private readonly captured = new Map<string, CapturedRing>();
  /** Arrival order across apps — how `getLogs()` with no name interleaves them. */
  private captureSeq = 0;

  constructor(
    config: LogManagerConfig | LegacyLogManagerConfig,
    private readonly orchestrator: OrchestratorService,
  ) {
    // Support both new and legacy config shapes
    if ('baseDir' in config) {
      this.baseDir = expandPath(config.baseDir);
      this.defaults = config.defaults;
      this.perApp = config.perApp ?? new Map();
    } else {
      // Legacy compat: directory pointed to ~/.omnitron/logs
      this.baseDir = expandPath(config.directory).replace(/\/logs\/?$/, '');
      this.defaults = { maxSize: config.maxSize, maxFiles: config.maxFiles, compress: config.compress };
      this.perApp = new Map();
    }

    // Ensure base log dir exists
    ensurePrivateDir(path.join(this.baseDir, 'logs'));

    // Periodic rotation check for daemon's own log files (every 60s)
    this.rotationCheckTimer = setInterval(() => {
      this.checkRotation('omnitron', 'app');
      this.checkRotation('omnitron', 'error');
    }, 60_000);
    this.rotationCheckTimer.unref();
  }

  dispose(): void {
    if (this.rotationCheckTimer) {
      clearInterval(this.rotationCheckTimer);
      this.rotationCheckTimer = null;
    }
    // A record still waiting for its continuation lines is written before the
    // streams close, not dropped with them.
    this.assembler.dispose();
    // Flush + close every active write stream so no buffered log
    // lines are lost on daemon shutdown. `end()` is idempotent.
    for (const stream of this.writeStreams.values()) {
      try { stream.end(); } catch { /* best-effort */ }
    }
    this.writeStreams.clear();
  }

  // -------------------------------------------------------------------------
  // Path resolution — project-scoped directories
  // -------------------------------------------------------------------------

  /**
   * Resolve the log directory for an app.
   *
   * - `"omnitron"` → `~/.omnitron/logs/`
   * - `"project/stack/app"` → `~/.omnitron/projects/{project}/{stack}/logs/{app}/`
   * - `"app"` (standalone) → `~/.omnitron/logs/{app}/`
   */
  getLogDir(appName: string): string {
    if (appName === 'omnitron') {
      return path.join(this.baseDir, 'logs');
    }

    const parts = appName.split('/');
    if (parts.length >= 3) {
      const [project, stack, ...rest] = parts;
      const app = rest.join('/');
      return path.join(this.baseDir, 'projects', project!, stack!, 'logs', app);
    }

    // Standalone app
    return path.join(this.baseDir, 'logs', appName);
  }

  /**
   * Full file path for a log type.
   *
   * - Daemon: `omnitron.log` / `omnitron.error.log`
   * - Apps: `app.log` / `error.log`
   */
  getLogFilePath(appName: string, type: LogType = 'app'): string {
    const dir = this.getLogDir(appName);
    ensurePrivateDir(dir);

    if (appName === 'omnitron') {
      return path.join(dir, type === 'error' ? 'omnitron.error.log' : 'omnitron.log');
    }
    return path.join(dir, type === 'error' ? 'error.log' : 'app.log');
  }

  // -------------------------------------------------------------------------
  // Per-app rotation config
  // -------------------------------------------------------------------------

  private getRotationConfig(appName: string): LogRotationConfig {
    const shortName = appName.includes('/') ? appName.split('/').pop()! : appName;
    const override = this.perApp.get(shortName) ?? this.perApp.get(appName);
    return {
      maxSize: override?.maxSize ?? this.defaults.maxSize,
      maxFiles: override?.maxFiles ?? this.defaults.maxFiles,
      compress: override?.compress ?? this.defaults.compress,
    };
  }

  private getMaxSizeBytes(appName: string): number {
    return this.parseSize(this.getRotationConfig(appName).maxSize);
  }

  // -------------------------------------------------------------------------
  // Write + dual-file routing
  // -------------------------------------------------------------------------

  /**
   * Take one line of an app's output.
   *
   * The line is joined into a record (`LineAssembler`): a JSON line is one
   * record and is written at once; a pino-pretty header or a plain line waits
   * for the indented lines that continue it, briefly. `persist` writes the
   * record — this is the moment of capture, and the only one.
   */
  appendToFile(appName: string, line: string): void {
    this.assembler.push(appName, line);
  }

  /**
   * Write one record: `app.log` always, `error.log` too at error or fatal.
   *
   * Which records reach `error.log` used to be decided by looking for
   * `"level":` in the raw line — so a pino-pretty `ERROR` never did: paysys's
   * `app.log` held 95 «Monero chain has not advanced» errors and `error.log`
   * none. The level is now the classifier's, whatever the line looked like.
   */
  private persist(appName: string, record: LogRecord): void {
    const line = fileLineOf(record);

    // All levels → app.log (async stream, native backpressure)
    const appPath = this.getLogFilePath(appName, 'app');
    this.writeLine(appPath, line);
    this.checkAndRotate(appName, 'app', appPath);

    // error + fatal → error.log
    if (record.level === 'error' || record.level === 'fatal') {
      const errorPath = this.getLogFilePath(appName, 'error');
      this.writeLine(errorPath, line);
      this.checkAndRotate(appName, 'error', errorPath);
    }

    this.remember(appName, record);
  }

  /** Keep a record for `getLogs`, dropping the oldest past either bound. */
  private remember(appName: string, record: LogRecord): void {
    const data = record.data ?? (record.source ? { source: record.source } : undefined);
    const entry: LogEntryDto = {
      timestamp: record.time,
      app: appName,
      level: record.level,
      // A JSON record with no message of its own shows as the line it was.
      message: record.message || record.raw || '',
      ...(data ? { data } : {}),
    };
    const chars = (record.raw ?? record.message).length;

    let ring = this.captured.get(appName);
    if (!ring) {
      ring = { entries: [], chars: 0 };
      this.captured.set(appName, ring);
    }
    ring.entries.push({ seq: ++this.captureSeq, entry, chars });
    ring.chars += chars;
    while (
      ring.entries.length > CAPTURED_RECORDS_PER_APP ||
      (ring.chars > CAPTURED_CHARS_PER_APP && ring.entries.length > 1)
    ) {
      ring.chars -= ring.entries.shift()!.chars;
    }
  }

  /**
   * Async append to a cached write stream. `write()` returns false
   * when Node's internal buffer is full — we don't pause callers
   * (logs are fire-and-forget), but the kernel-level buffer absorbs
   * bursts and the event loop is never blocked on the syscall.
   */
  private writeLine(filePath: string, line: string): void {
    let stream = this.writeStreams.get(filePath);
    if (!stream) {
      // Lazy-create the dir + stream. `flags: 'a'` = append + create.
      ensurePrivateDir(path.dirname(filePath));
      // An application log is not public. Measured on this host: `main`'s
      // `error.log` and `app.log` each held a line with a user's plaintext
      // password, written by netron's rejected-request path — and the file
      // was 0644. That path is fixed, but a log is made of whatever the
      // application decided to write, so the mode has to hold regardless.
      stream = createWriteStream(filePath, { flags: 'a', encoding: 'utf-8', mode: PRIVATE_FILE_MODE });
      sealFile(filePath);
      stream.on('error', (err) => {
         
        console.warn(`[LogManager] write stream error on ${filePath}: ${err.message}`);
        this.writeStreams.delete(filePath);
      });
      this.writeStreams.set(filePath, stream);
    }
    stream.write(line + '\n');
  }

  /**
   * Close + drop a cached stream. Called before rotating so the
   * `renameSync` doesn't race a live writer.
   */
  private closeStream(filePath: string): void {
    const stream = this.writeStreams.get(filePath);
    if (!stream) return;
    this.writeStreams.delete(filePath);
    stream.end();
  }

  // -------------------------------------------------------------------------
  // Rotation
  // -------------------------------------------------------------------------

  checkRotation(appName: string, type: LogType = 'app'): void {
    const filePath = this.getLogFilePath(appName, type);
    const maxBytes = this.getMaxSizeBytes(appName);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= maxBytes) {
        this.rotateLog(appName, type);
      }
    } catch {
      // File doesn't exist yet
    }
  }

  private checkAndRotate(appName: string, type: LogType, filePath: string): void {
    const maxBytes = this.getMaxSizeBytes(appName);
    try {
      const stat = fs.statSync(filePath);
      if (stat.size >= maxBytes) {
        this.rotateLog(appName, type);
      }
    } catch {
      // File may not exist yet
    }
  }

  /** Callbacks invoked after a log file is rotated — used to reopen pino streams */
  private readonly onRotateCallbacks: Array<(appName: string, filePath: string) => void> = [];

  onRotate(callback: (appName: string, filePath: string) => void): void {
    this.onRotateCallbacks.push(callback);
  }

  /**
   * Rotate log file: rename current → .1, .1 → .2, etc.
   * Remove files beyond maxFiles. Compress rotated files when enabled.
   */
  rotateLog(appName: string, type: LogType = 'app'): void {
    const basePath = this.getLogFilePath(appName, type);
    const config = this.getRotationConfig(appName);
    const ext = config.compress ? '.gz' : '';

    // Close any open write stream pointing at `basePath` before the
    // rename, so the stream's fd doesn't keep writing into the now-
    // .1 file. The next writeLine() lazily re-opens a fresh stream
    // on the new `basePath`.
    this.closeStream(basePath);

    // Shift ALREADY-rotated files: .{maxFiles-1} removed, .{i-1} → .{i}.
    //
    // Starts at 2, not 1. The loop used to include `i === 1`, where `from` is
    // the LIVE file and `to` is `<base>.1.gz` — so with compression enabled it
    // renamed `app.log` straight to `app.log.1.gz`, an uncompressed file
    // wearing a compressed name. The two steps that follow then did nothing:
    // the rename below found no `basePath`, and the compression looked for
    // `<base>.1`, which never existed.
    //
    // Measured on a running deployment: every rotated file on disk was plain
    // JSON named `.gz` — `file` says "JSON data", `gunzip -t` says "not in
    // gzip format" — nine of them per stream at exactly 50 MiB each, roughly
    // ten times what the same content compresses to. 2.4 GB of logs where the
    // configuration asked for about 250 MB. It only misbehaved with
    // `compress: true`, which is the default; with compression off `ext` is
    // empty, the loop's i=1 case duplicated the rename below, and the second
    // one silently failed — correct by coincidence.
    for (let i = config.maxFiles - 1; i >= 2; i--) {
      if (i === config.maxFiles - 1) {
        try { fs.unlinkSync(`${basePath}.${i}${ext}`); } catch { /* doesn't exist */ }
      }
      // A slot holds the compressed name once `compressFile` has run and the
      // bare name until then, so try both rather than lose a file to a
      // rotation that arrives mid-compression.
      try {
        fs.renameSync(`${basePath}.${i - 1}${ext}`, `${basePath}.${i}${ext}`);
      } catch {
        try {
          fs.renameSync(`${basePath}.${i - 1}`, `${basePath}.${i}`);
        } catch {
          // Neither form present — that slot is empty.
        }
      }
    }

    // The live file becomes `.1`, WITHOUT the extension: it is not compressed
    // yet. `compressFile` below turns it into `.1.gz` and unlinks it.
    try { fs.renameSync(basePath, `${basePath}.1`); } catch { /* no current file */ }

    // Create fresh empty log file
    try { fs.writeFileSync(basePath, '', { encoding: 'utf-8', mode: PRIVATE_FILE_MODE }); } catch { /* non-critical */ }

    // Notify listeners (pino stream reopening)
    for (const cb of this.onRotateCallbacks) {
      try { cb(appName, basePath); } catch { /* non-critical */ }
    }

    // Compress the .1 file asynchronously
    if (config.compress) {
      const rotatedPath = `${basePath}.1`;
      if (fs.existsSync(rotatedPath)) {
        this.compressFile(rotatedPath).catch(() => {
          // Compression failed — rotated file remains uncompressed
        });
      }
    }
  }

  /**
   * Compress a rotated log, so that the `.gz` name never names a partial file.
   *
   * `createWriteStream` creates its target the moment it opens, so writing
   * straight to `<log>.1.gz` published that name over an empty file and then
   * filled it in. For as long as the pipeline ran — which on a 50 MiB log
   * under load is not instant — anything reading rotated logs got a gzip
   * member that ends in the middle: `gunzip` says "unexpected end of file",
   * and `omnitron logs` reading a rotated file gets nothing back from it.
   *
   * Measured: the rotation test asserts the file exists and then gunzips it,
   * which is the natural thing to write and the natural thing a reader does.
   * It failed roughly one run in three on a loaded host — never in isolation,
   * which is what made it look like flakiness rather than the race it is.
   *
   * Compressing to a temporary name and renaming makes the visible state
   * binary: either `<log>.1.gz` is absent, or it is a complete member. Rename
   * within a directory is atomic, so there is no third state to observe.
   */
  async compressFile(filePath: string): Promise<void> {
    const gzPath = filePath + '.gz';
    const partialPath = `${gzPath}.partial`;
    try {
      await pipeline(
        createReadStream(filePath),
        createGzip(),
        createWriteStream(partialPath, { mode: PRIVATE_FILE_MODE }),
      );
      sealFile(partialPath);
      fs.renameSync(partialPath, gzPath);
    } catch (err) {
      // A failed compression must not leave its scratch file behind to be
      // mistaken for a rotation slot by the shift loop above.
      try { fs.unlinkSync(partialPath); } catch { /* never created */ }
      throw err;
    }
    fs.unlinkSync(filePath);
  }

  // -------------------------------------------------------------------------
  // Query helpers (records as captured)
  // -------------------------------------------------------------------------

  /**
   * The last `lines` records captured for an app — or across all apps — in
   * the order they arrived.
   *
   * Arrival order, not a sort by time: the records of an app's processes
   * interleave in the pipe (a JSON record stamped .528 is followed by a
   * pino-pretty one stamped .516 in `main`'s file), and the order they were
   * captured in is the one order every reader can agree on.
   */
  getLogs(appName?: string, lines = 100): LogEntryDto[] {
    const take = <T>(items: T[]): T[] => (lines > 0 ? items.slice(-lines) : []);

    if (appName !== undefined) {
      const key = this.capturedKey(appName);
      const ring = key !== undefined ? this.captured.get(key) : undefined;
      return ring ? take(ring.entries).map((e) => e.entry) : [];
    }

    const all = [...this.captured.values()].flatMap((ring) => ring.entries);
    all.sort((a, b) => a.seq - b.seq);
    return take(all).map((e) => e.entry);
  }

  /**
   * Which captured app a name means.
   *
   * The orchestrator's answer first: bare `main` is `daos/dev/main` while that
   * handle exists, and an ambiguous bare name is refused there rather than
   * guessed here. A handle that is gone (a stopped stack) still leaves what was
   * captured under its name, reachable by that name — or by its last segment,
   * when exactly one captured app ends with it.
   */
  private capturedKey(name: string): string | undefined {
    const resolved = this.orchestrator.resolveAppName?.(name);
    if (resolved !== undefined) return resolved;
    if (this.captured.has(name)) return name;
    if (name.includes('/')) return undefined;
    const matches = [...this.captured.keys()].filter((key) => key.slice(key.lastIndexOf('/') + 1) === name);
    return matches.length === 1 ? matches[0] : undefined;
  }

  // -------------------------------------------------------------------------
  // File listing
  // -------------------------------------------------------------------------

  getRotatedFiles(appName: string, type: LogType = 'app'): string[] {
    const basePath = this.getLogFilePath(appName, type);
    const config = this.getRotationConfig(appName);
    const files: string[] = [];

    if (fs.existsSync(basePath)) files.push(basePath);

    for (let i = 1; i < config.maxFiles; i++) {
      const rotatedGz = `${basePath}.${i}.gz`;
      const rotated = `${basePath}.${i}`;
      if (fs.existsSync(rotatedGz)) {
        files.push(rotatedGz);
      } else if (fs.existsSync(rotated)) {
        files.push(rotated);
      }
    }

    return files;
  }

  listLogApps(): string[] {
    const apps: string[] = [];

    // Check flat logs dir (daemon + standalone apps)
    const logsDir = path.join(this.baseDir, 'logs');
    try {
      for (const entry of fs.readdirSync(logsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          // Standalone app directories
          const appLog = path.join(logsDir, entry.name, 'app.log');
          if (fs.existsSync(appLog)) apps.push(entry.name);
        } else if (entry.name === 'omnitron.log') {
          apps.push('omnitron');
        }
      }
    } catch { /* dir may not exist */ }

    // Check project-scoped dirs
    const projectsDir = path.join(this.baseDir, 'projects');
    try {
      for (const project of fs.readdirSync(projectsDir)) {
        const projectPath = path.join(projectsDir, project);
        if (!fs.statSync(projectPath).isDirectory()) continue;
        for (const stack of fs.readdirSync(projectPath)) {
          const logsPath = path.join(projectPath, stack, 'logs');
          if (!fs.existsSync(logsPath)) continue;
          for (const app of fs.readdirSync(logsPath)) {
            const appLog = path.join(logsPath, app, 'app.log');
            if (fs.existsSync(appLog)) apps.push(`${project}/${stack}/${app}`);
          }
        }
      }
    } catch { /* dir may not exist */ }

    return apps;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  parseSize(size: string): number {
    const match = size.match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/i);
    if (!match) return 10 * 1024 * 1024;
    const value = parseFloat(match[1]!);
    const unit = match[2]!.toLowerCase();
    const multipliers: Record<string, number> = {
      b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024, tb: 1024 * 1024 * 1024 * 1024,
    };
    return Math.floor(value * (multipliers[unit] ?? 1024 * 1024));
  }
}
