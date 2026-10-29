/** Await an operation without retaining the abort listener after settlement. */
export function abortable<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation();
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      operation().then(
        value => { cleanup(); if (signal.aborted) reject(signal.reason); else resolve(value); },
        error => { cleanup(); reject(signal.aborted ? signal.reason : error); }
      );
    } catch (error) {
      cleanup();
      reject(signal.aborted ? signal.reason : error);
    }
  });
}

/** One deadline covers all transport attempts, body decoding and response middleware. */
export function invocationScope(timeout: number, timeoutError: Error, parent?: AbortSignal) {
  parent?.throwIfAborted();
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2 ** 31 - 1) {
    throw new RangeError('Invocation timeout must be between 0 and 2147483647 milliseconds');
  }
  const controller = new AbortController();
  const onAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError), timeout);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

export function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
