import fs from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import type { TelemetryEntry, TelemetryWalConfig } from './types.js';

/** Single-writer, bounded, newline-delimited journal. All file mutations share one queue. */
export class TelemetryWal {
  private readonly dir: string;
  private readonly maxSizeBytes: number;
  private readonly maxSegments: number;
  private currentSegment = 1;
  private currentSize = 0;
  private handle: FileHandle | null = null;
  private dirty = false;
  private directoryChanged = false;
  private evictedSegments = 0;
  private evictedBytes = 0;
  private queue: Promise<void> = Promise.resolve();
  private writeError: Error | undefined;
  private lastListError: string | null = null;
  totalWritten = 0;

  constructor(config?: TelemetryWalConfig) {
    this.dir = config?.directory ?? path.join(os.homedir(), '.omnitron', 'wal');
    this.maxSizeBytes = config?.maxSizeBytes ?? 50 * 1024 * 1024;
    this.maxSegments = config?.maxSegments ?? 10;
    if (![this.maxSizeBytes, this.maxSegments].every(n => Number.isSafeInteger(n) && n > 0)) {
      throw new Error('Telemetry WAL limits must be positive integers');
    }
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const last = this.segments().at(-1);
    if (last) {
      this.currentSegment = Number.parseInt(last, 10);
      this.currentSize = fs.statSync(path.join(this.dir, last)).size;
    }
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch(error => { this.writeError ??= error instanceof Error ? error : new Error(String(error)); });
  }

  append(entries: TelemetryEntry[]): void {
    if (!entries.length) return;
    const data = Buffer.from(entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const count = entries.length;
    this.enqueue(async () => {
      if (this.currentSize && this.currentSize + data.length > this.maxSizeBytes) {
        await this.closeSegment();
        this.currentSegment++;
        this.currentSize = 0;
      }
      if (!this.handle) {
        this.handle = await open(path.join(this.dir, `${String(this.currentSegment).padStart(6, '0')}.wal`), 'a', 0o600);
        this.directoryChanged = true;
      }
      try {
        await this.handle.writeFile(data);
      } catch (error) {
        // A partial NDJSON tail would make the next complete record unreadable.
        await this.handle.truncate(this.currentSize);
        throw error;
      }
      this.dirty = true;
      this.currentSize += data.length;
      this.totalWritten += count;
      // Rotation intentionally bounds disk use. Only remove older segments after the new write.
      if (this.currentSize === data.length) {
        const files = this.segments();
        for (const name of files.slice(0, Math.max(0, files.length - this.maxSegments))) {
          const file = path.join(this.dir, name), size = fs.statSync(file).size;
          fs.unlinkSync(file);
          this.evictedSegments++;
          this.evictedBytes += size;
          this.directoryChanged = true;
        }
      }
    });
  }

  private async syncSegment(): Promise<void> {
    if (this.handle && this.dirty) {
      await this.handle.datasync();
      this.dirty = false;
    }
  }

  private async closeSegment(): Promise<void> {
    await this.syncSegment();
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
  }

  async flush(): Promise<void> {
    this.enqueue(async () => {
      await this.syncSegment();
      if (this.directoryChanged && process.platform !== 'win32') {
        const directory = await open(this.dir, 'r');
        try { await directory.sync(); } finally { await directory.close(); }
      }
      this.directoryChanged = false;
    });
    await this.queue;
    const failure = this.writeError;
    this.writeError = undefined;
    if (failure) throw failure;
  }

  private segments(): string[] {
    try {
      const names = fs.readdirSync(this.dir).filter(name => name.endsWith('.wal'));
      if (names.some(name => !/^\d+\.wal$/.test(name) || !Number.isSafeInteger(Number.parseInt(name, 10)))) throw new Error('Invalid telemetry segment filename');
      this.lastListError = null;
      return names.sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
    } catch (error) {
      this.lastListError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async *readEntries(): AsyncGenerator<TelemetryEntry> {
    await this.flush();
    for (const name of this.segments()) {
      const stream = fs.createReadStream(path.join(this.dir, name), { encoding: 'utf8' });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      try {
        let row = 0;
        for await (const line of lines) {
          row++;
          if (!line.trim()) continue;
          try { yield JSON.parse(line) as TelemetryEntry; }
          catch (error) { throw new Error(`Invalid telemetry record in ${name} at line ${row}`, { cause: error }); }
        }
      } finally { lines.close(); stream.destroy(); }
    }
  }

  /** Stream a bounded snapshot to a sink. The relay serializes cleanup and append around this read. */
  async *readBatches(maxEntries: number): AsyncGenerator<TelemetryEntry[]> {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new Error('Invalid telemetry replay batch size');
    let batch: TelemetryEntry[] = [];
    for await (const entry of this.readEntries()) {
      batch.push(entry);
      if (batch.length === maxEntries) { yield batch; batch = []; }
    }
    if (batch.length) yield batch;
  }

  async readAll(): Promise<TelemetryEntry[]> {
    const entries: TelemetryEntry[] = [];
    for await (const entry of this.readEntries()) entries.push(entry);
    return entries;
  }

  async entryCount(): Promise<number> {
    let count = 0;
    for await (const _entry of this.readEntries()) count++;
    return count;
  }

  truncateBefore(segmentNumber: number): void {
    this.enqueue(async () => {
      await this.closeSegment();
      for (const name of this.segments()) {
        if (Number.parseInt(name, 10) <= segmentNumber) {
          fs.unlinkSync(path.join(this.dir, name));
          this.directoryChanged = true;
        }
      }
      if (this.currentSegment <= segmentNumber) {
        this.currentSegment = 1;
        this.currentSize = 0;
        this.totalWritten = 0;
      }
    });
  }

  clear(): void { this.truncateBefore(Number.POSITIVE_INFINITY); }

  stats(): { segments: number; totalSize: number; totalWritten: number; currentSegment: number; evictedSegments: number; evictedBytes: number; listError?: string } {
    let segments = 0, totalSize = 0;
    try {
      for (const name of this.segments()) {
        segments++;
        totalSize += fs.statSync(path.join(this.dir, name)).size;
      }
    } catch (error) { this.lastListError = error instanceof Error ? error.message : String(error); }
    return { segments, totalSize, totalWritten: this.totalWritten, currentSegment: this.currentSegment,
      evictedSegments: this.evictedSegments, evictedBytes: this.evictedBytes,
      ...(this.lastListError && { listError: this.lastListError }) };
  }

  async dispose(): Promise<void> {
    this.enqueue(() => this.closeSegment());
    await this.flush();
  }
}
