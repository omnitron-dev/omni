import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { compareProcessLifetimes } from '@omnitron-dev/common/process-identity';
import { coldControllerEvidenceDigest, readColdControllerEvidence, type ColdControllerEvidence } from './runtime-update-cold-controller.js';
import { RuntimeInstallation, type RuntimeSelection } from './runtime-installation.js';
import { readManagedRuntime, managedSupervisorSocket, hostBootIdentity, type ManagedRuntime } from './managed-runtime.js';
import { readDarwinOwnerEvidence } from './darwin-owner-evidence.js';
import { privateControlClient } from './private-control-client.js';
import { DEFAULT_DAEMON_CONFIG } from '../config/defaults.js';
import { expandPath } from '../shared/paths.js';
import { readSavedDaemonConfig, savedDaemonOverrides } from '../config/saved.js';
import type { ExecutionHostService, ExecutionSnapshot } from './execution-host.js';
import { EXECUTION_INVENTORY } from '../orchestrator/execution-contract.js';
import type { BackendSupervisorService, SupervisorStatus } from './backend-supervisor.js';
import type { NativeEmptyRuntimeIdentity, RuntimeUpdatePlan, RuntimeUpdateReference } from '../shared/dto/runtime-update.js';

export interface NativeEmptyRuntimeObservation {
  config: ManagedRuntime;
  selection: RuntimeSelection;
  owner: Pick<ExecutionSnapshot, 'protocol' | 'ownerBuild' | 'status' | 'apps' | 'workers' | 'watchedApps'> &
    Partial<Pick<ExecutionSnapshot, 'inventoryDigest' | 'lastEvent' | 'events' | 'acknowledgedEvent' | 'droppedEvents' | 'devMode' | 'watchEnabled'>>;
  startupEvidence?: ColdControllerEvidence;
  guardian: SupervisorStatus;
  native: Awaited<ReturnType<typeof readDarwinOwnerEvidence>>;
  markerPid: number | null;
}

/** An unavailable public API is not evidence. Native retirement requires an empty owner
 * and proof of either an unclaimed grant or the reviewed failed first controller. */
export function nativeEmptyRuntimeIdentity(home: string, target: RuntimeUpdateReference, observation: NativeEmptyRuntimeObservation, plan?: RuntimeUpdatePlan): NativeEmptyRuntimeIdentity {
  const { config, selection, owner, guardian, native, markerPid } = observation;
  const fail = (message: string): never => { throw Error('Cannot retire an unavailable backend: ' + message); };
  if (config.instanceHome !== home || config.scope !== 'user' || config.owner.label !== 'dev.omnitron.owner' ||
      config.backend.label !== 'dev.omnitron.daemon' || config.owner.artifact !== target.artifact || config.backend.artifact !== target.artifact ||
      selection.current !== target.artifact || !Number.isSafeInteger(selection.revision) || selection.revision < 1)
    fail('native roles or selected artifact differ from the reviewed candidate');
  const status = owner.status;
  if (owner.protocol !== 1 || !status?.owner?.id || status.phase !== 'active' || status.inFlight !== 0 ||
      !status.controller || status.controller.ownerId !== status.owner.id ||
      !Array.isArray(owner.apps) || owner.apps.length || !Array.isArray(owner.workers) || owner.workers.length ||
      !Array.isArray(owner.watchedApps) || owner.watchedApps.length)
    fail('the owner is not empty and idle');
  const claimed = status.controller.controllerId !== 'unclaimed';
  if (!claimed && status.pending !== null) fail('an unclaimed owner has a pending handoff');
  const startupEvidence = claimed ? coldControllerEvidenceDigest(home, plan, observation) : undefined;
  if (owner.ownerBuild?.commit !== target.commit || owner.ownerBuild.dirty !== false)
    fail('the private owner build differs from the reviewed candidate');
  const ownerPid = status.owner.pid, guardianPid = guardian.pid;
  if (![ownerPid, guardianPid].every(pid => Number.isSafeInteger(pid) && pid > 0) || ownerPid === guardianPid ||
      guardian.ownerPid !== ownerPid || guardian.state !== 'blocked' || guardian.operationPending !== false || guardian.persistenceError)
    fail('the guardian has not settled without a backend');
  if (native.units.length !== 2 || native.units[0]?.mainPid !== ownerPid || native.units[1]?.mainPid !== guardianPid ||
      native.units.some(unit => unit.state !== 'active')) fail('OS service identities differ from private control');
  const node = path.join(home, 'runtime/releases', target.artifact, 'node');
  if (native.cohort.length !== 2 || native.cohort.some(row => ![ownerPid, guardianPid].includes(row.pid) || row.executable !== node))
    fail('a backend, application or foreign process remains in the native cohort');
  const lifetime = (pid: number) => {
    const row = native.processes.find(item => item.pid === pid);
    if (!row || row.unknown || !row.lifetime || compareProcessLifetimes(row.lifetime, row.lifetime) !== 'same')
      return fail('a native process lifetime is unconfirmed');
    return row.lifetime;
  };
  const retired = [guardianPid];
  for (const pid of [markerPid, guardian.backendPid]) {
    if (pid === null) continue;
    if (!Number.isSafeInteger(pid) || pid < 1 || pid === ownerPid || pid === guardianPid) fail('invalid backend process evidence');
    const observed = native.processes.find(item => item.pid === pid);
    if (!observed || observed.unknown || observed.lifetime !== null) fail('a recorded backend has not been proven absent');
    retired.push(pid);
  }
  return { observation: 'native-empty-owner', ...(startupEvidence && { startupEvidence }), backend: target.artifact, owner: target.artifact, guardian: target.artifact,
    backendCommit: null, ownerCommit: owner.ownerBuild!.commit, scope: config.scope,
    ownerId: status.owner.id, ownerPid, ownerLifetime: lifetime(ownerPid), guardianPid, guardianLifetime: lifetime(guardianPid),
    backendPid: null, revision: selection.revision, retiredPids: [...new Set(retired)].sort((a, b) => a - b), native: native.native };
}

async function observe(home: string, plan?: RuntimeUpdatePlan): Promise<NativeEmptyRuntimeObservation> {
  if (process.platform !== 'darwin') throw Error('Native empty-owner rollback requires macOS service evidence');
  const config = await readManagedRuntime(home);
  if (!config) throw Error('Native runtime configuration is unavailable');
  const registry = await RuntimeInstallation.openReadOnly(home);
  if (!registry) throw Error('Native runtime selection is unavailable');
  try {
    const selection = registry.settledSelection();
    const guardian = await privateControlClient<BackendSupervisorService>(managedSupervisorSocket(config), 'OmnitronSupervisor', 5000);
    try {
      const owner = await privateControlClient<ExecutionHostService>(path.join(config.directory, 'owner.sock'), 'OmnitronExecution', 5000);
      try {
        const [ownerState, guardianState] = await Promise.all([owner.service.snapshot(EXECUTION_INVENTORY), guardian.service.status()]);
        const dc = { ...DEFAULT_DAEMON_CONFIG, ...savedDaemonOverrides(readSavedDaemonConfig()) };
        const marker = await fs.readFile(expandPath(dc.pidFile), 'utf8').catch(error => {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        });
        const first = marker?.split('\n')[0];
        if (first !== undefined && !/^[1-9]\d*$/.test(first)) throw Error('Invalid backend PID marker');
        const markerPid = first === undefined ? null : Number(first);
        const claimed = ownerState.status.controller?.controllerId !== 'unclaimed';
        const startupEvidence = claimed && plan ? await readColdControllerEvidence(home, config.directory, plan) : undefined;
        const old = claimed && plan ? [plan.before.ownerPid, plan.before.guardianPid, plan.before.backendPid] : [];
        const pids = [...old, ownerState.status.owner.pid, guardianState.pid, markerPid, guardianState.backendPid].filter((pid): pid is number => pid !== null);
        const native = await readDarwinOwnerEvidence(config, [...new Set(pids)].map(pid => ({ pid })), await hostBootIdentity());
        if (!isDeepStrictEqual(selection, registry.settledSelection()) || !isDeepStrictEqual(config, await readManagedRuntime(home)))
          throw Error('Native runtime bindings changed during observation');
        return { config, selection, owner: ownerState, guardian: guardianState, native, markerPid, ...(startupEvidence && { startupEvidence }) };
      } finally { await owner.close(); }
    } finally { await guardian.close(); }
  } finally { await registry.close(); }
}

/** Repeat all independent observations; revisions and RPC timestamps are not identities. */
export async function captureNativeEmptyRuntime(home: string, target: RuntimeUpdateReference,
  reader?: () => Promise<NativeEmptyRuntimeObservation>, plan?: RuntimeUpdatePlan): Promise<NativeEmptyRuntimeIdentity> {
  const read = reader ?? (() => observe(home, plan));
  const first = nativeEmptyRuntimeIdentity(home, target, await read(), plan);
  const last = nativeEmptyRuntimeIdentity(home, target, await read(), plan);
  if (!isDeepStrictEqual(first, last)) throw Error('Native candidate changed during rollback observation');
  return last;
}
