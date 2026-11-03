import { TitanError, ErrorCode } from '../../../errors/index.js';

export function oversizedRequest(maxBytes: number): TitanError {
  return new TitanError({
    code: ErrorCode.PAYLOAD_TOO_LARGE,
    message: `Request body too large (max: ${maxBytes} bytes)`,
  });
}

type BodyReader = ReadableStreamDefaultReader<Uint8Array>;

/** One per listener, shared by every Fetch upload. */
export class FetchBodyBoundary {
  private draining = 0;

  constructor(private readonly maxBytes: number) {}

  /** Bun can reuse an HTTP/1 socket before it has discarded a refused chunked upload. */
  private async discardTail(reader: BodyReader, reason: Error, recoverKeepAlive: boolean): Promise<void> {
    const cancel = () => { void reader.cancel(reason).catch(() => {}); };
    if (!recoverKeepAlive || this.draining >= 8) { cancel(); return; }

    this.draining++;
    const deadline = setTimeout(cancel, 100);
    try {
      // Give a short, already-arriving tail a chance to finish. Never buffer
      // it, wait on a slow producer indefinitely or drain an unlimited upload.
      let remaining = 64 * 1024;
      for (let chunks = 0; chunks < 16 && remaining > 0; chunks++) {
        const { done, value } = await reader.read();
        if (done) return;
        remaining -= value.byteLength;
      }
      cancel();
    } catch { /* The client already disconnected. */ }
    finally { clearTimeout(deadline); this.draining--; }
  }

  bound(request: Request, recoverKeepAlive = false): Request {
    const source = request.body;
    if (Number(request.headers.get('content-length')) > this.maxBytes) {
      const error = oversizedRequest(this.maxBytes);
      void source?.cancel(error).catch(() => {});
      throw error;
    }
    if (!source) return request;

    let bytes = 0;
    let reader: BodyReader | undefined;
    const cancel = (reason: unknown) => reader ? reader.cancel(reason) : source.cancel(reason);
    const bounded = new ReadableStream<Uint8Array>({
      pull: async controller => {
        reader ??= source.getReader();
        const signal = request.signal;
        const abort = () => { void cancel(signal.reason).catch(() => {}); };
        signal.addEventListener('abort', abort, { once: true });
        try {
          if (signal.aborted) { abort(); throw signal.reason; }
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) { controller.close(); return; }
          bytes += value.byteLength;
          if (bytes > this.maxBytes) {
            const error = oversizedRequest(this.maxBytes);
            await this.discardTail(reader, error, recoverKeepAlive);
            throw error;
          }
          controller.enqueue(value);
        } finally {
          signal.removeEventListener('abort', abort);
        }
      },
      cancel,
    }, { highWaterMark: 0 });
    return new Request(request, { body: bounded, duplex: 'half' } as RequestInit);
  }
}
