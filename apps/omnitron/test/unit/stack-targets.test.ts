import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { StackTargets } from '../../src/project/stack-targets.js';

const scope = { project: 'sample', stack: 'prod' };
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-stack-targets-'));
  const logger: any = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const store = new DaemonStateStore(logger, path.join(directory, 'state.db'));
  cleanups.push(async () => { await store.dispose(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, targets: new StackTargets(store) };
}
describe('persistent deployment target obligations', () => {
  it('retains old destinations after reopening and merging a changed declaration', async () => {
    const { targets, store } = fixture();
    const first = { host: 'first.test', port: 9700, applications: true };
    targets.remember(scope, [first]);
    await store.dispose();
    const reloaded = new StackTargets(store);
    reloaded.remember(scope, [{ host: 'next.test', port: 9700, applications: false }]);
    expect(reloaded.inspect(scope).nodes).toEqual([first, { host: 'next.test', port: 9700, applications: false }]);
    reloaded.remember(scope, [{ ...first, applications: false }]);
    expect(reloaded.inspect(scope).nodes[0]!.applications).toBe(true);
  });
  it('never clears destinations admitted after the stop snapshot', () => {
    const { targets } = fixture();
    targets.remember(scope, [{ host: 'first.test', port: 9700, applications: true }]);
    const before = targets.inspect(scope);
    targets.remember(scope, [{ host: 'next.test', port: 9700, applications: true }]);
    expect(() => targets.confirmStopped(scope, before.revision)).toThrow('changed during stop');
    expect(targets.inspect(scope).nodes).toHaveLength(2);
    targets.confirmStopped(scope, targets.inspect(scope).revision);
    expect(targets.inspect(scope).nodes).toEqual([]);
  });
  it('uses FULL durability and refuses a failed write or corrupt destination inventory', () => {
    const { targets, store } = fixture();
    const original = store.kvSetSync.bind(store);
    let synchronous = 0;
    const write = vi.spyOn(store, 'kvSetSync').mockImplementation((key, value) => {
      synchronous = Number(store.initSync().pragma('synchronous', { simple: true })); original(key, value);
    });
    targets.remember(scope, [{ host: 'first.test', port: 9700, applications: true }]);
    expect(synchronous).toBe(2);
    write.mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => targets.remember(scope, [{ host: 'next.test', port: 9700, applications: true }])).toThrow('disk full');
    expect(targets.inspect(scope).nodes).toHaveLength(1);
    write.mockRestore();
    store.kvSetSync('lifecycle:stack-targets:sample/prod', { version: 1, revision: 1, nodes: [{ host: 'bad\nhost', port: 9700, applications: true }] });
    expect(() => targets.inspect(scope)).toThrow('Corrupt');
  });
});
