import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ColdControllerEvidence } from '../../src/daemon/runtime-update-cold-controller.js';
import type { RuntimeUpdateActions } from '../../src/daemon/runtime-update.js';
import { readRuntimeUpdateReceipt, runRuntimeUpdate, runtimeUpdatePlanDigest } from '../../src/daemon/runtime-update.js';
import type { RuntimeUpdatePlan } from '../../src/shared/dto/runtime-update.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { certifiedIdleOperationDigest } from '../../src/execution/operation-journal.js';
import { formatDarwinProcessLifetime } from '@omnitron-dev/common/process-identity';
import { captureNativeEmptyRuntime, nativeEmptyRuntimeIdentity, type NativeEmptyRuntimeObservation } from '../../src/daemon/runtime-update-native.js';

const home = '/private/runtime-fixture';
const target = { artifact: 'a'.repeat(64), commit: 'b'.repeat(40) };
const boot = 'darwin:01234567-0000-4000-8000-000000000001';
const ownerLife = formatDarwinProcessLifetime(boot, 'Tue Nov 17 18:00:00 2026');
const guardianLife = formatDarwinProcessLifetime(boot, 'Tue Nov 17 18:00:01 2026');
function observation(): NativeEmptyRuntimeObservation {
  return {
    config: { protocol: 1, instanceHome: home, directory: home + '/execution', scope: 'user', cwd: home,
      environment: { OMNITRON_HOME: home }, owner: { label: 'dev.omnitron.owner', unit: 'omnitron-owner.service', artifact: target.artifact },
      backend: { label: 'dev.omnitron.daemon', unit: 'omnitron-daemon.service', artifact: target.artifact } },
    selection: { protocol: 1, current: target.artifact, previous: null, bootstrap: target.artifact, revision: 2, selectedAt: '2026-11-17T18:00:00Z' },
    owner: { protocol: 1, ownerBuild: { commit: target.commit, dirty: false, builtAt: '2026-11-17T18:00:00Z' },
      status: { owner: { id: 'candidate', pid: 101, startedAt: '2026-11-17T18:00:00Z' }, phase: 'active', inFlight: 0,
        pending: null, controller: { controllerId: 'unclaimed', ownerId: 'candidate', epoch: 1 } }, apps: [], workers: [], watchedApps: [] },
    guardian: { pid: 102, ownerPid: 101, backendPid: 103, operationPending: false, state: 'blocked', reason: 'Cold startup held', at: '' },
    markerPid: 103,
    native: { bootId: boot, units: [{ mainPid: 101, state: 'active' }, { mainPid: 102, state: 'active' }], groups: [[101, 102], []],
      processes: [{ pid: 101, lifetime: ownerLife }, { pid: 102, lifetime: guardianLife }, { pid: 103, lifetime: null }],
      sockets: [], native: { platform: 'darwin', domain: 'gui/501', bootSession: boot.slice(7), processGroups: [101, 102] },
      cohort: [101, 102].map((pid, i) => ({ pid, ppid: 1, pgid: pid, uid: 501, lifetime: i ? guardianLife : ownerLife,
        executable: home + '/runtime/releases/' + target.artifact + '/node' })) },
  };
}

describe('native rollback observation without a serving backend', () => {
  it('records real lifetimes and explicit backend absence, retaining the dead backend PID for shutdown verification', () => {
    const identity = nativeEmptyRuntimeIdentity(home, target, observation());
    expect(identity).toMatchObject({ observation: 'native-empty-owner', backendPid: null, backendCommit: null,
      ownerId: 'candidate', ownerPid: 101, guardianPid: 102, ownerLifetime: ownerLife, guardianLifetime: guardianLife,
      retiredPids: [102, 103], backend: target.artifact, revision: 2 });
  });

  const faults: Array<[string, (value: NativeEmptyRuntimeObservation) => void]> = [
    ['foreign artifact', value => { value.selection.current = 'c'.repeat(64); }],
    ['foreign owner build', value => { value.owner.ownerBuild!.commit = 'c'.repeat(40); }],
    ['dirty owner build', value => { value.owner.ownerBuild!.dirty = true; }],
    ['claimed controller', value => { value.owner.status.controller.controllerId = 'serving'; }],
    ['in-flight owner effect', value => { value.owner.status.inFlight = 1; }],
    ['unsettled owner', value => { value.owner.status.phase = 'uncertain'; }],
    ['application present', value => { value.owner.apps.push({} as never); }],
    ['worker present', value => { value.owner.workers.push({} as never); }],
    ['watcher present', value => { value.owner.watchedApps.push({} as never); }],
    ['guardian mutation', value => { value.guardian.operationPending = true; }],
    ['guardian restarting', value => { value.guardian.state = 'recovering'; }],
    ['foreign native service', value => { value.native.units[0]!.mainPid = 104; }],
    ['live backend', value => { value.native.processes[2]!.lifetime = ownerLife; }],
    ['unknown backend', value => { value.native.processes[2]!.unknown = true; }],
    ['unreported child', value => { value.native.cohort.push({ ...value.native.cohort[0]!, pid: 104, ppid: 102 }); }],
    ['wrong native executable', value => { value.native.cohort[0]!.executable = '/different/node'; }],
    ['unconfirmed owner lifetime', value => { value.native.processes[0]!.lifetime = null; }],
    ['reused marker', value => { value.markerPid = 101; }],
  ];
  it.each(faults)('refuses %s', (_name, mutate) => {
    const value = observation(); mutate(value);
    expect(() => nativeEmptyRuntimeIdentity(home, target, value)).toThrow('Cannot retire');
  });

  it('joins two independent observations and refuses an identity change between them', async () => {
    const first = observation(), next = observation();
    next.selection.revision++;
    let reads = 0;
    await expect(captureNativeEmptyRuntime(home, target, async () => ++reads === 1 ? first : next)).rejects.toThrow('changed');
    expect(reads).toBe(2);
  });

  it('accepts stable identities despite differing guardian diagnostic timestamps', async () => {
    let reads = 0;
    const result = await captureNativeEmptyRuntime(home, target, async () => {
      const value = observation(); value.guardian.at = String(++reads); return value;
    });
    expect(result.backendPid).toBeNull();
    expect(reads).toBe(2);
  });
});


const priorHash = 'c'.repeat(64);
const previousController = '9439c281-db10-4d25-b415-289cf14ba6af';
const controller = '5d1ab8f3-71e6-499d-aacf-b87cfa0bd430';
const ticketId = 'c22ef66f-5fd4-44db-aa61-f09f923eb29d';
function claimed() {
  const value = observation();
  const plan: RuntimeUpdatePlan = { protocol: 1, instance: home, target, before: {
    backend: priorHash, owner: priorHash, guardian: priorHash, ownerId: 'prior-owner', ownerPid: 201, guardianPid: 202,
    backendPid: 203, retiredPids: [202,203], backendCommit: 'd'.repeat(40), ownerCommit: 'd'.repeat(40),
    scope: 'user', ownerLifetime: ownerLife, revision: 1, console: null, consoleCommit: null },
    configuration: { basis: 'retained-next-start', sha256: '1'.repeat(64) }, backupOperations: [], stacks: [], excluded: [], watches: [],
    infrastructure: { schemaScope: 'all', digest: '4'.repeat(64), containers: [], database: null } };
  value.selection.previous = priorHash;
  const status = value.owner.status, ownerId = status.owner.id;
  status.controller = { ownerId, controllerId: controller, epoch: 9 };
  status.pending = { id: ticketId, ownerId, from: { ownerId, controllerId: 'unclaimed', epoch: 8 }, to: { ...status.controller } };
  Object.assign(value.owner, { inventoryDigest: createHash('sha256').update('{"apps":[],"workers":[]}').digest('hex'),
    lastEvent: 0, acknowledgedEvent: 0, droppedEvents: 0, events: [], devMode: false, watchEnabled: false });
  value.native.processes.push(...[201,202,203].map(pid => ({ pid, lifetime: null })));
  value.markerPid = null;
  const startup = 'Controller startup has not published a recovery snapshot';
  const certifiedAt = '2026-11-17T17:59:59Z';
  const evidence: ColdControllerEvidence = {
    authority: { protocol: 1, owner: structuredClone(status.owner), grant: structuredClone(status.controller) },
    retained: { ownerId: plan.before.ownerId, registryDigest: '5'.repeat(64), inventoryDigest: '6'.repeat(64), stacks: 0 },
    catalogue: { registryDigest: '5'.repeat(64), lifecycleDigest: '7'.repeat(64), operationDigest: '8'.repeat(64) },
    journal: { status: 'invalid', at: '2026-11-17T18:00:01Z', reason: startup, reasons: [startup,
      'execution.configureReadiness', 'execution.setDevMode', 'execution.setWatchMode'], previousCertifiedAt: certifiedAt,
      previous: { protocol: 1, createdAt: certifiedAt, previousPid: 203,
        previousEntry: path.join(home, 'runtime/releases', priorHash, 'packages/0/dist/daemon/daemon-entry.js'),
        cwd: home, environment: {}, daemonConfig: { executionHost: { enabled: true, directory: value.config.directory } } as never,
        controller: { ownerId: plan.before.ownerId, controllerId: previousController, epoch: 7 },
        registryDigest: '5'.repeat(64), runtimeHash: priorHash,
        state: { protocol: 1, executionInventory: '6'.repeat(64), infrastructure: null, watchConfig: { apps: [] } as never,
          projects: { infrastructure: [], projects: [], stacks: [], resumeBackoff: [], reconciling: false } } } },
  };
  value.startupEvidence = evidence;
  return { value, plan, evidence };
}

describe('retirement of the first cold controller', () => {
  it('retains exact evidence after two observations of the committed first grant and dead backend', async () => {
    const { value, plan } = claimed();
    const result = await captureNativeEmptyRuntime(home, target, async () => structuredClone(value), plan);
    expect(result.startupEvidence).toMatch(/^[0-9a-f]{64}$/);
    expect(result.retiredPids).toEqual([102,103]);
    expect(result.backendPid).toBeNull();
  });
  type Scenario = ReturnType<typeof claimed>;
  const refusals: Array<[string, (s: Scenario) => void]> = [
    ['unreviewed stack', s => { s.plan.stacks.push({} as never); }], ['reviewed watch', s => { s.plan.watches.push({} as never); }],
    ['backup operation', s => { s.plan.backupOperations.push({} as never); }], ['app', s => { s.value.owner.apps.push({} as never); }],
    ['worker', s => { s.value.owner.workers.push({} as never); }], ['active call', s => { s.value.owner.status.inFlight = 1; }],
    ['lost history', s => { s.value.owner.droppedEvents = 1; }], ['application event', s => { s.value.owner.lastEvent = 1; }],
    ['uncommitted handoff', s => { s.value.owner.status.phase = 'prepared'; }], ['second handoff', s => { s.value.owner.status.pending!.from.controllerId = controller; }],
    ['unrelated controller', s => { s.evidence.authority.grant.controllerId = previousController; }],
    ['missing epoch', s => { s.evidence.journal.previous!.controller.epoch--; }],
    ['other catalogue', s => { s.evidence.catalogue.registryDigest = priorHash; }],
    ['different previous PID', s => { s.evidence.journal.previous!.previousPid++; }],
    ['changed selection', s => { s.value.selection.revision++; }], ['mismatched boot', s => { s.value.native.bootId = 'darwin:other'; }],
    ['lifetime unknown', s => { s.value.native.processes[0]!.unknown = true; }],
    ['backend alive', s => { s.value.native.processes[2]!.lifetime = ownerLife; }],
    ['previous backend alive', s => { s.value.native.processes.at(-1)!.lifetime = ownerLife; }],
    ['guardian mutation', s => { s.value.guardian.operationPending = true; }],
    ['different backend marker', s => { s.value.markerPid = 204; }],
    ['another controller socket', s => { s.value.native.sockets.push(s.value.config.directory + '/c-other.sock'); }],
    ['extra invalidation', s => { s.evidence.journal.reasons!.push('project mutation'); }],
    ['missing invalidation', s => { s.evidence.journal.reasons!.pop(); }],
    ['first-reason-only journal', s => { delete s.evidence.journal.reasons; }],
    ['truncated journal', s => { s.evidence.journal.additionalReasons = true; }],
    ['missing certificate', s => { delete s.evidence.journal.previous; }],
    ['incomplete previous context', s => { s.evidence.journal.previous!.environment = undefined as never; }],
  ];
  it.each(refusals)('refuses %s', (_name, alter) => {
    const scenario = claimed(); alter(scenario);
    expect(() => nativeEmptyRuntimeIdentity(home, target, scenario.value, scenario.plan)).toThrow();
  });
  it('rejects a change of persisted evidence between observations', async () => {
    const { value, plan } = claimed();
    let reads = 0;
    await expect(captureNativeEmptyRuntime(home, target, async () => {
      if (++reads === 2) value.startupEvidence!.catalogue.operationDigest = '9'.repeat(64);
      return value;
    }, plan)).rejects.toThrow('changed');
  });
  it('persists the evidence before the final check and never captures a replacement after refusal', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cold-receipt-'));
    const { value, plan } = claimed();
    const live = nativeEmptyRuntimeIdentity(home, target, value, plan), digest = runtimeUpdatePlanDigest(plan);
    let captured = 0, validated = 0, stopped = 0;
    const actions = { async validateRestore() {}, async canRestore() { return false; },
      async captureForRollback() { captured++; return live; },
      async validateStop(identity: typeof live, _before: unknown, rollback: RuntimeUpdatePlan) {
        expect(rollback).toEqual(plan);
        expect((await readRuntimeUpdateReceipt(directory))?.rollbackOwner).toEqual(identity);
        validated++; throw Error('Evidence changed before shutdown');
      },
      async stop() { stopped++; },
    } as unknown as RuntimeUpdateActions;
    try {
      await writePrivateRecord(path.join(directory, 'current.json'), { protocol: 1, digest, plan, phase: 'recovery-required', updatedAt: new Date().toISOString() });
      for (let i = 0; i < 2; i++)
        await expect(runRuntimeUpdate({ actions, directory, operation: 'recover', digest })).rejects.toThrow('Evidence changed');
      expect({ captured, validated, stopped }).toEqual({ captured: 1, validated: 2, stopped: 0 });
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  });
});

it('admits only historical reviewed uncertainty with its exact surviving ledger and restore fence', () => {
  const id = ticketId, at = '2026-11-16T01:00:00Z';
  const receipt = { protocol: 1, id, kind: 'backup', resources: [{ kind: 'database', name: 'main' }], inputDigest: '1'.repeat(64),
    revision: 3, state: 'unknown', createdAt: at, updatedAt: at,
    review: { decision: 'allow-new-backup', reviewedRevision: 2, actor: 'operator', reason: 'retain uncertainty', at } };
  const ledger = (record: object, reviewed: string[] = [id], claims: object = {}) => [
    { key: 'execution.operation.' + id, value: JSON.stringify(record) },
    { key: 'execution.operation.active', value: JSON.stringify({ protocol: 2, claims }) },
    { key: 'execution.operation.reviewed-backups', value: JSON.stringify(reviewed) }];
  const inspect = (rows: ReturnType<typeof ledger>) => certifiedIdleOperationDigest(rows, '2026-11-17T00:00:00Z');
  expect(inspect(ledger(receipt))).toMatch(/^[a-f0-9]{64}$/);
  expect(() => inspect(ledger(receipt, []))).toThrow();
  expect(() => inspect(ledger(receipt, [id], { active: id }))).toThrow();
  expect(() => inspect(ledger({ ...receipt, review: undefined }))).toThrow();
  expect(() => inspect(ledger({ ...receipt, state: 'running', review: undefined }, []))).toThrow();
  expect(() => inspect(ledger({ ...receipt, state: 'succeeded', review: undefined, updatedAt: '2026-11-18T01:00:00Z' }, []))).toThrow();
});
