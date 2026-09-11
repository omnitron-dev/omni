/**
 * A pool worker's output has to go somewhere.
 *
 * `attachLogCapture` is driven by the supervisor's `child:started`, and a pool
 * worker is not a supervisor child — so nothing ever subscribed to one.
 * Everything pricing's OHLCV aggregator and storage's image transformer
 * printed went nowhere, for as long as they have existed. Since titan-pm began
 * holding a child's output until someone asks for it, it was also a megabyte
 * per worker retained for a reader that never arrived.
 */
import { describe, it, expect, vi } from 'vitest';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';

const silentLogger = (): any => {
  const noop = () => {};
  const logger: any = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  logger.child = () => logger;
  return logger;
};

/** Enough of a WorkerHandle to be subscribed to. */
const fakeWorker = () => {
  const handlers: Array<(line: string, stream: 'stdout' | 'stderr') => void> = [];
  return {
    onLog: (h: (line: string, stream: 'stdout' | 'stderr') => void) => handlers.push(h),
    emit: (line: string, stream: 'stdout' | 'stderr' = 'stdout') => handlers.forEach((h) => h(line, stream)),
    subscribers: () => handlers.length,
  };
};

const appHandle = () => ({
  logs: [] as string[],
  stderr: [] as string[],
  appendLog(line: string) {
    this.logs.push(line);
  },
  appendStderr(line: string) {
    this.stderr.push(line);
  },
});

describe('pool log capture', () => {
  it('subscribes to every worker in the pool', () => {
    const service = new OrchestratorService(silentLogger(), {} as never, {} as never, process.cwd());
    const persisted: Array<{ app: string; line: string }> = [];
    service.onAppLog((app, line) => persisted.push({ app, line }));

    const workers = { w1: fakeWorker(), w2: fakeWorker() };
    const pool = {
      getWorkerIds: () => Object.keys(workers),
      getWorkerHandle: (id: string) => (workers as Record<string, unknown>)[id],
    };
    const handle = appHandle();

    (service as any).attachPoolLogCapture('acme/dev/pricing', 'ohlcv-aggregator', handle, pool);

    expect(workers.w1.subscribers(), 'a pool worker was left unsubscribed').toBe(1);
    expect(workers.w2.subscribers()).toBe(1);

    workers.w1.emit('aggregated 5m candles');
    workers.w2.emit('worker two failed', 'stderr');

    expect(handle.logs).toEqual(['aggregated 5m candles', 'worker two failed']);
    expect(handle.stderr, 'stderr also feeds the crash tail').toEqual(['worker two failed']);
    expect(persisted.map((p) => p.line)).toEqual(['aggregated 5m candles', 'worker two failed']);
    expect(persisted[0]?.app).toBe('acme/dev/pricing');
  });

  it('tolerates a worker handle that cannot be subscribed to', () => {
    const service = new OrchestratorService(silentLogger(), {} as never, {} as never, process.cwd());
    const pool = { getWorkerIds: () => ['gone', 'ok'], getWorkerHandle: (id: string) => (id === 'ok' ? fakeWorker() : null) };

    expect(() =>
      (service as any).attachPoolLogCapture('app', 'proc', appHandle(), pool)
    ).not.toThrow();
  });
});
