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
import path from 'node:path';
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

  constructor(config?: TelemetryWalConfig) {
    this.dir = config?.directory ?? DEFAULT_DIR;
    this.maxSizeBytes = config?.maxSizeBytes ?? DEFAULT_MAX_SIZE;
    this.maxSegments = config?.maxSegments ?? DEFAULT_MAX_SEGMENTS;

    fs.mkdirSync(this.dir, { recursive: true });
    this.initCurrentSegment();
  }

  /**
   * Append entries to the WAL.
   */
  append(entries: TelemetryEntry[]): void {
    if (entries.length === 0) return;
    this.ensureFd();

    const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    const buf = Buffer.from(lines, 'utf-8');

    fs.writeSync(this.fd!, buf);
    this.currentSize += buf.byteLength;
    this.totalWritten += entries.length;

    // Rotate if segment exceeds max size
    if (this.currentSize >= this.maxSizeBytes) {
      this.rotate();
    }
  }

  /**
   * Read all entries from all segments (for replay on reconnect).
   * Returns entries in chronological order.
   */
  readAll(): TelemetryEntry[] {
    const entries: TelemetryEntry[] = [];
    const segments = this.listSegments();

    for (const seg of segments) {
      const filePath = path.join(this.dir, seg);
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        for (const line of content.split('\n')) {
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
   */
  entryCount(): number {
    let count = 0;
    for (const seg of this.listSegments()) {
      try {
        const content = fs.readFileSync(path.join(this.dir, seg), 'utf-8');
        count += content.split('\n').filter((l) => l.trim()).length;
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
   */
  clear(): void {
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
   */
  dispose(): void {
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

  private rotate(): void {
    this.closeFd();
    this.currentSegment++;
    this.currentSize = 0;

    // Evict old segments beyond maxSegments
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
