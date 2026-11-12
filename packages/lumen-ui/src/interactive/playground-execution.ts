import { PLAYGROUND_LIMITS } from '@omnitron-dev/lumen-ast/execution/limits';

export interface PlaygroundWorkerRequest { code: string; timeoutMs: number }
export type PlaygroundWorkerResponse = { ok: true; result: unknown } | { ok: false; error: string };

/** One interpreter worker per run, with a host-owned deadline and no host evaluation path. */
export function executeSandboxedCode(code: string, timeoutMs: number = PLAYGROUND_LIMITS.timeoutMs, signal?: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (typeof code !== 'string' || new TextEncoder().encode(code).length > PLAYGROUND_LIMITS.codeBytes) {
      reject(new Error(`Playground code exceeds ${PLAYGROUND_LIMITS.codeBytes} bytes`));
      return;
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PLAYGROUND_LIMITS.maxTimeoutMs) {
      reject(new Error(`Execution timeout must be between 1 and ${PLAYGROUND_LIMITS.maxTimeoutMs} ms`));
      return;
    }
    if (typeof Worker === 'undefined') {
      reject(new Error('Isolated Web Worker runtime is unavailable'));
      return;
    }
    if (signal?.aborted) { reject(new DOMException('Execution cancelled', 'AbortError')); return; }

    let worker: Worker | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (response: PlaygroundWorkerResponse) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker?.terminate();
      if (response.ok) resolve(response.result);
      else reject(new Error(response.error));
    };
    const abort = () => finish({ ok: false, error: 'Execution cancelled' });
    try {
      // tsup emits this worker beside its shared chunks. Vite then resolves and
      // bundles this standard module-worker URL in the final website build.
      worker = new Worker(new URL('./playground-worker.js', import.meta.url), { type: 'module', name: 'lumen-playground' });
      timer = setTimeout(() => finish({ ok: false, error: `Execution timed out after ${timeoutMs}ms` }), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      worker.onmessage = ({ data }: MessageEvent<PlaygroundWorkerResponse>) => {
        if (!data || typeof data !== 'object' || typeof data.ok !== 'boolean') {
          finish({ ok: false, error: 'Invalid interpreter response' });
        } else finish(data);
      };
      worker.onerror = event => {
        event.preventDefault();
        finish({ ok: false, error: event.message || 'Unable to initialize the interpreter worker' });
      };
      worker.onmessageerror = () => finish({ ok: false, error: 'Unable to read the interpreter result' });
      worker.postMessage({ code, timeoutMs } satisfies PlaygroundWorkerRequest);
    } catch (error) {
      finish({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
