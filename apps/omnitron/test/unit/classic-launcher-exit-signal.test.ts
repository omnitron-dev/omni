/**
 * What an operator is told when a starting app is killed.
 *
 * Node's `'exit'` event carries `(code, signal)`. A process killed by a
 * signal reports `code === null` and names the signal — and the signal is the
 * whole diagnosis: SIGKILL is the OOM killer, a jetsam eviction, or someone's
 * `kill -9`; SIGTERM is a deliberate stop; SIGSEGV is a native crash. The
 * startup handler took only `code`, so all of them arrived as
 * "exited during startup with code null".
 *
 * Found the hard way. `daos/dev/paysys` failed to start three times on
 * 2026-09-07 under a load average of 95, and the log said `code null` with a
 * stderr tail ending at `application:creating`. There was no way to tell a
 * kill from a crash without going to the OS, and the crash path in the same
 * package — `orchestrator.service.ts`, on the very child this launcher
 * returns — logs `{ code, signal }` correctly. One event, two treatments,
 * which is what makes it an oversight rather than a decision.
 */

import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';

import { waitForReady } from '../../src/orchestrator/classic-launcher.js';
import { AppHandle } from '../../src/orchestrator/app-handle.js';

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

/** A real child that never reports ready, so only its exit can settle it. */
function silentChild() {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60_000)'], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
}

function handleFor(name: string) {
  return new AppHandle({ name, script: './x.js' } as any, 'classic');
}

describe('classic launcher — how a startup exit is reported', () => {
  it('names the signal when the app is killed', async () => {
    const child = silentChild();
    const handle = handleFor('killed-app');
    const ready = waitForReady(child, handle, logger);

    child.kill('SIGKILL');

    // Not `rejects.toThrow()` alone: the failure this guards against still
    // rejects, it just rejects saying nothing. The message has to carry the
    // signal.
    await expect(ready).rejects.toThrow(/SIGKILL/);
    expect(handle.status).toBe('errored');
  });

  it('still reports a plain exit code when there is no signal', async () => {
    // The other half must survive: an app that exits 1 on a bad config has a
    // code and no signal, and "killed by null" would be its own defect.
    const child = spawn(process.execPath, ['-e', 'process.exit(3)'], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    const handle = handleFor('exited-app');

    await expect(waitForReady(child, handle, logger)).rejects.toThrow(/code 3/);
  });

  it('does not call a signalled exit a code', async () => {
    // The exact regression: `code null` reads as though the process chose to
    // exit and returned nothing, which sends the reader to the app's own
    // startup path rather than to the machine.
    const child = silentChild();
    const handle = handleFor('sigterm-app');
    const ready = waitForReady(child, handle, logger);

    child.kill('SIGTERM');

    await expect(ready).rejects.toThrow(/SIGTERM/);
    await expect(ready).rejects.not.toThrow(/code null/);
  });
});
