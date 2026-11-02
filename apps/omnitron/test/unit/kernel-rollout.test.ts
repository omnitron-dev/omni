import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { KernelRolloutService } from '../../src/services/kernel-rollout.service.js';
import { ManagedRolloutFailure, type ManagedRolloutObservation } from '../../src/services/managed-rollout.js';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';
import type { DeployTarget } from '../../src/services/remote-deployer.service.js';

const commit = 'f'.repeat(40), previous = '0'.repeat(64), candidate = '1'.repeat(64);
const recordKey = (id: string) => 'fleet:kernel:v1:plan:' + id;
async function ready(service: KernelRolloutService, sha: string, nodeIds?: string[]) {
  const pending = await service.plan(sha, nodeIds);
  await vi.waitFor(() => expect(service.get(pending.id)?.state).not.toBe('planning'));
  return service.get(pending.id)!;
}
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'kernel-rollout-'));
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const file = path.join(directory, 'state.db');
  const store = new DaemonStateStore(logger as never, file);
  const reader = new DaemonStateStore(logger as never, file);
  cleanups.push(async () => { await reader.dispose(); await store.dispose(); rmSync(directory, { recursive: true, force: true }); });
  const nodes = {
    listNodes: () => ['b', 'a', 'local'].map(id => ({ id, name: id, isLocal: id === 'local' })),
    nodeToDeployTarget: vi.fn(async (id: string): Promise<DeployTarget> => ({
      label: id, host: id, expectedHostFingerprint: 'pin-' + id, password: 'must-not-persist',
    })),
  };
  const proof = (host: string): ManagedRolloutObservation => ({
    commit, previous, candidate, ownerId: 'owner-' + host, ownerPid: 10, backendPid: 11, appsDigest: 'a'.repeat(64), selectionRevision: 2,
  });
  const driver = {
    inspectManagedRollout: vi.fn(async (target: DeployTarget) => proof(target.host)),
    activateManagedRollout: vi.fn(async (_target: DeployTarget, _plan: ManagedRolloutObservation) => {}),
    reconcileManagedRollout: vi.fn(async (): Promise<'candidate' | 'previous'> => 'candidate'),
  };
  const authority = vi.fn<() => void>(() => {});
  const controllerOwner = vi.fn<() => string | null>(() => null);
  const service = new KernelRolloutService(store, nodes, driver, logger.error, authority, controllerOwner);
  const observer = new KernelRolloutService(reader, nodes, driver, logger.error, authority, controllerOwner);
  return { service, observer, driver, nodes, store, logger, proof, authority, controllerOwner };
}

describe('durable managed fleet kernel controller', () => {
  it('records reviewed order, independent owner and sealed artifacts in SQLite, excluding SSH credentials', async () => {
    const { service, observer, store } = fixture();
    expect(observer.get()).toBeNull();
    const defaults = await ready(service, commit);
    expect(defaults.targets.map(t => t.nodeId)).toEqual(['a', 'b']);
    const selected = await ready(service, commit, ['b','a']);
    expect(observer.get()).toEqual(selected);
    expect(observer.get(defaults.id)).toEqual(defaults);
    expect(selected.targets[0]).toMatchObject({ nodeId: 'b', previous, candidate, ownerId: 'owner-b', ownerPid: 10, state: 'ready' });
    expect(JSON.stringify(store.kvGetSync(recordKey(selected.id)))).not.toContain('must-not-persist');
    await expect(service.plan('/opt/runtime', ['a'])).rejects.toThrow('40-character');
    await expect(service.plan(commit, ['a','a'])).rejects.toThrow('distinct');
  });

  it('returns a durable ID before any remote preflight reply and supports idempotent retries', async () => {
    const { service, observer, driver, proof } = fixture();
    const requestId = 'ac711f78-6899-471f-a25a-81899586847e';
    const gate = Promise.withResolvers<ManagedRolloutObservation>();
    driver.inspectManagedRollout.mockImplementationOnce(() => gate.promise);
    const pending = await service.plan(commit, ['b','a'], requestId);
    expect(pending.id).toBe(requestId);
    expect(pending.state).toBe('planning');
    expect(observer.get()?.targets.map(t => t.state)).toEqual(['pending','pending']);
    expect(await observer.plan(commit, ['b','a'], requestId)).toEqual(pending);
    await expect(observer.plan(commit, ['a','b'], requestId)).rejects.toThrow('different rollout');
    expect(() => observer.start(requestId)).toThrow('ready plan');
    await expect(observer.plan(commit, ['a'])).rejects.toThrow(requestId);
    expect(driver.inspectManagedRollout).toHaveBeenCalledTimes(1);
    gate.resolve(proof('b'));
    await vi.waitFor(() => expect(observer.get()?.state).toBe('planned'));
    expect(driver.inspectManagedRollout).toHaveBeenCalledTimes(2);
    expect(await observer.plan(commit, ['b','a'], requestId)).toEqual(observer.get());
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });

  it('binds optional staging to the reviewed request and never stages while executing a current target', async () => {
    const { service, driver, proof } = fixture();
    driver.inspectManagedRollout.mockImplementation(async t => ({ ...proof(t.host), previous: candidate }));
    const pending = await service.plan(commit, ['a'], undefined, true);
    expect(pending.stage).toBe(true);
    await vi.waitFor(() => expect(service.get()?.state).toBe('planned'));
    await expect(service.plan(commit, ['a'], pending.id)).rejects.toThrow('different rollout');
    expect(driver.inspectManagedRollout).toHaveBeenCalledWith(expect.objectContaining({ host:'a' }), commit, { stage: true });
    service.start(pending.id);
    await vi.waitFor(() => expect(service.get()?.state).toBe('succeeded'));
    expect(driver.inspectManagedRollout).toHaveBeenLastCalledWith(expect.objectContaining({ host:'a' }), commit);
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });

  it('restores the read-only preflight after a lost worker and exposes an actionable refusal before retry', async () => {
    const { service, driver, proof, store } = fixture();
    const gate = Promise.withResolvers<ManagedRolloutObservation>();
    driver.inspectManagedRollout.mockImplementationOnce(() => gate.promise);
    const plan = await service.plan(commit);
    const writes = vi.spyOn(store, 'kvUpdateSync').mockImplementation(() => { throw Error('disk full'); });
    gate.resolve(proof('a'));
    await vi.waitFor(() => expect(service.activeCount()).toBe(0));
    writes.mockRestore();
    expect(service.get()?.state).toBe('blocked');
    expect(service.get()?.reason).toMatch(/Repeat the plan/);
    expect((await service.plan(commit, undefined, plan.id)).id).toBe(plan.id);
    await vi.waitFor(() => expect(service.get()?.state).toBe('planned'));
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });

  it('blocks the complete plan for unknown nodes, local controller, duplicate physical identities and missing host pins', async () => {
    const { service, driver, nodes } = fixture();
    const plan = await ready(service, commit, ['a', 'local', 'unknown']);
    expect(plan.state).toBe('blocked');
    expect(plan.targets[1]?.reason).toMatch(/supervisor/);
    expect(plan.targets[2]?.reason).toMatch(/absent/);
    expect(() => service.start(plan.id)).toThrow('ready plan');
    nodes.nodeToDeployTarget.mockImplementation(async id => ({ host: id, expectedHostFingerprint: 'one' }));
    expect((await ready(service, commit)).targets[1]?.reason).toMatch(/same SSH host key/);
    nodes.nodeToDeployTarget.mockImplementation(async id => ({ host: id }));
    expect((await ready(service, commit)).targets[0]?.reason).toMatch(/verified SSH/);
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });

  it('excludes the initiating owner for a second SSH enrollment even with its own node ID, address and host key', async () => {
    const { service, driver, controllerOwner } = fixture();
    controllerOwner.mockReturnValue('owner-b');
    const plan = await ready(service, commit, ['b']);
    expect(plan.state).toBe('blocked');
    expect(plan.targets[0]?.reason).toMatch(/initiating controller/);
    const staged = await service.plan(commit, ['b'], undefined, true);
    await vi.waitFor(() => expect(service.get(staged.id)?.state).toBe('blocked'));
    expect(driver.inspectManagedRollout).toHaveBeenLastCalledWith(expect.objectContaining({ host: 'b' }), commit, {
      stage: true, excludeOwnerId: 'owner-b',
    });
    controllerOwner.mockReturnValue(null);
    const before = await ready(service, commit, ['b']);
    controllerOwner.mockReturnValue('owner-b');
    service.start(before.id);
    await vi.waitFor(() => expect(service.get()?.state).toBe('failed'));
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });

  it('publishes a committed running intent before dispatch, serializes nodes, and rejects concurrent plans across connections', async () => {
    const { service, observer, driver, store } = fixture();
    const other = await ready(observer, commit, ['a']);
    const plan = await ready(service, commit, ['b', 'a']);
    const gate = Promise.withResolvers<void>();
    driver.activateManagedRollout.mockImplementationOnce(() => gate.promise);
    expect(service.start(plan.id).state).toBe('running');
    await vi.waitFor(() => expect(driver.activateManagedRollout).toHaveBeenCalledTimes(1));
    expect(observer.get()?.targets.map(t => t.state)).toEqual(['running', 'ready']);
    const revision = store.kvGetSync<{revision: number}>(recordKey(plan.id))!.revision;
    expect(observer.start(plan.id).state).toBe('running');
    expect(store.kvGetSync<{revision: number}>(recordKey(plan.id))!.revision).toBe(revision);
    expect(() => observer.start(other.id)).toThrow(plan.id);
    await expect(observer.plan(commit)).rejects.toThrow(plan.id);
    await expect(observer.reconcile(plan.id)).rejects.toThrow('original writer');
    gate.resolve();
    await vi.waitFor(() => expect(observer.get(plan.id)?.state).toBe('succeeded'));
    expect(driver.activateManagedRollout.mock.calls.map(([target]) => target.host)).toEqual(['b','a']);
    expect(service.start(plan.id).state).toBe('succeeded');
  });

  it('refuses an endpoint rebinding before dispatch and stops immediately after a confirmed rollback', async () => {
    const { service, observer, driver, nodes } = fixture();
    const plan = await ready(service, commit);
    nodes.nodeToDeployTarget.mockResolvedValueOnce({ host: 'replacement', expectedHostFingerprint: 'pin-a' });
    service.start(plan.id);
    await vi.waitFor(() => expect(observer.get(plan.id)?.state).toBe('failed'));
    expect(observer.get(plan.id)?.targets[0]?.reason).toMatch(/changed after plan/);
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
    const next = await ready(service, commit);
    driver.activateManagedRollout.mockRejectedValueOnce(new ManagedRolloutFailure('Rollback confirmed', 'rolled-back'));
    service.start(next.id);
    await vi.waitFor(() => expect(observer.get()?.targets.map(t => t.state)).toEqual(['rolled-back', 'ready']));
    expect(driver.activateManagedRollout).toHaveBeenCalledTimes(1);
  });

  it('keeps a lost reply fenced until the pinned node returns terminal evidence and never resumes remaining targets', async () => {
    const { service, observer, driver } = fixture();
    const plan = await ready(service, commit);
    driver.activateManagedRollout.mockRejectedValueOnce(new Error('RPC disconnected'));
    service.start(plan.id);
    await vi.waitFor(() => expect(observer.get(plan.id)?.state).toBe('uncertain'));
    await expect(observer.plan(commit)).rejects.toThrow(plan.id);
    driver.reconcileManagedRollout.mockRejectedValueOnce(new Error('Native handoff has not settled'));
    await expect(observer.reconcile(plan.id)).rejects.toThrow('not settled');
    expect(observer.get(plan.id)?.state).toBe('uncertain');
    // Two reconcilers can observe. Only one transaction may clear the intent.
    const attempts = await Promise.allSettled([observer.reconcile(plan.id), service.reconcile(plan.id)]);
    expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(observer.get(plan.id)?.targets.map(t => t.state)).toEqual(['succeeded','ready']);
    expect(observer.get(plan.id)?.state).toBe('failed');
    expect(driver.activateManagedRollout).toHaveBeenCalledTimes(1);
    expect((await ready(observer, commit)).state).toBe('planned');
  });

  it('recovers interrupted post-dispatch journal writes without requiring a controller restart', async () => {
    const { service, driver, store, logger } = fixture();
    const plan = await ready(service, commit, ['b']);
    const gate = Promise.withResolvers<void>();
    driver.activateManagedRollout.mockImplementationOnce(() => gate.promise);
    service.start(plan.id);
    await vi.waitFor(() => expect(driver.activateManagedRollout).toHaveBeenCalledTimes(1));
    const unavailable = vi.spyOn(store, 'kvUpdateSync').mockImplementation(() => { throw Error('disk full'); });
    gate.resolve();
    await vi.waitFor(() => expect(service.activeCount()).toBe(0));
    expect(logger.error).toHaveBeenCalled();
    unavailable.mockRestore();
    expect(service.get()?.state).toBe('uncertain');
    expect((await service.reconcile(plan.id)).state).toBe('succeeded');
    expect(driver.activateManagedRollout).toHaveBeenCalledTimes(1);
  });

  it('rechecks completed-before-planning targets and refuses incomplete evidence or stale writers', async () => {
    const { service, driver, proof, store } = fixture();
    driver.inspectManagedRollout.mockImplementation(async t => ({ ...proof(t.host), previous: candidate }));
    const plan = await ready(service, commit, ['a']);
    expect(plan.targets[0]?.state).toBe('current');
    driver.inspectManagedRollout.mockResolvedValueOnce({ ...proof('a'), previous: candidate, selectionRevision: 3 });
    service.start(plan.id);
    await vi.waitFor(() => expect(service.get()?.state).toBe('failed'));
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
    driver.inspectManagedRollout.mockResolvedValueOnce({ ...proof('a'), appsDigest: '' });
    expect((await ready(service, commit, ['a'])).state).toBe('blocked');
    store.kvSetSync('fleet:kernel:v1:index', { latest: plan.id, active: 0 });
    await expect(service.plan(commit)).rejects.toThrow('Corrupt');
    expect(() => service.get()).toThrow('Corrupt');
  });

  it('stops before the next target when the administrator loses authority mid-rollout', async () => {
    const { service, driver } = fixture();
    const plan = await ready(service, commit);
    const revalidate = vi.fn(async () => {}).mockResolvedValueOnce(undefined).mockRejectedValueOnce(Error('Session revoked'));
    service.start(plan.id, revalidate);
    await vi.waitFor(() => expect(service.get()?.state).toBe('failed'));
    expect(driver.activateManagedRollout.mock.calls.map(([target]) => target.host)).toEqual(['a']);
    expect(service.get()?.targets[1]?.reason).toContain('revoked');
  });

  it('does not replay a saved dispatch after PID reuse and requires independent evidence before unblocking', async () => {
    const { service, observer, driver, store } = fixture();
    const plan = await ready(service, commit, ['b']);
    const key = recordKey(plan.id);
    const original = store.kvGetSync<{ rollout: typeof plan }>(key)!;
    original.rollout.state = 'running';
    original.rollout.targets[0]!.state = 'running';
    const writer = { token: 'f7c8e9c4-0d96-4bf9-ab32-42d44d824981', pid: process.pid, started: performance.timeOrigin - 1000, birth: null };
    store.kvSetSync(key, { ...original, writer });
    store.kvSetSync('fleet:kernel:v1:index', { latest: plan.id, active: plan.id });
    expect(observer.get()?.state).toBe('uncertain');
    expect(observer.start(plan.id).state).toBe('uncertain');
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
    await expect(observer.plan(commit)).rejects.toThrow(plan.id);
    driver.reconcileManagedRollout.mockResolvedValueOnce('previous');
    expect((await observer.reconcile(plan.id)).targets[0]?.state).toBe('rolled-back');
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
    store.kvSetSync(key, { ...original, writer: { ...writer, pid: 0 } });
    expect(() => observer.get(plan.id)).toThrow('Corrupt');
  });

  it('never plans or dispatches outside controller authority, including authority lost after review', async () => {
    const { service, driver, authority } = fixture();
    authority.mockImplementationOnce(() => { throw Error('Elected controller has no cross-node fence'); });
    await expect(service.plan(commit)).rejects.toThrow('cross-node fence');
    expect(driver.inspectManagedRollout).not.toHaveBeenCalled();
    const plan = await ready(service, commit);
    authority.mockImplementation(() => { throw Error('Controller is handing off'); });
    expect(() => service.start(plan.id)).toThrow('handing off');
    expect(service.get()?.state).toBe('planned');
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });

  it('exposes reads via the effective policy and revalidates a live administrator and mandatory audit before every dispatch', async () => {
    const { service, driver } = fixture();
    const audit = { record: vi.fn(async () => {}) };
    const auth = { validateSession: vi.fn(async () => ({ id: 'u', role: 'operator' })) };
    const rpc = new NodeManagerRpcService({} as never, audit as never, undefined, auth as never);
    rpc.setKernelRolloutService(service);
    for (const method of ['listKernelBuilds','planKernelRollout','startKernelRollout','reconcileKernelRollout']) {
      expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, NodeManagerRpcService.prototype, method)?.roles).toEqual(['admin']);
    }
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, NodeManagerRpcService.prototype, 'getKernelRollout')?.roles).toEqual(['admin','operator','viewer','service_role']);
    const context = { userId: 'u', roles: ['admin'], metadata: { sessionId: 'session' } } as never;
    await expect(runWithAuth(context, () => rpc.planKernelRollout({ commit }))).rejects.toThrow('required role');
    expect(audit.record).not.toHaveBeenCalled();
    auth.validateSession.mockResolvedValue({ id: 'u', role: 'admin' });
    const plan = await runWithAuth(context, () => rpc.planKernelRollout({ commit }));
    expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ resourceId: plan.id }), true);
    await vi.waitFor(() => expect(service.get(plan.id)?.state).toBe('planned'));
    audit.record.mockRejectedValueOnce(Error('audit unavailable'));
    await expect(runWithAuth(context, () => rpc.startKernelRollout({ id: plan.id }))).rejects.toThrow('audit unavailable');
    expect(driver.activateManagedRollout).not.toHaveBeenCalled();
  });
});
