import { generateUuidV7 } from '@omnitron-dev/titan/utils';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';

/** Identity is assigned at the pipe, before readiness, buffering or delivery. */
export interface ProcessOutputContext {
  id: string;
  processId: string;
  stream: 'stdout' | 'stderr';
  sequence: number;
  capturedAt: string;
  /** A physical line larger than 256 KiB is transported in lossless fragments. */
  fragment?: boolean;
  fragmentOf?: string;
  fragmentIndex?: number;
  /** Older producers cannot provide capture-time evidence. */
  timeBasis?: 'observed';
}

export type ProcessOutputHandler = (line: string, stream: 'stdout' | 'stderr', context: ProcessOutputContext) => void;

/** UTF-8 framing with retry/backpressure. A rejected frame keeps its identity. */
export class OutputCapture {
  private sequence = 0;
  private readonly drains: Array<() => void> = [];
  readonly failures = new Map<string, string>();

  constructor(readonly processId: string, private readonly deliver: ProcessOutputHandler) {}

  attach(input: Readable | null | undefined, stream: 'stdout' | 'stderr'): void {
    if (!input) return;
    const decoder = new StringDecoder('utf8');
    let text = '';
    let undecodedBytes = 0;
    let at: string | null = null;
    let ended = false;
    let lineId: string | null = null;
    let fragmentIndex = 0;
    const times: Array<{ offset: number; at: string }> = [];
    let pending: { line: string; context: ProcessOutputContext; consumed: number } | null = null;
    let retry: NodeJS.Timeout | null = null;
    const drain = () => {
      if (retry) { clearTimeout(retry); retry = null; }
      while (text.length || pending) {
        if (!pending) {
          const newline = text.indexOf('\n');
          let length = newline < 0 ? text.length : newline;
          const fragmented = Buffer.byteLength(text.slice(0, length)) > 256 * 1024;
          if (newline < 0 && !ended && !fragmented) break;
          if (fragmented) {
            length = Math.min(length, 256 * 1024);
            while (Buffer.byteLength(text.slice(0, length)) > 256 * 1024) {
              length = Math.floor(length * 256 * 1024 / Buffer.byteLength(text.slice(0, length)));
            }
          }
          // Do not split a Unicode surrogate pair at the fragment boundary.
          if (fragmented && /[\uD800-\uDBFF]/.test(text[length - 1]!)) length--;
          const consumed = length + (!fragmented && newline >= 0 ? 1 : 0);
          const line = text.slice(0, length);
          const id = generateUuidV7();
          lineId ??= id;
          pending = { line: !fragmented && line.endsWith('\r') ? line.slice(0, -1) : line,
            consumed, context: { id, processId: this.processId, stream,
              sequence: ++this.sequence, capturedAt: at ?? new Date().toISOString(),
              ...(fragmented || fragmentIndex ? { fragment: fragmented, fragmentOf: lineId, fragmentIndex } : {}) } };
        }
        try { this.deliver(pending.line, stream, pending.context); }
        catch (error) {
          this.failures.set(stream, error instanceof Error ? error.message : String(error));
          input.pause();
          retry = setTimeout(drain, 1000);
          retry.unref();
          return;
        }
        const consumed = pending.consumed;
        if (pending.context.fragment) fragmentIndex++;
        else { fragmentIndex = 0; lineId = null; }
        while (times.length && times[0]!.offset < consumed) at = times.shift()!.at;
        for (const time of times) time.offset -= consumed;
        if (times[0]?.offset === 0) at = times.shift()!.at;
        text = text.slice(consumed);
        pending = null;
        this.failures.delete(stream);
      }
      if (!text.length && !undecodedBytes) at = null;
      if (!ended) input.resume();
    };
    input.on('data', (chunk: Buffer | string) => {
      const receivedAt = new Date().toISOString();
      const hadUndecoded = undecodedBytes > 0;
      const decoded = typeof chunk === 'string' ? chunk : decoder.write(chunk);
      if (typeof chunk !== 'string') undecodedBytes = Math.max(0, undecodedBytes + chunk.length - Buffer.byteLength(decoded));
      if (text.length || (hadUndecoded && decoded.length)) times.push({ offset: text.length + (hadUndecoded ? (decoded.codePointAt(0)! > 0xffff ? 2 : 1) : 0), at: receivedAt });
      at ??= receivedAt;
      text += decoded;
      drain();
    });
    const end = () => {
      if (ended) return;
      ended = true;
      text += decoder.end();
      drain();
    };
    input.once('end', end);
    input.once('close', end);
    // Stream errors do not discard bytes already captured.
    input.once('error', (error: Error) => { this.failures.set(stream, error.message); end(); });
    this.drains.push(drain);
  }

  retry(): void { for (const drain of this.drains) drain(); }
}
