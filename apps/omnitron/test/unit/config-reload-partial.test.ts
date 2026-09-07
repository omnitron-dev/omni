/**
 * A SIGHUP reload that fails part-way says which part applied.
 *
 * `reloadConfigOnHup` applies the new config to three places in turn: the
 * orchestrator, the file watcher, and the RPC service's snapshot. Loading can
 * fail harmlessly — nothing has been applied yet — but a failure during the
 * APPLY leaves the daemon split: the orchestrator restarting apps from the new
 * list while the watcher still watches the old one. The comment on the watcher
 * step names that split as the bug it was added to fix.
 *
 * What the operator saw was `SIGHUP config reload failed: <message>` and
 * nothing about state, so the reasonable reading — "the reload did not happen,
 * the daemon is as it was" — is the wrong one exactly when it matters.
 *
 * Found through `no-useless-catch`: the handler ended in `catch (err) { throw
 * err; }`, which does nothing at all. Removing it is trivial; what it was
 * hiding is not.
 */

import { describe, it, expect } from 'vitest';

import { applyReloadedConfig } from '../../src/daemon/config-reload.js';

const cfg = { apps: [] } as never;

describe('applyReloadedConfig', () => {
  it('applies every step in order when all succeed', async () => {
    const done: string[] = [];
    await applyReloadedConfig(cfg, [
      { name: 'orchestrator', apply: async () => { done.push('orchestrator'); } },
      { name: 'file watcher', apply: async () => { done.push('watcher'); } },
      { name: 'RPC snapshot', apply: async () => { done.push('rpc'); } },
    ]);
    expect(done).toEqual(['orchestrator', 'watcher', 'rpc']);
  });

  it('names what applied and what did not when a step fails', async () => {
    const attempt = applyReloadedConfig(cfg, [
      { name: 'orchestrator', apply: async () => {} },
      { name: 'file watcher', apply: async () => { throw new Error('watch: EMFILE'); } },
      { name: 'RPC snapshot', apply: async () => { throw new Error('never reached'); } },
    ]);

    await expect(attempt).rejects.toThrow(/file watcher/);
    // The half that makes the message worth reading: the daemon is not as it
    // was, and the message has to say so rather than leave the reader to
    // assume a failed reload is a reload that did not happen.
    await expect(attempt).rejects.toThrow(/orchestrator/);
    await expect(attempt).rejects.toThrow(/RPC snapshot/);
  });

  it('keeps the original failure as `cause`', async () => {
    const original = new Error('watch: EMFILE');
    let thrown: unknown;
    try {
      await applyReloadedConfig(cfg, [
        { name: 'file watcher', apply: async () => { throw original; } },
      ]);
    } catch (err) {
      thrown = err;
    }
    expect((thrown as Error).cause).toBe(original);
  });

  it('reports a first-step failure as nothing applied', async () => {
    // The benign case must stay benign: if the very first step fails, the
    // daemon really is as it was, and saying otherwise would be its own lie.
    await expect(
      applyReloadedConfig(cfg, [
        { name: 'orchestrator', apply: async () => { throw new Error('boom'); } },
        { name: 'file watcher', apply: async () => {} },
      ]),
    ).rejects.toThrow(/nothing was applied/i);
  });
});
