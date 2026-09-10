/**
 * Lines a child printed before anyone was listening.
 *
 * A consumer that routes logs itself (`forwardChildLogs: false` — what
 * omnitron's daemon does) registers its `onLog` handler when it learns the
 * child exists, and it learns that from the supervisor's `child:started`,
 * which fires only after `spawn()` has RESOLVED. Everything the child printed
 * while starting up therefore reached an empty handler set and was discarded:
 * the whole application boot, and — when the boot is what failed — the only
 * evidence of why. A child that dies during startup never reaches
 * `child:started` at all, so nothing of it was ever captured.
 *
 * That is not theoretical. A DI deadlock during `Application.create` took a
 * production backend down for seven hours with no log line anywhere naming a
 * cause: the process had printed its way to the deadlock and the parent threw
 * every line away.
 */
import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import { WorkerHandle } from '../../src/process-spawner.js';
import { ProcessStatus } from '../../src/types.js';
import type { ILogger } from '../../src/types.js';

const silentLogger = () => {
  const noop = () => {};
  const logger: Record<string, unknown> = {
    trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop,
  };
  logger['child'] = () => logger;
  return logger as unknown as ILogger;
};

const makeWorker = () => {
  const worker = new EventEmitter() as EventEmitter & { kill?: unknown };
  worker.kill = vi.fn();
  return worker;
};

/** `forwardChildLogs: false` — the consumer routes logs itself. */
const build = () =>
  new WorkerHandle(
    'proc-1',
    makeWorker() as never,
    null,
    'unix:///tmp/x.sock',
    'main',
    '1.0.0',
    silentLogger(),
    false,
    undefined,
    ProcessStatus.STARTING,
    undefined,
    false
  );

const collect = (handle: WorkerHandle) => {
  const seen: Array<{ line: string; stream: string }> = [];
  handle.onLog((line, stream) => seen.push({ line, stream }));
  return seen;
};

describe('WorkerHandle pre-capture buffering', () => {
  it('takes over what the child printed before the handle existed', () => {
    // The readline interfaces live in this constructor, and the constructor
    // does not run until the child reports ready — so nothing in the handle can
    // have seen a single line of the boot. `waitForReady` was already reading
    // those streams to explain failures; on success it hands them over.
    const handle = build();
    handle.seedStartupOutput({
      stdout: 'Application starting\nLogger module initialized\n',
      stderr: '[omnitron:boot] config:loading bootstrap.js\n',
    });

    const seen = collect(handle);

    expect(seen.map((e) => e.line)).toEqual([
      'Application starting',
      'Logger module initialized',
      '[omnitron:boot] config:loading bootstrap.js',
    ]);
    expect(seen[2]?.stream).toBe('stderr');
  });

  it('replays what the child printed before the first handler arrived', () => {
    const handle = build();

    handle.emitLog('Application starting', 'stdout');
    handle.emitLog('config:loading', 'stderr');

    const seen = collect(handle);

    expect(seen.map((e) => e.line)).toEqual(['Application starting', 'config:loading']);
    expect(seen[1]?.stream, 'the stream a line came from is part of the evidence').toBe('stderr');
  });

  it('keeps delivering live once a handler is listening', () => {
    const handle = build();
    handle.emitLog('before', 'stdout');
    const seen = collect(handle);

    handle.emitLog('after', 'stdout');

    expect(seen.map((e) => e.line)).toEqual(['before', 'after']);
  });

  it('does not replay to a handler that joins later', () => {
    // The first handler already took the backlog. Replaying it again would
    // write every boot line to disk twice.
    const handle = build();
    handle.emitLog('boot', 'stdout');
    collect(handle);

    const late: string[] = [];
    handle.onLog((line) => late.push(line));
    handle.emitLog('live', 'stdout');

    expect(late).toEqual(['live']);
  });

  it('keeps the tail and says how much it dropped', () => {
    const handle = build();
    const big = 'x'.repeat(200_000);
    for (let i = 0; i < 8; i++) handle.emitLog(`${i}:${big}`, 'stdout');
    handle.emitLog('the last thing before it died', 'stderr');

    const seen = collect(handle);
    const lines = seen.map((e) => e.line);

    expect(lines[lines.length - 1], 'the line next to the failure is the one to keep').toBe(
      'the last thing before it died'
    );
    expect(lines[0], 'a silent gap is worse than a reported one').toMatch(/line\(s\).*dropped/);
  });
});
