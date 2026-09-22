/**
 * A process we had to kill was logged as one that exited cleanly.
 *
 *     const expected = this._status === ProcessStatus.STOPPING
 *                   || this._status === ProcessStatus.STOPPED;
 *     this.logger[expected ? 'info' : 'warn'](
 *       info, expected ? 'Worker exited cleanly' : 'Worker exited unexpectedly');
 *
 * `expected` answers "did we ask for this?". The message claims "it exited
 * cleanly". Those are different questions, and the gap between them is
 * exactly the case worth knowing about: a process that was asked to stop,
 * did not, and was killed once its window ran out. Its shutdown hooks did
 * not run — that is what "not cleanly" means — but its status was STOPPING,
 * so the line said the opposite.
 *
 * Observed on the daemon, one worker's last three records:
 *
 *     05:27:16.981  SIGTERM timeout, sending SIGKILL
 *     05:27:16.991  Connection closed
 *     05:27:16.998  Worker exited cleanly          signal=SIGKILL
 *
 * «exited cleanly» carrying `signal=SIGKILL`. In `~/.omnitron/logs/omnitron.log`
 * there are 123 «SIGTERM timeout, sending SIGKILL» — 47 on 20.09, 70 on
 * 21.09, 6 on 22.09, the last of them 22 minutes before this was written —
 * and each one is followed by a line at INFO saying the worker went quietly.
 * An operator reading the log for trouble finds none.
 *
 * This does not fix why the processes miss their window; it stops the log
 * from hiding that they do.
 */

import { describe, it, expect, vi } from 'vitest';

import { WorkerHandle } from '../src/process-spawner.js';
import { ProcessStatus } from '../src/types.js';

const recordingLogger = () => {
  const logger: any = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn() };
  logger.child = () => logger;
  return logger;
};

/**
 * Drive `emitExit` directly. A real spawn would need a real child and a real
 * shutdown window; what is under test is how an exit is CLASSIFIED, which is
 * a pure function of the status and how the process left.
 */
function exitWith(status: ProcessStatus, code: number | null, signal: NodeJS.Signals | null) {
  const logger = recordingLogger();
  const handle: any = Object.create(WorkerHandle.prototype);
  Object.assign(handle, {
    id: 'worker-1',
    serviceName: 'ohlcv-aggregator',
    logger,
    exitEmitted: false,
    _status: status,
  });
  // The EventEmitter half is not initialised by `Object.create`.
  handle.emit = () => true;

  handle.emitExit(code, signal);

  const calls = (fn: any) =>
    fn.mock.calls.map(([fields, msg]: [Record<string, unknown>, string]) => ({ fields, msg: String(msg) }));
  return { info: calls(logger.info), warn: calls(logger.warn) };
}

describe('a kill recorded as a clean exit', () => {
  it('a worker killed after missing its shutdown window did not exit cleanly', () => {
    const { info, warn } = exitWith(ProcessStatus.STOPPING, null, 'SIGKILL');

    expect(info, 'a kill is not news at info level').toHaveLength(0);
    expect(warn, 'and it is news').toHaveLength(1);
    expect(warn[0]!.msg).not.toMatch(/cleanly/i);
    expect(warn[0]!.msg).toMatch(/kill|did not exit|window/i);
    expect(warn[0]!.fields['signal']).toBe('SIGKILL');
  });

  it('a worker that stopped when asked still exited cleanly', () => {
    // Control: the quiet, ordinary case stays quiet. This is most stops.
    const { info, warn } = exitWith(ProcessStatus.STOPPING, 0, null);

    expect(warn).toHaveLength(0);
    expect(info).toHaveLength(1);
    expect(info[0]!.msg).toMatch(/cleanly/i);
  });

  it('a worker that died unasked is still unexpected', () => {
    // Control: the other half of the original branch is untouched.
    const { info, warn } = exitWith(ProcessStatus.RUNNING, 1, null);

    expect(info).toHaveLength(0);
    expect(warn).toHaveLength(1);
    expect(warn[0]!.msg).toMatch(/unexpectedly/i);
  });

  it('a worker that took SIGTERM and left is clean — the signal alone is not the point', () => {
    // Control: being signalled is normal; being KILLED after refusing is not.
    // Reading any signal as force would turn every ordinary stop into a
    // warning, which is the failure mode of fixing this too eagerly.
    const { info, warn } = exitWith(ProcessStatus.STOPPING, null, 'SIGTERM');

    expect(warn).toHaveLength(0);
    expect(info[0]!.msg).toMatch(/cleanly/i);
  });
});
