import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it, vi } from 'vitest';
import { assertRuntimeConsoleStartup } from '../../src/daemon/runtime-update-host.js';
import { RuntimeObservationPending, RuntimeObservationUnconfirmed, observeRuntimeUntil } from '../../src/daemon/runtime-observation.js';
import { readRuntimeUpdateReceipt, runRuntimeUpdate, runtimeUpdatePlanDigest } from '../../src/daemon/runtime-update.js';
import type { RuntimeUpdateActions } from '../../src/daemon/runtime-update.js';
import type { RuntimeUpdatePlan, RuntimeUpdateStatusObservation } from '../../src/shared/dto/runtime-update.js';
import type { BackendRuntimeStatus } from '../../src/shared/dto/backend.js';

const homes: string[] = [];
afterEach(async () => { for (const home of homes.splice(0)) await fs.rm(home, { recursive: true, force: true }); });

function planFor(instance = '/isolated-fixture'): RuntimeUpdatePlan {
  return { protocol: 1, instance, stackAdmissionProtocol: 1, backupOperations: [],
    target: { artifact: 'b'.repeat(64), commit: 'b'.repeat(40) },
    before: { backend: 'a'.repeat(64), owner: 'a'.repeat(64), guardian: 'a'.repeat(64), backendCommit: 'a'.repeat(40), ownerCommit: 'a'.repeat(40),
      console: 'c'.repeat(64), consoleCommit: 'c'.repeat(40), scope: 'user', ownerId: 'previous', ownerPid: 1, guardianPid: 2,
      backendPid: 3, ownerLifetime: 'fixture', revision: 1, retiredPids: [] },
    stacks: [], excluded: [], watches: [], infrastructure: { schemaScope: 'node', digest: 'd'.repeat(64), containers: [], database: null } };
}

function statusFor(plan: RuntimeUpdatePlan, direction: 'target' | 'previous', state: 'pending' | 'ready' | 'unconfirmed'): RuntimeUpdateStatusObservation {
  return { pid: 100, execution: { recovery: { status: 'ready', at: new Date(0).toISOString(), reason: null },
    consoleStartup: { state, required: true, review: { digest: runtimeUpdatePlanDigest(plan), direction },
      reason: state === 'unconfirmed' ? 'Console publication reply lost' : null } } as BackendRuntimeStatus,
    apps: [], appsTotal: 0, appsOnline: 0 };
}

it.each(['target', 'previous'] as const)('distinguishes recovery readiness from Console acceptance during %s', direction => {
  const plan = planFor();
  expect(() => assertRuntimeConsoleStartup(statusFor(plan, direction, 'ready'), plan, direction)).not.toThrow();
  expect(() => assertRuntimeConsoleStartup(statusFor(plan, direction, 'pending'), plan, direction)).toThrow(RuntimeObservationPending);
  expect(() => assertRuntimeConsoleStartup(statusFor(plan, direction, 'unconfirmed'), plan, direction)).toThrow(RuntimeObservationUnconfirmed);
});

it.each(['digest', 'direction'] as const)('refuses a ready startup from a different %s without declaring a known native failure', changed => {
  const plan = planFor(), status = statusFor(plan, 'target', 'ready');
  if (changed === 'digest') status.execution!.consoleStartup!.review!.digest = 'f'.repeat(64);
  else status.execution!.consoleStartup!.review!.direction = 'previous';
  expect(() => assertRuntimeConsoleStartup(status, plan, 'target')).toThrow(RuntimeObservationUnconfirmed);
});

it('does not retry an unconfirmed Console or erase the original reason', async () => {
  const plan = planFor(), read = vi.fn(async () => assertRuntimeConsoleStartup(statusFor(plan, 'target', 'unconfirmed'), plan, 'target'));
  await expect(observeRuntimeUntil(read, 1000, 'Console acceptance', 1)).rejects.toThrow('Console publication reply lost');
  expect(read).toHaveBeenCalledOnce();
});

it('allows an older status to proceed to the mandatory independent native Console verification', () => {
  const plan = planFor(), status = statusFor(plan, 'target', 'ready');
  delete status.execution!.consoleStartup;
  expect(() => assertRuntimeConsoleStartup(status, plan, 'target')).not.toThrow();
});

it('keeps an uncertain candidate available and restores only through an explicit exact-digest recovery', async () => {
  const instance = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'console-recovery-'))); homes.push(instance);
  const directory = path.join(instance, 'runtime/local-updates'), plan = planFor(instance);
  const accepted = { backend: plan.before.backend, owner: plan.before.owner, guardian: plan.before.guardian, ownerId: 'restored',
    console: { artifact: plan.before.console, commit: plan.before.consoleCommit }, stacks: [], watches: [] };
  const candidate = { ...plan.before, backend: plan.target.artifact, owner: plan.target.artifact, guardian: plan.target.artifact,
    ownerId: 'candidate', ownerPid: 10, guardianPid: 20, backendPid: 30 };
  let serving: 'target' | 'previous' = 'target';
  const effects: string[] = [];
  const actions: RuntimeUpdateActions = {
    prepare: async () => plan, prepareConsole: async () => { throw Error('Unexpected Console allocation for a legacy plan'); },
    admit: async () => {}, releaseAdmission: async () => {},
    validateStop: vi.fn(async () => {}),
    withRollbackAdmission: async (_review, identity, stop) => { expect(identity).toEqual(candidate); return stop(); },
    stop: vi.fn(async identity => { effects.push('stop:' + identity.ownerId); }), assertStopped: async () => {},
    start: vi.fn(async destination => { serving = 'artifact' in destination ? 'target' : 'previous'; effects.push('start:' + serving); }),
    canRestore: vi.fn(async () => false), validateRestore: vi.fn(async () => {}),
    captureForRollback: vi.fn(async () => candidate),
    accept: vi.fn(async (_review, direction) => {
      expect(direction).toBe(serving);
      assertRuntimeConsoleStartup(statusFor(plan, direction, direction === 'target' ? 'unconfirmed' : 'ready'), plan, direction);
      return accepted;
    }),
  };
  const review = await runRuntimeUpdate({ actions, directory, operation: 'prepare' });
  await expect(runRuntimeUpdate({ actions, directory, operation: 'apply', digest: review.digest })).rejects.toThrow(RuntimeObservationUnconfirmed);
  expect(await readRuntimeUpdateReceipt(directory)).toMatchObject({ phase: 'recovery-required', error: 'Console startup is unconfirmed: Console publication reply lost' });
  expect(effects).toEqual(['stop:previous', 'start:target']);
  expect(actions.canRestore).not.toHaveBeenCalled();
  expect(actions.captureForRollback).not.toHaveBeenCalled();
  await expect(runRuntimeUpdate({ actions, directory, operation: 'reconcile', digest: review.digest })).rejects.toThrow(RuntimeObservationUnconfirmed);
  expect(effects).toEqual(['stop:previous', 'start:target']);
  const restored = await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: review.digest });
  expect(restored).toMatchObject({ phase: 'rolled-back', acceptance: accepted, restoreAttempted: true, rollbackOwner: candidate });
  expect(actions.captureForRollback).toHaveBeenCalledExactlyOnceWith(plan);
  expect(effects).toEqual(['stop:previous', 'start:target', 'stop:candidate', 'start:previous']);
  expect(await runRuntimeUpdate({ actions, directory, operation: 'recover', digest: review.digest })).toEqual(restored);
  expect(effects).toHaveLength(4);
});
