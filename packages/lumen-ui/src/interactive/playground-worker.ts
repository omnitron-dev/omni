import { evaluatePlayground } from '@omnitron-dev/lumen-ast/execution';
import type { PlaygroundWorkerRequest, PlaygroundWorkerResponse } from './playground-execution.js';

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<PlaygroundWorkerRequest>) => void) | null;
  postMessage(message: PlaygroundWorkerResponse): void;
};

workerScope.onmessage = async ({ data }) => {
  workerScope.onmessage = null;
  try {
    const result = await evaluatePlayground(data.code, data.timeoutMs);
    workerScope.postMessage({ ok: true, result });
  } catch (error) {
    workerScope.postMessage({ ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 2048) });
  }
};
