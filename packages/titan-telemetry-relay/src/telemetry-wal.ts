/**
 * Telemetry WAL (Write-Ahead Log) — Durable append-only storage
 *
 * Provides persistence for telemetry entries when the aggregator is offline.
 * Entries are appended to segment files and replayed on reconnect.
 *
 * Format: one JSON entry per line (NDJSON), segment files named by sequence.
 *
 * Segments:
 *   ~/.omnitron/wal/000001.wal  (oldest)
 *   ~/.omnitron/wal/000002.wal  (current — being written)
 *
 * When a segment exceeds maxSizeBytes, a new one is created.
 * Old segments beyond maxSegments are deleted.
 *
 * On reconnect, all segments from the last ack'd offset are replayed.
 *
 * @module titan/modules/telemetry-relay
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import type { TelemetryEntry, TelemetryWalConfig } from './types.js';

const DEFAULT_DIR = path.join(process.env['HOME'] ?? '/tmp', '.omnitron', 'wal');
const DEFAULT_MAX_SIZE = 50 * 1024 * 1024; // 50MB
const DEFAULT_MAX_SEGMENTS = 10;

export class TelemetryWal {
  private readonly dir: string;
  private readonly maxSizeBytes: number;
  private readonly maxSegments: number;

  private currentSegment = 0;
  private currentSize = 0;
  private fd: number | null = null;

  /** Total entries written across all segments */
  totalWritten = 0;

  /**
   * T#69: serialise async writes via a promise chain. `append()` is
   * synchronous from the caller's perspective (returns void after
   * queuing the data); the actual `fs.write` happens off the event
   * loop. Without serialisation, two near-simultaneous `append()`
   * calls could race and interleave bytes from different batches in
   * the segment file. The chain guarantees writes complete in the
   * order they were queued.
   */
  private writeChain: Promise<void> = Promise.resolve();

  constructor(config?: TelemetryWalConfig) {
    this.dir = config?.directory ?? DEFAULT_DIR;
    this.maxSizeBytes = config?.maxSizeBytes ?? DEFAULT_MAX_SIZE;
    this.maxSegments = config?.maxSegments ?? DEFAULT_MAX_SEGMENTS;

    fs.mkdirSync(this.dir, { recursive: true });
    this.initCurrentSegment();
  }

  /**
   * Append entries to the WAL.
   *
   * T#69: the historical implementation used `fs.writeSync` on the
   * hot path. Telemetry traffic at a moderate rate produced
   * multi-ms event-loop pauses per batch — under 1 KB/batch on a
   * slow disk would push the daemon past its supervisor liveness
   * deadline. Now we queue the write to the OS-level fs.write and
   * return immediately; in-order delivery is preserved by a
   * promise chain on the WAL instance.
   *
   * The return type stays `void` so existing call sites don't need
   * updating; callers wanting to await durability should use
   * {@link flush}.
   */
  append(entries: TelemetryEntry[]): void {
    if (entries.length === 0) return;
    this.ensureFd();

    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const buf = Buffer.from(lines, 'utf-8');

    // Optimistic accounting — the bytes are conceptually "ours" the
    // moment we queue them, and a rotate decision based on the
    // pending size matches the historical sync behaviour. If the
    // async write later fails, the next ensureFd() will reopen.
    this.currentSize += buf.byteLength;
    this.totalWritten += entries.length;

    const fdAtQueue = this.fd!;
    this.writeChain = this.writeChain.then(() =>
      new Promise<void>((resolve) => {
        fs.write(fdAtQueue, buf, (err) => {
          if (err) {
            // Best-effort: log to stderr so we don't lose the
            // signal entirely. Continuing the chain keeps later
            // appends from blocking on a single failure.
            // eslint-disable-next-line no-console
            console.error('[TelemetryWal] write failed:', err.message);
          }
          resolve();
        });
      }),
    );

    // T#70: rotate synchronously but DEFER the close of the OLD fd.
    //
    // The pre-T#70 rotate() called `closeFd()` (sync) immediately after
    // queuing the async write — `closeFd()` invalidated the FD that
    // the still-pending `fs.write` was about to use, causing the
    // in-flight batch to fail with EBADF. The bytes were lost despite
    // the optimistic `currentSize` / `totalWritten` increments.
    //
    // The correct pattern: at sync time, open the NEW segment's FD so
    // the next `append()` writes there, and chain the close of the
    // OLD FD behind the pending writeChain. That way every queued
    // write completes against the FD that was current at queue time,
    // and only when all those writes have drained do we release it.
    if (this.currentSize >= this.maxSizeBytes) {
      this.rotateAdvance();
    }
  }

  /**
   * T#69: await all pending async appends. Useful for shutdown
   * paths that want to know data is at least in the OS kernel
   * buffer before exiting. Note that fsync-to-disk is a separate
   * concern (the historical `writeSync` didn't fsync either).
   */
  async flush(): Promise<void> {
    await this.writeChain;
  }

  /**
   * Read all entries from all segments (for replay on reconnect).
   * Returns entries in chronological order.
   *
   * T#69: this used to be `fs.readFileSync` on every segment,
   * loading the entire file into a single JS string before
   * splitting on `\n`. With segments up to 50 MB each and up to
   * 10 segments retained, the WAL replay could allocate 500 MB
   * peak in a single tick on daemon restart — instant heap
   * pressure that occasionally took the daemon OOM right after
   * boot, BEFORE it could supervise anything. Switched to
   * `createReadStream` + `readline`, which streams the segment
   * line-by-line with a fixed-size internal buffer regardless of
   * file size.
   *
   * The return type is now `Promise<TelemetryEntry[]>`; the two
   * call sites (`start()` and the retry timer in
   * telemetry-relay.service.ts) were already async, so this
   * change is contained.
   */
  async readAll(): Promise<TelemetryEntry[]> {
    const entries: TelemetryEntry[] = [];
    const segments = this.listSegments();
    for (const seg of segments) {
      const filePath = path.join(this.dir, seg);
      try {
        const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (!line.trim()) continue;
          try {
            entries.push(JSON.parse(line));
          } catch {
            // Corrupted line — skip
          }
        }
      } catch {
        // Corrupted segment — skip
      }
    }
    return entries;
  }

  /**
   * Count total entries across all segments (without loading them).
   * Streams each segment line-by-line — same bounded-memory
   * guarantee as `readAll` (T#69).
   */
  async entryCount(): Promise<number> {
    let count = 0;
    for (const seg of this.listSegments()) {
      try {
        const stream = fs.createReadStream(path.join(this.dir, seg), { encoding: 'utf-8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        for await (const line of rl) {
          if (line.trim()) count++;
        }
      } catch {
        // Skip
      }
    }
    return count;
  }

  /**
   * Truncate: remove all segments up to and including the given segment number.
   * Called after successful replay to free disk space.
   */
  truncateBefore(segmentNumber: number): void {
    for (const seg of this.listSegments()) {
      const num = parseInt(seg.replace('.wal', ''), 10);
      if (num <= segmentNumber) {
        try {
          fs.unlinkSync(path.join(this.dir, seg));
        } catch {
          // Already deleted
        }
      }
    }
  }

  /**
   * Clear all WAL data.
   *
   * T#70: chained into `writeChain` so any pending appends complete
   * before we delete the segments they were writing to. Pre-T#70 a
   * concurrent `append()` + `clear()` could race: clear() would
   * unlink the file while the queued fs.write was still flying,
   * leaving us with bytes written to an unlinked inode (lost on
   * fd-close) AND a freshly-opened "current" segment by the next
   * append() that thinks it's empty. The chain serialises everything.
   */
  clear(): void {
    this.writeChain = this.writeChain.then(() => this.doClear());
  }

  private doClear(): void {
    this.closeFd();
    for (const seg of this.listSegments()) {
      try {
        fs.unlinkSync(path.join(this.dir, seg));
      } catch {
        // Already deleted
      }
    }
    this.currentSegment = 0;
    this.currentSize = 0;
    this.totalWritten = 0;
  }

  /**
   * Get WAL stats.
   */
  stats(): { segments: number; totalSize: number; totalWritten: number; currentSegment: number } {
    let totalSize = 0;
    const segments = this.listSegments();
    for (const seg of segments) {
      try {
        totalSize += fs.statSync(path.join(this.dir, seg)).size;
      } catch {
        // Skip
      }
    }
    return {
      segments: segments.length,
      totalSize,
      totalWritten: this.totalWritten,
      currentSegment: this.currentSegment,
    };
  }

  /**
   * Close file descriptor and clean up.
   *
   * T#70: returns a Promise so callers can `await` durability of all
   * queued writes BEFORE the FD closes. The shutdown path in
   * `TelemetryRelayService.stop()` is already async, so this is a
   * compatible widening: callers that previously called `.dispose()`
   * without await continue to work (the close still happens, just
   * eventually). Pre-T#70 the sync dispose closed the FD with
   * `writeChain` still pending, causing buffered telemetry to be
   * silently dropped on graceful shutdown.
   */
  async dispose(): Promise<void> {
    try {
      await this.writeChain;
    } catch {
      // Errors inside the chain are already logged by `append()`.
    }
    this.closeFd();
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private initCurrentSegment(): void {
    const segments = this.listSegments();
    if (segments.length > 0) {
      const lastSeg = segments[segments.length - 1]!;
      this.currentSegment = parseInt(lastSeg.replace('.wal', ''), 10);
      try {
        this.currentSize = fs.statSync(path.join(this.dir, lastSeg)).size;
      } catch {
        this.currentSize = 0;
      }
    } else {
      this.currentSegment = 1;
      this.currentSize = 0;
    }
  }

  private segmentPath(num: number): string {
    return path.join(this.dir, `${String(num).padStart(6, '0')}.wal`);
  }

  private ensureFd(): void {
    if (this.fd !== null) return;
    this.fd = fs.openSync(this.segmentPath(this.currentSegment), 'a');
  }

  private closeFd(): void {
    if (this.fd !== null) {
      try {
        fs.closeSync(this.fd);
      } catch {
        // Already closed
      }
      this.fd = null;
    }
  }

  /**
   * Synchronous rotation: open a NEW segment immediately, queue the
   * close of the OLD fd behind any pending writes. (T#70)
   *
   * The legacy `rotate()` was sync-only and closed the FD straight
   * away. Combined with async writes, this dropped data — see the
   * comment in `append()`. We keep `rotate()` around for back-compat
   * with `doClear()` etc., but new flow uses `rotateAdvance()` which
   * preserves data integrity under concurrent appends.
   */
  private rotateAdvance(): void {
    const oldFd = this.fd;
    this.fd = null;
    this.currentSegment++;
    this.currentSize = 0;

    // Evict old segments beyond maxSegments BEFORE we open the new one,
    // so listSegments() doesn't count the new one we're about to create.
    const segments = this.listSegments();
    while (segments.length >= this.maxSegments) {
      const oldest = segments.shift();
      if (oldest) {
        try {
          fs.unlinkSync(path.join(this.dir, oldest));
        } catch {
          // Already deleted
        }
      }
    }

    // Open the new segment NOW so the next append uses it.
    this.ensureFd();

    // Defer the old fd close behind pending writes.
    if (oldFd !== null) {
      this.writeChain = this.writeChain.then(() => {
        try {
          fs.closeSync(oldFd);
        } catch {
          // Already closed
        }
      });
    }
  }

  /**
   * Legacy sync rotation — used only by paths that have ALREADY
   * drained the write chain (e.g. `doClear()` which runs inside
   * the chain).
   */
  private rotate(): void {
    this.closeFd();
    this.currentSegment++;
    this.currentSize = 0;

    const segments = this.listSegments();
    while (segments.length >= this.maxSegments) {
      const oldest = segments.shift();
      if (oldest) {
        try {
          fs.unlinkSync(path.join(this.dir, oldest));
        } catch {
          // Already deleted
        }
      }
    }
  }

  private listSegments(): string[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((f) => f.endsWith('.wal'))
        .sort();
    } catch {
      return [];
    }
  }
}
