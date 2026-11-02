import { Writable } from 'node:stream';

export interface LogSinkHealth {
  name: string;
  pendingBytes: number;
  failedWrites: number;
  unconfirmedBytes: number;
  droppedBytes: number;
  error: string | null;
  errorCode?: string | null;
  nextAttemptAt: number | null;
}

type Destination = NodeJS.WritableStream & { flush?: (callback: (error?: Error) => void) => void; flushSync?: () => void };
const MAX_PENDING_BYTES = 1024 * 1024;
const DELIVERY_TIMEOUT_MS = 30_000;

/** Per-sink fault boundary; no failed or partially written record is replayed. */
export class LogSinkGuard extends Writable {
  private failedWrites = 0;
  private unconfirmedBytes = 0;
  private droppedBytes = 0;
  private failure: Error | null = null;
  private retryAt = 0;
  private consecutiveFailures = 0;
  private active: ((error?: Error | null) => void) | null = null;
  private uncheckedBytes = 0;
  private blockedWrite = false;
  private flushDone: ((error?: Error) => void) | null = null;

  constructor(readonly sinkName: string, private readonly destination: Destination, private readonly deferred: boolean) {
    super({ autoDestroy: false });
    destination.on?.('error', error => {
      if (this.active) this.active(error as Error);
      else if (error !== this.failure) this.fail(error, this.uncheckedBytes);
      this.uncheckedBytes = 0;
      this.flushDone?.(error as Error);
    });
    // SonicBoom reports successful native writes; its error event does not say
    // which earlier bytes reached the descriptor, so keep uncertainty explicit.
    destination.on?.('drain', () => { this.uncheckedBytes = 0; });
    destination.on?.('drop', (chunk: string | Buffer) => { this.droppedBytes += Buffer.byteLength(chunk); });
  }

  health(): LogSinkHealth {
    return { name: this.sinkName, pendingBytes: this.writableLength, failedWrites: this.failedWrites,
      unconfirmedBytes: this.unconfirmedBytes, droppedBytes: this.droppedBytes,
      error: this.failure?.message.slice(0, 512) ?? null,
      errorCode: typeof (this.failure as NodeJS.ErrnoException | null)?.code === 'string'
        && /^[A-Z0-9_]{1,64}$/.test((this.failure as NodeJS.ErrnoException).code!) ? (this.failure as NodeJS.ErrnoException).code! : null,
      nextAttemptAt: this.failure ? this.retryAt : null };
  }

  override write(chunk: any, encoding?: any, callback?: any): boolean {
    const size = Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : undefined);
    if (size && this.writableLength + size > MAX_PENDING_BYTES) {
      this.droppedBytes += size;
      const done = typeof encoding === 'function' ? encoding : callback;
      done?.();
      return false;
    }
    return super.write(chunk, encoding, callback);
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (!chunk.length) { callback(); return; }
    if (this.blockedWrite || (this.failure && Date.now() < this.retryAt)) { this.droppedBytes += chunk.length; callback(); return; }
    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (error?: Error | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      this.active = null;
      if (error) this.fail(error, chunk.length);
      else { this.failure = null; this.consecutiveFailures = 0; this.retryAt = 0; }
      // Do not put the wrapper into Writable's terminal errored state. The
      // underlying sink may recover, and other destinations must keep flowing.
      callback();
    };
    const deliver = () => {
      const settled = (error?: Error | null) => { this.blockedWrite = false; finish(error); };
      this.active = settled;
      timer = setTimeout(() => { this.blockedWrite = true; finish(new Error('Log destination did not acknowledge its write within 30000ms')); }, DELIVERY_TIMEOUT_MS);
      timer.unref();
      try {
        if (this.destination instanceof Writable) this.destination.write(chunk, settled);
        else {
          this.uncheckedBytes += chunk.length;
          this.destination.write(chunk);
          finish();
        }
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    };
    if (this.deferred) setImmediate(deliver); else deliver();
  }

  private fail(error: unknown, bytes: number): void {
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.failedWrites++;
    this.unconfirmedBytes += bytes;
    this.retryAt = Date.now() + Math.min(30_000, 1000 * 2 ** Math.min(this.consecutiveFailures++, 5));
  }

  /** Flush every admitted record, then report any unresolved delivery gap. */
  async confirm(): Promise<void> {
    await new Promise<void>(resolve => super.write(Buffer.alloc(0), () => resolve()));
    if (this.destination.flush && !this.failure) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => done(new Error('Log destination flush timed out after 30000ms')), DELIVERY_TIMEOUT_MS);
        timer.unref();
        const done = (error?: Error) => {
          if (settled) return;
          settled = true; clearTimeout(timer); this.flushDone = null;
          if (error && error !== this.failure) this.fail(error, this.uncheckedBytes);
          else this.uncheckedBytes = 0;
          resolve();
        };
        this.flushDone = done;
        try { this.destination.flush!(done); } catch (error) { done(error instanceof Error ? error : new Error(String(error))); }
      });
    }
    if (this.failure || this.unconfirmedBytes || this.droppedBytes) {
      throw new Error(`Log sink ${this.sinkName} delivery is incomplete: ${this.unconfirmedBytes} unconfirmed bytes, ${this.droppedBytes} dropped bytes${this.failure ? `; ${this.failure.message.slice(0, 512)}` : ''}`);
    }
  }

  flushSync(): void {
    try { this.destination.flushSync?.(); }
    catch (error) { this.fail(error, this.uncheckedBytes); }
  }
}
