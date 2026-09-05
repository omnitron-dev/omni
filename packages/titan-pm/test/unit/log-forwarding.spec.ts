/**
 * WorkerHandle default log forwarding.
 *
 * `setupDefaultLogForwarding` re-emits every child log line through the parent
 * logger. That is correct for a consumer with no pipeline of its own, and it is
 * duplication for one that subscribes to `onLog` itself — the same line then
 * lands twice, once under the child's application name and once under the
 * parent's. Measured on a live omnitron log table: 42,958 rows under
 * `omnitron` against 36,160 under every other application combined, with
 * matching (timestamp, message) pairs across the two names.
 *
 * There was no way to turn it off; these pin the switch in both positions.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import { WorkerHandle } from '../../src/process-spawner.js';
import { ProcessStatus } from '../../src/types.js';
import type { ILogger } from '../../src/types.js';

const makeLogger = () => {
  const calls: Array<{ level: string; data: unknown; msg: unknown }> = [];
  const record = (level: string) => (data: unknown, msg?: unknown) => calls.push({ level, data, msg });
  const logger: Record<string, unknown> = {
    trace: record('trace'),
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    fatal: record('fatal'),
  };
  logger['child'] = () => logger;
  return { logger: logger as unknown as ILogger, calls };
};

/** A worker double that only has to survive setupMessageHandlers(). */
const makeWorker = () => {
  const worker = new EventEmitter() as EventEmitter & { stdout?: unknown; stderr?: unknown; kill?: unknown };
  worker.kill = vi.fn();
  return worker;
};

const build = (forwardChildLogs?: boolean) => {
  const { logger, calls } = makeLogger();
  const handle = new WorkerHandle(
    'proc-1',
    makeWorker() as never,
    null,
    'unix:///tmp/x.sock',
    'priceverse',
    '1.0.0',
    logger,
    false,
    undefined,
    ProcessStatus.RUNNING,
    undefined,
    forwardChildLogs
  );
  return { handle, calls };
};

const LINE = JSON.stringify({ level: 30, time: Date.now(), msg: 'tick', ctx: 'scheduler' });

describe('WorkerHandle child log forwarding', () => {
  it('forwards to the parent logger by default', () => {
    const { handle, calls } = build();

    (handle as unknown as { emitLog: (l: string, s: string) => void }).emitLog(LINE, 'stdout');

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ level: 'info', msg: 'tick' });
  });

  it('does not forward when the consumer routes onLog itself', () => {
    // The duplication case: a consumer with its own pipeline subscribes to
    // onLog, and the default forwarder was ALSO writing the line through the
    // parent logger — so the same line was recorded under two application
    // names, and every per-application count was wrong.
    const { handle, calls } = build(false);
    const consumed: string[] = [];
    handle.onLog((line) => consumed.push(line));

    (handle as unknown as { emitLog: (l: string, s: string) => void }).emitLog(LINE, 'stdout');

    expect(consumed).toEqual([LINE]);
    expect(calls).toHaveLength(0);
  });

  it('still delivers to onLog subscribers when forwarding is on', () => {
    // Turning the default OFF must be the only difference; the event itself is
    // the consumer's own channel and is unaffected either way.
    const { handle, calls } = build(true);
    const consumed: string[] = [];
    handle.onLog((line) => consumed.push(line));

    (handle as unknown as { emitLog: (l: string, s: string) => void }).emitLog(LINE, 'stdout');

    expect(consumed).toEqual([LINE]);
    expect(calls).toHaveLength(1);
  });

  it('routes an unparseable stderr line to error, and only once', () => {
    const { handle, calls } = build(true);

    (handle as unknown as { emitLog: (l: string, s: string) => void }).emitLog('not json', 'stderr');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.level).toBe('error');
  });
});
