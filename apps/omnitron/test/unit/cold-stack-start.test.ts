import 'reflect-metadata';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { RuntimeInstallation } from '../../src/daemon/runtime-installation.js';
import * as manager from '../../src/daemon/managed-runtime.js';
import * as identity from '@omnitron-dev/common/process-identity';
import { ExecutionJournal, writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { claimColdStart, readColdBatch, reviewedColdStart } from '../../src/project/cold-stack-start.js';
import { ProjectService } from '../../src/services/project.service.js';

const sha = (c: string) => c.repeat(64);
const scope = { project: 'runtime-tenant', stack: 'dev' };
const publicScope = { project: 'example', stack: 'test' };
const old = { ownerId: 'retired', ownerPid: 42, ownerLifetime: '01234567-0000-0000-0000-000000000001:1234', revision: 8,
  backend: sha('a'), owner: sha('b') };
const owner = { ownerId: 'next-owner', ownerPid: 84, ownerLifetime: '01234567-0000-0000-0000-000000000001:9123' };
let home: string, file: string, store: DaemonStateStore;
const review = sha('c');
function makePlan() {
  return { protocol: 1, stackAdmissionProtocol: 1, instance: home, target: { artifact: sha('d') }, before: old,
    infrastructure: { database: sha('f') },
    stacks: [{ ...publicScope, runtimeScope: scope, path: home, enabled: true, startReview: review }],
    excluded: [{ project: 'example', stack: 'remote', reason: 'remote' }, { project: 'example', stack: 'archive', reason: 'disabled' }] };
}
const planHash = (plan: unknown) => createHash('sha256').update(JSON.stringify(plan)).digest('hex');
async function save(phase: string, plan = makePlan(), digest = planHash(plan)) {
  await writePrivateRecord(file, { protocol: 1, digest, phase, plan });
}
async function batch() {
  const value = await readColdBatch(home);
  if (!value) throw Error('Fixture did not record held batch');
  return value;
}
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'omnitron-cold-start-'));
  file = path.join(home, 'runtime/local-updates/current.json');
  await mkdir(path.join(home, 'data'), { mode: 0o700 });
  store = new DaemonStateStore(createNullLogger(), path.join(home, 'data/daemon-state.db'));
});
afterEach(async () => { await store.dispose(); await rm(home, { recursive: true, force: true }); vi.restoreAllMocks(); });
const registered = () => ({ path: home, registeredAt: '2026-11-13T12:00:00Z', enabledStacks: ['dev', 'remote'] });

describe('one local cold admission', () => {
  it('uses the existing sealed receipt, rejects changed bytes, wrong instance, malformed authority and an unsafe private record', async () => {
    expect(await readColdBatch(home)).toBeNull();
    const plan = makePlan();
    await save('starting', plan, sha('1'));
    await expect(readColdBatch(home)).rejects.toThrow('Unverified');
    await save('starting', { ...plan, instance: home + '/elsewhere' });
    await expect(readColdBatch(home)).rejects.toThrow('Unverified');
    await save('starting', { ...plan, before: { ...old, ownerLifetime: 'unknown' } });
    await expect(readColdBatch(home)).rejects.toThrow('authority');
    await save('starting', { ...plan, stacks: [...plan.stacks, ...plan.stacks] });
    await expect(readColdBatch(home)).rejects.toThrow('Ambiguous');
    await save('accepted');
    expect(await readColdBatch(home)).toBeNull();
    await save('starting');
    await chmod(file, 0o644);
    await expect(readColdBatch(home)).rejects.toThrow('private');
  });

  it('consumes the real SQLite intent exactly once per direction despite duplicate requests or a replacement owner', async () => {
    await save('verifying');
    let state = await batch();
    const observe = vi.fn(async () => owner);
    const start = await reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope, observe);
    expect(start?.review).toBe(review);
    claimColdStart(store, start!);
    expect(() => claimColdStart(store, { ...start!, ownerId: 'crashed-owner-replacement' })).toThrow('already attempted');
    expect(store.kvGetSync('lifecycle:infrastructure:runtime-tenant/dev:2026-11-13T12:00:00Z')).toBeNull();
    await save('restoring'); state = await batch();
    expect(state.artifact).toBe(old.backend); expect(state.ownerArtifact).toBe(old.owner);
    const back = await reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope, observe);
    claimColdStart(store, back!);
    expect(() => claimColdStart(store, back!)).toThrow('already attempted');
    await save('rolled-back'); expect(await readColdBatch(home)).toBeNull();
    expect(store.kvGetSync('lifecycle:infrastructure:runtime-tenant/dev:2026-11-13T12:00:00Z')).toBeNull();
  });

  it('uses the fixed controller with the old owner for retained rollback and still requires a new native owner lifetime', async () => {
    const plan = { ...makePlan(), configuration: { sha256: sha('e'), basis: 'retained-next-start' } };
    await save('restoring', plan);
    const state = await batch();
    expect(state).toMatchObject({ direction: 'previous', artifact: plan.target.artifact, ownerArtifact: old.owner, configuration: sha('e') });
    await expect(reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope)).rejects.toThrow('Serving runtime');
    const permit = await reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope, async () => owner);
    claimColdStart(store, permit!);
    expect(() => claimColdStart(store, permit!)).toThrow('already attempted');
    const invalid = { ...plan, configuration: { sha256: sha('e'), basis: 'source-fallback' } };
    await save('restoring', invalid);
    await expect(readColdBatch(home)).rejects.toThrow('authority');
  });

  it('refuses a new owner without physical proof and prevents unrelated, disabled, unmapped and changed local scopes', async () => {
    await save('starting');
    const facts = await batch(), entry = registered(), probe = vi.fn(async () => { throw Error('unit mismatch'); });
    await expect(reviewedColdStart(home, facts, scope, entry, 'local', true, publicScope)).rejects.toThrow('Serving runtime');
    await expect(reviewedColdStart(home, facts, scope, entry, 'local', true, publicScope, probe)).rejects.toThrow('unit mismatch');
    for (const [key, registration, kind, automatic, logical] of [
      [scope, { ...entry, enabledStacks: [] }, 'local', true, publicScope],
      [scope, entry, 'local', false, publicScope],
      [scope, { ...entry, path: '/different' }, 'local', true, publicScope],
      [scope, entry, 'local', true, { project: 'other', stack: 'test' }],
      [scope, entry, 'remote', true, publicScope],
    ] as const) await expect(reviewedColdStart(home, facts, key, registration, kind, automatic, logical, probe)).rejects.toThrow();
    expect(probe).toHaveBeenCalledTimes(1);
    const remote = { project: 'example', stack: 'remote' };
    expect(await reviewedColdStart(home, facts, remote, entry, 'remote', true, remote, probe)).toBeNull();
    await save('failed');
    await expect(reviewedColdStart(home, await batch(), scope, entry, 'local', true, publicScope, probe)).rejects.toThrow('held');
  });

  it('checks the selected backend and the OS owner service before binding the actual process lifetime', async () => {
    await save('starting');
    const state = await batch();
    const installed = path.join(home, 'runtime/releases', state.artifact, 'node');
    const original = Object.getOwnPropertyDescriptor(process, 'execPath')!;
    try {
      Object.defineProperty(process, 'execPath', { ...original, value: installed });
      vi.spyOn(manager, 'readManagedRuntime').mockResolvedValue({ owner: { artifact: state.ownerArtifact }, directory: home } as any);
      const installation = { startupSelection: () => ({ current: state.artifact, revision: 9 }), close: vi.fn(async () => {}) };
      vi.spyOn(RuntimeInstallation, 'openReadOnly').mockResolvedValue(installation as any);
      const record = vi.spyOn(ExecutionJournal.prototype, 'read').mockResolvedValue({ owner: { id: owner.ownerId, pid: owner.ownerPid } } as any);
      const native = vi.spyOn(manager, 'verifyManagedIsolation').mockResolvedValue();
      const birth = vi.spyOn(identity, 'readProcessLifetime').mockReturnValue({ state: 'alive', identity: owner.ownerLifetime });
      const permit = await reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope);
      expect(permit).toMatchObject(owner);
      expect(native).toHaveBeenCalledTimes(1); expect(installation.close).toHaveBeenCalledTimes(1);
      birth.mockReturnValue({ state: 'unknown' });
      await expect(reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope)).rejects.toThrow('lifetime');
      birth.mockReturnValue({ state: 'alive', identity: owner.ownerLifetime });
      await writePrivateRecord(file, { protocol: 1, digest: planHash(makePlan()), plan: makePlan(), phase: 'restoring', rollbackOwner: owner });
      const recovering = await batch();
      Object.defineProperty(process, 'execPath', { ...original, value: path.join(home, 'runtime/releases', recovering.artifact, 'node') });
      vi.mocked(manager.readManagedRuntime).mockResolvedValue({ owner: { artifact: recovering.ownerArtifact }, directory: home } as any);
      installation.startupSelection = () => ({ current: recovering.artifact, revision: 10 });
      await expect(reviewedColdStart(home, recovering, scope, registered(), 'local', true, publicScope)).rejects.toThrow('old owner');
      Object.defineProperty(process, 'execPath', { ...original, value: installed });
      vi.mocked(manager.readManagedRuntime).mockResolvedValue({ owner: { artifact: state.ownerArtifact }, directory: home } as any);
      installation.startupSelection = () => ({ current: state.artifact, revision: 9 });
      record.mockResolvedValue({ owner: { id: old.ownerId, pid: old.ownerPid } } as any);
      await expect(reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope)).rejects.toThrow('old owner');
      installation.startupSelection = () => ({ current: state.artifact, revision: 2 });
      await expect(reviewedColdStart(home, state, scope, registered(), 'local', true, publicScope)).rejects.toThrow('selector');
    } finally { Object.defineProperty(process, 'execPath', original); }
  });

  it('prevents an ordinary CLI/RPC stack start or stop from widening the reviewed local scope before the first effect', async () => {
    await save('starting');
    const service: any = Object.assign(Object.create(ProjectService.prototype), {
      daemonStateStore: store, registry: { get: registered }, stopsInFlight: new Map(), startsInFlight: new Map(),
      getLoadedConfig: () => ({ stacks: { dev: { type: 'local' } } }),
      resolveStacks: (input: any) => input.stacks, startStackOnce: vi.fn(), stopStackOnce: vi.fn(),
    });
    await expect(service.startStack(scope.project, scope.stack, { source: 'operator', infrastructure: 'reconcile' })).rejects.toThrow('held');
    await expect(service.stopStack(scope.project, scope.stack)).rejects.toThrow('held');
    expect(service.startStackOnce).not.toHaveBeenCalled(); expect(service.stopStackOnce).not.toHaveBeenCalled();
  });
});
