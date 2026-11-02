import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { KernelRollout, KernelRolloutTarget } from '../shared/dto/nodes.js';
import type { DeployTarget } from './remote-deployer.service.js';
import { describeFailure } from './audit.service.js';
import { ManagedRolloutFailure, type ManagedRolloutObservation } from './managed-rollout.js';

type Store = Pick<DaemonStateStore, 'kvGetSync' | 'kvSetSync' | 'kvUpdateSync'>;
type Revalidate = () => Promise<void>;
type Driver = {
  inspectManagedRollout(target: DeployTarget, commit: string, options?: { stage?: boolean }): Promise<ManagedRolloutObservation>;
  activateManagedRollout(target: DeployTarget, preflight: ManagedRolloutObservation): Promise<void>;
  reconcileManagedRollout(target: DeployTarget, preflight: ManagedRolloutObservation): Promise<'previous' | 'candidate'>;
};
type NodeSource = {
  listNodes(): Array<{ id: string; name: string; isLocal?: boolean }>;
  nodeToDeployTarget(id: string): Promise<DeployTarget>;
};
const INDEX = 'fleet:kernel:v1:index';
const recordKey = (id: string) => 'fleet:kernel:v1:plan:' + id;
const uuid = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id);
const now = () => new Date().toISOString();
const hash = (value: unknown, length: number) => typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value);
const positive = (n: number) => Number.isSafeInteger(n) && n > 0;
function validObservation(p: ManagedRolloutObservation, commit: string) {
  return p && p.commit === commit && hash(p.previous, 64) && hash(p.candidate, 64) && hash(p.appsDigest, 64) &&
    typeof p.ownerId === 'string' && p.ownerId.length > 0 && positive(p.ownerPid) && positive(p.backendPid) && positive(p.selectionRevision);
}
type Index = { latest: string; active: string | null };
type Writer = { token: string; pid: number; started: number; birth: string | null };
type Record = {
  rollout: KernelRollout;
  requestNodes: string[] | null;
  observations: Array<{ endpoint: string; preflight: ManagedRolloutObservation } | null>;
  writer: Writer | null;
  revision: number;
};

function pinnedEndpoint(target: DeployTarget) {
  if (!target.expectedHostFingerprint) throw Error('Enroll a verified SSH host key before managing this node');
  return JSON.stringify([target.expectedHostFingerprint, target.host, target.sshPort ?? 22, target.username ?? '', target.daemonPort ?? 9700]);
}

function checkIndex(index: Index | null) {
  if (index !== null && (!uuid(index.latest) || (index.active !== null && !uuid(index.active)))) throw Error('Corrupt kernel rollout index');
  return index;
}

// Distinguish a reused PID from the original controller. When an OS cannot
// identify a live PID, its journal stays fenced until that PID exits.
function processBirth(pid: number): string | null {
  try {
    if (process.platform === 'linux') {
      const stat = readFileSync('/proc/' + pid + '/stat', 'utf8');
      const ticks = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
      if (ticks && /^\d+$/.test(ticks)) return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() + '/' + ticks;
    }
    if (process.platform === 'darwin') {
      return execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], {
        encoding: 'utf8', env: { LC_ALL: 'C', TZ: 'UTC' }, timeout: 1000, stdio: ['ignore', 'pipe', 'ignore'],
      }).trim() || null;
    }
  } catch { /* Platform cannot positively attest the process birth. */ }
  return null;
}

/** One durable intent is committed before dispatch. The node driver checks the
 * pinned host and retains the remote deployment lease through handoff/rollback. */
export class KernelRolloutService {
  private readonly writer: Writer = { token: randomUUID(), pid: process.pid, started: performance.timeOrigin, birth: processBirth(process.pid) };
  private readonly jobs = new Map<string, symbol>();
  constructor(private readonly store: Store, private readonly nodes: NodeSource, private readonly driver: Driver,
    private readonly onError: (error: unknown) => void, private readonly assertController: () => void) {}

  activeCount(): number { return this.jobs.size; }

  private mayStillRun(id: string, writer: Writer) {
    if (writer.token === this.writer.token) return this.jobs.has(id);
    if (writer.pid === process.pid) return writer.started === performance.timeOrigin;
    try { process.kill(writer.pid, 0); }
    catch (err) { return (err as NodeJS.ErrnoException).code !== 'ESRCH'; }
    const birth = writer.birth && processBirth(writer.pid);
    return !birth || birth === writer.birth;
  }

  private read(id: string): Record | null {
    if (!uuid(id)) throw Error('Invalid kernel rollout ID');
    const result = this.store.kvGetSync<Record>(recordKey(id), { strict: true });
    if (result) {
      const { rollout, observations, writer, revision } = result;
      const states = ['planning', 'planned', 'blocked', 'running', 'succeeded', 'failed', 'uncertain'];
      if (rollout?.id !== id || typeof rollout.stage !== 'boolean' || (result.requestNodes !== null && !Array.isArray(result.requestNodes)) || !hash(rollout.commit, 40) || !states.includes(rollout.state) ||
          !Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(rollout.targets) || rollout.targets.length === 0 ||
          !Array.isArray(observations) || observations.length !== rollout.targets.length ||
          (['planning','running','uncertain'].includes(rollout.state) && !writer) ||
          (writer !== null && (!uuid(writer?.token) || !positive(writer.pid) || !Number.isFinite(writer.started) ||
            (writer.birth !== null && typeof writer.birth !== 'string'))) ||
          rollout.targets.some((node, i) => {
            if (!node || typeof node.nodeId !== 'string' || !['pending','ready','blocked','current','running','succeeded','failed','rolled-back','uncertain'].includes(node.state)) return true;
            const pin = observations[i];
            if (node.state === 'pending') return pin !== null || rollout.state !== 'planning';
            if (node.state === 'blocked') return pin !== null || !['planning','blocked'].includes(rollout.state);
            return !pin || typeof pin.endpoint !== 'string' || !validObservation(pin.preflight, rollout.commit) ||
              node.previous !== pin.preflight.previous || node.candidate !== pin.preflight.candidate ||
              node.ownerId !== pin.preflight.ownerId || node.ownerPid !== pin.preflight.ownerPid;
          })) throw Error('Corrupt kernel rollout record: ' + id);
    }
    return result;
  }

  /** All records and the active pointer share one FULL synchronous SQLite transaction. */
  private change(id: string, update: (record: Record, index: Index) => void | boolean) {
    let updated!: Record;
    this.store.kvUpdateSync<Index>(INDEX, index => {
      const record = this.read(id);
      checkIndex(index);
      if (!record || !index) throw Error('No kernel rollout ' + id);
      updated = record;
      if (update(record, index) === false) return index;
      record.revision++;
      record.rollout.updatedAt = now();
      this.store.kvSetSync(recordKey(id), record);
      return index;
    });
    return updated;
  }

  get(id?: string): KernelRollout | null {
    const key = id === undefined ? checkIndex(this.store.kvGetSync<Index>(INDEX, { strict: true }))?.latest : id;
    if (key === undefined) return null;
    const record = this.read(key);
    if (!record && id === undefined) throw Error('The latest kernel rollout record is missing');
    if (!record) return null;
    const rollout = record.rollout;
    if (rollout.state === 'planning' && record.writer && !this.mayStillRun(id ?? rollout.id, record.writer)) {
      this.abandonPlanning(rollout);
    }
    if (rollout.state === 'running' && record.writer && !this.mayStillRun(record.rollout.id, record.writer)) {
      rollout.state = 'uncertain'; rollout.reason = 'The originating rollout worker stopped. Reconcile the recorded dispatch before starting another rollout.';
      for (const target of rollout.targets) if (target.state === 'running') { target.state = 'uncertain'; target.reason = rollout.reason; }
    }
    return rollout;
  }

  private abandonPlanning(rollout: KernelRollout) {
    rollout.state = 'blocked';
    rollout.reason = 'The preflight worker stopped. Repeat the plan request or create another plan to recheck every target.';
    for (const node of rollout.targets) if (node.state === 'pending') {
      node.state = 'blocked'; node.reason = 'Preflight did not finish';
    }
  }

  async plan(commit: string, nodeIds?: string[], id: string = randomUUID(), stage = false, revalidate?: Revalidate): Promise<KernelRollout> {
    this.assertController();
    if (typeof stage !== 'boolean') throw Error('stage must be boolean');
    if (!hash(commit, 40)) throw Error('Supply the full 40-character Git commit of a staged runtime');
    if (nodeIds !== undefined && (!Array.isArray(nodeIds) || nodeIds.length === 0 || nodeIds.length > 128 ||
        nodeIds.some(nodeId => typeof nodeId !== 'string' || !nodeId || nodeId.length > 256) || new Set(nodeIds).size !== nodeIds.length))
      throw Error('Select one to 128 distinct node IDs in rollout order');
    let pending: Record | undefined;
    this.store.kvUpdateSync<Index>(INDEX, index => {
      checkIndex(index);
      const existing = this.read(id);
      if (existing) {
        if (existing.rollout.commit !== commit || existing.rollout.stage !== stage || JSON.stringify(existing.requestNodes) !== JSON.stringify(nodeIds ?? null))
          throw Error('The request ID is already bound to a different rollout');
        if (!index) throw Error('Missing kernel rollout index');
        if (existing.rollout.state !== 'planning' || this.mayStillRun(id, existing.writer!)) return index;
      }
      if (index?.active) {
        const held = this.read(index.active);
        if (!held || held.rollout.state !== 'planning' || this.mayStillRun(index.active, held.writer!))
          throw Error('Another kernel rollout holds the controller: ' + index.active);
        if (index.active !== id) {
          this.abandonPlanning(held.rollout); held.rollout.updatedAt = now(); held.revision++; held.writer = null;
          this.store.kvSetSync(recordKey(index.active), held);
        }
      }
      const nodes = this.nodes.listNodes();
      const ids = existing?.rollout.targets.map(n => n.nodeId) ?? nodeIds ??
        nodes.filter(n => !n.isLocal).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map(n => n.id);
      if (!ids.length || ids.length > 128) throw Error('Select between one and 128 remote nodes');
      const at = now();
      const rollout: KernelRollout = { id, commit, stage, createdAt: existing?.rollout.createdAt ?? at, updatedAt: at, state: 'planning', reason: null,
        targets: ids.map(nodeId => ({ nodeId, name: nodes.find(n => n.id === nodeId)?.name ?? nodeId, state: 'pending', reason: null,
          previous: null, candidate: null, ownerId: null, ownerPid: null })) };
      pending = { rollout, requestNodes: nodeIds ?? null, observations: ids.map(() => null), writer: this.writer, revision: (existing?.revision ?? -1) + 1 };
      this.store.kvSetSync(recordKey(id), pending);
      return { latest: id, active: id };
    });
    if (pending) this.launch(id, () => this.qualify(pending!.rollout, revalidate));
    return this.get(id)!;
  }

  private launch(id: string, job: () => Promise<void>) {
    const jobId = Symbol();
    this.jobs.set(id, jobId);
    void job().catch(this.onError).finally(() => {
      if (this.jobs.get(id) === jobId) this.jobs.delete(id);
    });
  }

  private async qualify(rollout: KernelRollout, revalidate?: Revalidate) {
    const fingerprints = new Set<string>(), owners = new Set<string>();
    const { id, commit } = rollout;
    for (const [i, target] of rollout.targets.entries()) {
      let pin: Record['observations'][number] = null;
      try {
        this.assertController();
        const node = this.nodes.listNodes().find(n => n.id === target.nodeId);
        if (!node) throw Error('Node is absent from the controller registry');
        if (node.isLocal) throw Error('Use local backend upgrade with its independent supervisor. The controller cannot certify its own handoff over this RPC.');
        const connection = await this.nodes.nodeToDeployTarget(target.nodeId);
        const endpoint = pinnedEndpoint(connection);
        if (fingerprints.has(connection.expectedHostFingerprint!)) throw Error('Another target has the same SSH host key');
        fingerprints.add(connection.expectedHostFingerprint!);
        if (rollout.stage) await revalidate?.();
        this.assertController();
        const observed = rollout.stage ? await this.driver.inspectManagedRollout(connection, commit, { stage: true }) :
          await this.driver.inspectManagedRollout(connection, commit);
        if (!validObservation(observed, commit)) throw Error('Invalid runtime or owner evidence');
        if (owners.has(observed.ownerId)) throw Error('Another target resolves to this execution owner');
        owners.add(observed.ownerId);
        pin = { endpoint, preflight: observed };
        Object.assign(target, { previous: observed.previous, candidate: observed.candidate, ownerId: observed.ownerId, ownerPid: observed.ownerPid,
          state: observed.previous === observed.candidate ? 'current' : 'ready' });
      } catch (error) { target.state = 'blocked'; target.reason = describeFailure(error); }
      this.change(id, (record, index) => {
        if (index.active !== id || record.writer?.token !== this.writer.token || record.rollout.state !== 'planning')
          throw Error('Kernel preflight writer was fenced');
        record.rollout.targets[i] = target; record.observations[i] = pin;
        if (i === rollout.targets.length - 1) {
          const blocked = record.rollout.targets.some(n => n.state === 'blocked');
          record.rollout.state = blocked ? 'blocked' : 'planned';
          record.rollout.reason = blocked ? 'At least one selected target could not be qualified. No handoff is authorized.' : null;
          record.writer = null; index.active = null;
        }
      });
    }
  }

  start(id: string, revalidate?: Revalidate): KernelRollout {
    let execute = false;
    const record = this.change(id, (run, index) => {
      if (run.rollout.state === 'running' || run.rollout.state === 'succeeded') return false;
      this.assertController();
      if (run.rollout.state !== 'planned') throw Error('Only a reviewed ready plan can start. Reconcile uncertain outcomes or create a new plan.');
      if (index.active) throw Error('Another kernel rollout holds the controller: ' + index.active);
      index.latest = id; index.active = id; run.writer = this.writer; run.rollout.state = 'running'; execute = true;
      return true;
    });
    if (execute) this.launch(id, () => this.execute(record, revalidate));
    return this.get(id)!;
  }

  private updateRunning(id: string, update: (run: KernelRollout) => void) {
    return this.change(id, (record, index) => {
      if (index.active !== id || record.writer?.token !== this.writer.token || record.rollout.state !== 'running')
        throw Error('Kernel rollout writer was fenced');
      update(record.rollout);
      if (!['running','uncertain'].includes(record.rollout.state)) index.active = null;
    });
  }

  private async connection(id: string, endpoint: string) {
    const target = await this.nodes.nodeToDeployTarget(id);
    if (pinnedEndpoint(target) !== endpoint) throw Error('Node endpoint or enrolled identity changed after plan review');
    return target;
  }

  private async execute(record: Record, revalidate?: Revalidate) {
    const { id, commit, targets } = record.rollout;
    for (const [i, node] of targets.entries()) {
      const pin = record.observations[i]!;
      const update = (state: KernelRolloutTarget['state'], reason: string | null, global?: KernelRollout['state']) =>
        this.updateRunning(id, run => {
          run.targets[i]!.state = state; run.targets[i]!.reason = reason;
          if (global) { run.state = global; run.reason = reason; }
        });
      let dispatched = false;
      try {
        const target = await this.connection(node.nodeId, pin.endpoint);
        await revalidate?.();
        this.assertController();
        if (node.state === 'current') {
          const current = await this.driver.inspectManagedRollout(target, commit);
          if (current.previous !== pin.preflight.previous || current.candidate !== pin.preflight.candidate ||
              current.ownerId !== pin.preflight.ownerId || current.ownerPid !== pin.preflight.ownerPid ||
              current.commit !== commit || current.backendPid !== pin.preflight.backendPid || current.selectionRevision !== pin.preflight.selectionRevision ||
              current.appsDigest !== pin.preflight.appsDigest) throw Error('Previously current target changed after planning');
          update('succeeded', 'Already current. Reverified owner, selection and applications.');
          continue;
        }
        update('running', null);
        dispatched = true;
        await this.driver.activateManagedRollout(target, pin.preflight);
        update('succeeded', null);
      } catch (error) {
        const outcome = !dispatched ? 'unchanged' : error instanceof ManagedRolloutFailure ? error.outcome : 'uncertain';
        update(outcome === 'uncertain' ? 'uncertain' : outcome === 'rolled-back' ? 'rolled-back' : 'failed', describeFailure(error),
          outcome === 'uncertain' ? 'uncertain' : 'failed');
        return;
      }
    }
    this.updateRunning(id, run => { run.state = 'succeeded'; run.reason = null; });
  }

  async reconcile(id: string): Promise<KernelRollout> {
    this.assertController();
    const record = this.read(id);
    if (!record) throw Error('No kernel rollout ' + id);
    if (record.rollout.state !== 'uncertain' && !(record.rollout.state === 'running' && record.writer && !this.mayStillRun(record.rollout.id, record.writer)))
      throw Error('Only an uncertain rollout or one whose original writer exited can be reconciled');
    const i = record.rollout.targets.findIndex(n => n.state === 'running' || n.state === 'uncertain');
    let result: 'previous' | 'candidate' | null = null;
    if (i !== -1) {
      const pin = record.observations[i]!;
      try {
        result = await this.driver.reconcileManagedRollout(await this.connection(record.rollout.targets[i]!.nodeId, pin.endpoint), pin.preflight);
        if (result !== 'previous' && result !== 'candidate') throw Error('The node could not prove a terminal selection');
      } catch (error) {
        const reason = 'Reconciliation could not certify this node: ' + describeFailure(error);
        this.change(id, (current, index) => {
          if (index.active !== id || current.revision !== record.revision) return false;
          current.rollout.state = 'uncertain'; current.rollout.reason = reason;
          current.rollout.targets[i]!.state = 'uncertain'; current.rollout.targets[i]!.reason = reason;
          return true;
        });
        throw new Error(reason, { cause: error });
      }
    }
    this.assertController();
    return this.change(id, (current, index) => {
      if (index.active !== id || current.revision !== record.revision) throw Error('Rollout changed while its node was being observed');
      if (i !== -1) {
        current.rollout.targets[i]!.state = result === 'candidate' ? 'succeeded' : 'rolled-back';
        current.rollout.targets[i]!.reason = result === 'candidate' ? 'Candidate confirmed by reconciliation' : 'Previous runtime confirmed by reconciliation';
      }
      const complete = current.rollout.targets.every(n => n.state === 'succeeded');
      current.rollout.state = complete ? 'succeeded' : 'failed';
      current.rollout.reason = complete ? 'Confirmed by reconciliation' : 'Reconciled. Create a new plan for remaining targets.';
      current.writer = null; index.active = null;
    }).rollout;
  }
}
