import type { ProcessInfoDto } from '../config/types.js';
import type { RuntimeUpdateStatusObservation } from '../shared/dto/runtime-update.js';
import type { ExecutionSnapshot } from './execution-host.js';
import { observeRuntimeUntil, RuntimeObservationConflict, RuntimeObservationPending, RuntimeObservationUnconfirmed } from './runtime-observation.js';

const validPid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
function unsettled(reason: string): never { throw new RuntimeObservationPending('applications', reason); }

function assertProcessOwner(snapshot: ExecutionSnapshot, publicStatus?: RuntimeUpdateStatusObservation): void {
  const actual = snapshot.status;
  if (snapshot.protocol !== 1 || !Array.isArray(snapshot.apps) || !Array.isArray(snapshot.workers) ||
      !validPid(actual?.owner?.pid) || !Number.isSafeInteger(actual.controller?.epoch) ||
      !Number.isSafeInteger(actual.inFlight) || actual.inFlight < 0 || !/^[a-f0-9]{64}$/.test(snapshot.inventoryDigest))
    throw Error('Invalid native process inventory');
  if (publicStatus) {
    const reported = publicStatus.execution;
    if (!reported?.owner || reported.owner.id !== actual.owner.id || reported.owner.pid !== actual.owner.pid ||
        reported.owner.startedAt !== actual.owner.startedAt || actual.controller.ownerId !== actual.owner.id ||
        actual.controller.epoch !== reported.epoch || !actual.controller.controllerId ||
        actual.controller.controllerId === 'unclaimed' || actual.phase !== 'active')
      throw new RuntimeObservationConflict('Execution owner or controller changed during native process observation');
  }
}

export const PROCESS_REVIEW_WAIT_MS = 15_000;

/** A new plan may wait for admitted work to finish. Keep the original public
 * status and the first private inventory throughout this read-only observation. */
export async function readRetiringRuntimeProcesses(read: () => Promise<ExecutionSnapshot>, status: RuntimeUpdateStatusObservation,
  guardianPid: number, mode: 'prepare' | 'verify', progress: (message: string) => void = () => {}) {
  const generations = new Map(status.apps.map(app => [app.name, app.generation]));
  let firstInventory: string | undefined;
  const settled = mode === 'verify' ? await read() : await observeRuntimeUntil(async () => {
    const snapshot = await read().catch((error: unknown) => {
      if (error instanceof RuntimeObservationPending)
        throw new RuntimeObservationUnconfirmed('The private owner read did not report its activity', error);
      throw error;
    });
    assertProcessOwner(snapshot, status);
    const generationsChanged = snapshot.apps.length !== generations.size || snapshot.apps.some(({ info }) =>
      !generations.has(info.name) || generations.get(info.name) !== info.generation);
    if (generationsChanged || firstInventory !== undefined && firstInventory !== snapshot.inventoryDigest)
      throw new RuntimeObservationConflict('Application process inventory or generation changed while preparing the runtime update');
    if (snapshot.status.inFlight === 0) return snapshot;
    firstInventory = snapshot.inventoryDigest;
    throw new RuntimeObservationPending('applications', 'Waiting for admitted execution-owner work to finish');
  }, PROCESS_REVIEW_WAIT_MS, 'Execution owner did not settle during runtime update preparation', 500, progress);
  return { retiredPids: retiringRuntimePids(settled, status.pid, guardianPid, status),
    processInventory: { epoch: settled.status.controller.epoch, digest: settled.inventoryDigest } };
}

/** Protocol 1 lists every pool member by PM id. A status row prints one representative. */
export function retiringRuntimePids(snapshot: ExecutionSnapshot, backendPid: number, guardianPid: number,
  publicStatus?: RuntimeUpdateStatusObservation): number[] {
  if (!validPid(backendPid) || !validPid(guardianPid)) throw Error('Invalid native process inventory');
  assertProcessOwner(snapshot, publicStatus);
  if (snapshot.status.inFlight !== 0) unsettled('Application ownership is changing during native process observation');

  const pids = new Set([backendPid, guardianPid]);
  const workers = new Map<string, number>();
  for (const worker of snapshot.workers) {
    const id = worker.info?.id;
    if (!id || workers.has(id) || !validPid(worker.pid) || pids.has(worker.pid) || worker.pid === snapshot.status.owner.pid ||
        worker.info.pid !== undefined && worker.info.pid !== worker.pid)
      throw Error('Incomplete or conflicting native worker identity: ' + (id ?? 'unknown'));
    workers.set(id, worker.pid); pids.add(worker.pid);
  }
  const reported = publicStatus && new Map(publicStatus.apps.map(app => [app.name, app]));
  if (reported && (reported.size !== publicStatus?.apps.length || reported.size !== snapshot.apps.length))
    unsettled('Application registry changed during native process observation');
  const claimed = new Set<string>();
  for (const app of snapshot.apps) {
    const info = app.info;
    const memberPids = new Set<number>();
    const claim = (id: string) => {
      const pid = workers.get(id);
      if (pid === undefined || claimed.has(id)) throw Error('Missing or ambiguous native worker for ' + info.name + ': ' + id);
      claimed.add(id); memberPids.add(pid);
      return pid;
    };
    if (!Array.isArray(app.pools) || (app.children !== null && !Array.isArray(app.children)))
      throw Error('Incomplete native process groups for ' + info.name);
    const pools = new Map<string, Set<number>>();
    for (const pool of app.pools) {
      if (pools.has(pool.name) || !Array.isArray(pool.workerIds)) throw Error('Incomplete native pool for ' + info.name);
      pools.set(pool.name, new Set(pool.workerIds.map(claim)));
    }
    for (const child of app.children ?? []) {
      if (child.processId !== undefined) { claim(child.processId); continue; }
      const name = child.name.startsWith(info.name + '/') ? child.name.slice(info.name.length + 1) : child.name;
      // A pool proxy has no single process id. An exited supervisor child can
      // also remain declared while its application is partially stopped.
      const row = info.processes?.find(process => process.name === name);
      const empty = row?.status === 'stopped' && row.pid === null && row.instances === 0;
      if (!pools.has(name) && info.status === 'online' && !empty) unsettled('Missing native child identity for ' + child.name);
    }
    if (info.pid !== null) {
      if (!validPid(info.pid)) throw Error('Invalid native application process identity for ' + info.name);
      memberPids.add(info.pid); pids.add(info.pid);
    }
    if (info.status === 'online' && !memberPids.size) unsettled('Missing native application process identity for ' + info.name);
    if (info.status === 'starting' || info.status === 'stopping' || info.status === 'stopped' && memberPids.size)
      unsettled('Application processes have not settled for ' + info.name);
    const checkRows = (view: ProcessInfoDto) => {
      for (const row of view.processes ?? []) {
        const group = pools.get(row.name);
        const active = row.status === 'online' || row.pid !== null || (row.instances ?? 0) > 0;
        if (group && row.instances !== undefined && row.instances !== group.size ||
            !group && ((row.instances ?? 0) > 1 || active && row.declaredInstances > 1) ||
            row.pid !== null && !(group ?? memberPids).has(row.pid) ||
            row.pid === null && !group?.size && active)
          unsettled('Incomplete native group membership for ' + info.name + '/' + row.name);
      }
    };
    checkRows(info);
    if (reported) {
      const other = reported.get(info.name);
      if (!other || other.status !== info.status || other.pid !== info.pid || other.generation !== info.generation)
        unsettled('Application identity changed during native process observation: ' + info.name);
      checkRows(other);
      reported.delete(info.name);
    }
  }
  if (claimed.size !== workers.size || reported?.size) throw Error('Native process inventory has unassigned members');
  return [...pids].sort((a, b) => a - b);
}
