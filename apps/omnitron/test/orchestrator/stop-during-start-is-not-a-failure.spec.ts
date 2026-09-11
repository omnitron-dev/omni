/**
 * A child that never came up because the operator stopped the app is not a
 * failure, and must not be reported as one.
 *
 * `stack stop` issued while anything is still booting kills every child that
 * has not finished starting. Each of those arrives as `child:start-failed`,
 * and the orchestrator wrote one level-50 `process.start_failed` per child
 * into the app's own log — carrying the message titan-pm builds for a killed
 * start: the process "did not choose to exit, so its own logs will not explain
 * this". True, and it sends whoever reads it hunting a fault in an application
 * that was doing nothing wrong. Six apps' worth of those, every restart.
 */
import { EventEmitter } from 'node:events';
import { describe, it, expect } from 'vitest';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';

const silentLogger = (): any => {
  const noop = () => {};
  const logger: any = { trace: noop, debug: noop, info: noop, warn: noop, error: noop, fatal: noop };
  logger.child = () => logger;
  return logger;
};

function harness() {
  const service = new OrchestratorService(silentLogger(), {} as never, {} as never, process.cwd());
  const lines: string[] = [];
  service.onAppLog((_app, line) => lines.push(line));

  const supervisor = new EventEmitter();
  const handle = new AppHandle('acme/dev/main', 'bootstrap' as never);
  (service as any).wireSupervisorEvents({ name: 'acme/dev/main' }, handle, supervisor);

  const killedDuringStartup = Object.assign(
    new Error(
      'Worker exited during startup after being killed by SIGTERM — it did not choose to exit, so its own logs will not explain this'
    ),
    { details: { stderr: '[omnitron:boot] config:loading bootstrap.js' } }
  );

  return { service, lines, supervisor, handle, killedDuringStartup };
}

const startFailures = (lines: string[]) =>
  lines.map((l) => JSON.parse(l)).filter((e) => e.event === 'process.start_failed');

describe('a start cut short by a stop', () => {
  it('writes no start failure when the app is being stopped', () => {
    const { lines, supervisor, handle, killedDuringStartup } = harness();
    handle.markStopping();

    supervisor.emit('child:start-failed', 'http', killedDuringStartup);

    expect(startFailures(lines)).toEqual([]);
    expect(lines, 'nor the captured boot output as if it were evidence').toEqual([]);
    expect(handle.lastExit?.expected).toBe(true);
  });

  it('writes no start failure when titan-pm aborted the spawn itself', () => {
    // ProcessManager.kill() arriving mid-spawn now terminates the child as
    // soon as it has a handle and flags the rejection.
    const { lines, supervisor, handle } = harness();
    const aborted = Object.assign(
      new Error("Process 'http' was stopped while it was still starting"),
      { stoppedDuringStartup: true }
    );

    supervisor.emit('child:start-failed', 'http', aborted);

    expect(startFailures(lines)).toEqual([]);
    expect(handle.lastExit?.expected).toBe(true);
  });

  it('still reports a genuine start failure in full', () => {
    const { lines, supervisor, handle, killedDuringStartup } = harness();
    // Nobody asked for this app to stop.
    expect(handle.status).not.toBe('stopping');

    supervisor.emit('child:start-failed', 'http', killedDuringStartup);

    const failures = startFailures(lines);
    expect(failures).toHaveLength(1);
    expect(failures[0].level).toBe(50);
    expect(failures[0].processName).toBe('acme/dev/main/http');
    expect(handle.lastExit?.expected).toBe(false);
    // and the boot output it captured comes with it
    expect(lines.some((l) => l.includes('config:loading'))).toBe(true);
  });
});
