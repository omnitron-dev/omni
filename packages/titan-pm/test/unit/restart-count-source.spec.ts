/**
 * Where a restart count actually comes from.
 *
 * `IProcessInfo.restartCount` was assigned `0` at registration
 * (`process-manager.ts`) and incremented nowhere in the package. The real
 * counter is `ProcessSupervisor.restartCounts`, raised in `performRestart` and
 * read through `getRestartCount(name)` — keyed by process NAME, while the
 * manager keys by id.
 *
 * Two registries for one fact, and the one carrying the public, exported type
 * was the one that always answered zero. That is the shape that cost the most
 * elsewhere in this audit: a reader who trusts the field's name gets a
 * confident wrong answer, and moving that answer onto a new code path (a table
 * column, an API response) makes it look freshly verified.
 *
 * A fabricated `0` is worse than no value: absent is a question, zero is a
 * claim. The manager no longer makes the claim, and the field is optional so
 * every reader has to confront it.
 */

import 'reflect-metadata';
import { describe, it, expect, afterEach } from 'vitest';

import { ProcessManager } from '../../src/process-manager.js';
import { ProcessSupervisor } from '../../src/process-supervisor.js';
import { ProcessSpawnerFactory } from '../../src/process-spawner.js';
import { AdvancedMockProcessSpawner } from '@omnitron-dev/testing/titan';

// Pre-register the mock spawner so `useMockSpawner: true` is honoured. Without
// it the factory falls back to the real spawner and forks a process.
ProcessSpawnerFactory.setMockSpawner(AdvancedMockProcessSpawner);

const silent = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child() {
    return this;
  },
};

class Countable {
  async ping() {
    return 'pong';
  }
}

describe('restart count source', () => {
  let pm: ProcessManager | undefined;

  afterEach(async () => {
    await pm?.shutdown({ force: true }).catch(() => {});
    pm = undefined;
  });

  it('the manager publishes no restart count of its own', async () => {
    pm = new ProcessManager(silent as never, { testing: { useMockSpawner: true } } as never);

    await pm.spawn(Countable, { name: 'countable' });

    const info = pm.listProcesses().find((p) => p.name === 'countable');
    expect(info, 'the process was not registered at all').toBeDefined();
    // Not `toBe(0)`: zero is an assertion that no restart has happened, and
    // this component has no way to know that.
    expect(
      info!.restartCount,
      'the manager fabricated a restart count it does not track'
    ).toBeUndefined();
  });

  it('the supervisor is the component that owns the count', () => {
    // The comment on `IProcessInfo.restartCount` sends readers here. A named
    // alternative that quietly disappears is how a citation rots into a lie,
    // so the pointer is checked rather than trusted.
    expect(typeof ProcessSupervisor.prototype.getRestartCount).toBe('function');
  });
});
