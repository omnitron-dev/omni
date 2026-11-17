import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
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
    selection: { current: target.artifact, revision: 2 },
    owner: { protocol: 1, ownerBuild: { commit: target.commit, dirty: false },
      status: { owner: { id: 'candidate', pid: 101, startedAt: '2026-11-17T18:00:00Z' }, phase: 'active', inFlight: 0,
        pending: null, controller: { controllerId: 'unclaimed', ownerId: 'candidate', epoch: 1 } }, apps: [], workers: [], watchedApps: [] },
    guardian: { pid: 102, ownerPid: 101, backendPid: 103, operationPending: false, state: 'blocked', reason: 'Cold startup held', at: '' },
    markerPid: 103,
    native: { bootId: boot, units: [{ mainPid: 101, state: 'active' }, { mainPid: 102, state: 'active' }], groups: [[101, 102], []],
      processes: [{ pid: 101, lifetime: ownerLife }, { pid: 102, lifetime: guardianLife }, { pid: 103, lifetime: null }],
      sockets: [], native: { platform: 'darwin', domain: 'gui/501', bootSession: boot.slice(7), processGroups: [101, 102] },
      cohort: [101, 102].map((pid, i) => ({ pid, ppid: 1, pgid: pid, uid: 501, lifetime: i ? guardianLife : ownerLife,
        executable: home + '/runtime/releases/' + target.artifact + '/node' })) },
  } as NativeEmptyRuntimeObservation;
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
