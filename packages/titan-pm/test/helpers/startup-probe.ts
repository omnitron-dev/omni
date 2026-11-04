import { vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { ProcessSpawner } from '../../src/process-spawner.js';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

/** Supply a real synthetic child while retaining the ordinary capture/startup pipeline. */
export function startupProbe(child: ChildProcess, timeout: number, logger: ILogger) {
  const spawner = new ProcessSpawner(logger, { forwardChildLogs: false });
  const internal = spawner as unknown as {
    spawnChildProcess(...args: unknown[]): Promise<ChildProcess>;
    waitForReady(...args: unknown[]): Promise<unknown>;
  };
  let started!: () => void;
  const armed = new Promise<void>(resolve => { started = resolve; });
  const wait = internal.waitForReady.bind(spawner);
  const spawnMock = vi.spyOn(internal, 'spawnChildProcess').mockResolvedValueOnce(child);
  const waitMock = vi.spyOn(internal, 'waitForReady').mockImplementationOnce((...args) => {
    const pending = wait(...args);
    started();
    return pending;
  });
  // The substituted child is already running; this path only satisfies the
  // normal readable-entry check and is never executed by the fixture.
  const result = spawner.spawn(process.execPath, { isolation: 'child', startupTimeout: timeout })
    .finally(() => { spawnMock.mockRestore(); waitMock.mockRestore(); });
  void result.catch(() => { started(); });
  return { armed, result };
}
