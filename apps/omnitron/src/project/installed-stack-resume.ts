import { INSTALLED_RESUME_TTL_MS, type ClusterPermit, type ClusterRecipient, type StackEffectPlan, type StopAudience } from '../cluster/stop-authority.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { OrchestratorControl } from '../orchestrator/execution-contract.js';
import { describeFailure } from '../services/audit.service.js';
import type { InstalledStackResumeResult } from '../shared/dto/project.js';
import { stackExecutionKey, type StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackDefinitionFingerprint, type NodeStackStop } from './node-stack-stop.js';

export interface InstalledResumeRequest extends StackExecutionScope {
  audience: StopAudience;
  operationId: string;
  stopOperationId: string;
  stopObservedAt: string;
  apps: string[];
}

export interface InstalledResumeExecution extends InstalledResumeRequest {
  plan: StackEffectPlan;
  permit: ClusterPermit;
}

export interface InstalledResumeReceipt extends StackExecutionScope {
  audience: StopAudience;
  operationId: string;
  epoch: string;
  definition: string;
  outcome: 'running' | 'unconfirmed';
  apps: string[];
  observedAt: string;
  reason?: string;
}

type Journal = { stop: string; receipt: InstalledResumeReceipt };
type Execution = Pick<
  OrchestratorControl,
  'inspectInstalledStack' | 'openInstalledStack' | 'resumeInstalledApp' | 'refreshObservation' | 'getHandle'
>;
const operationId = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;

export function sameAppSet(left: string[], right: string[]): boolean {
  const names = new Set(right);
  return left.length === right.length && names.size === right.length && left.every((app) => names.delete(app));
}

/** A signed stop and retained release closures are prerequisites. Preparation only observes the node. */
export class InstalledStackResume {
  private applying = false;
  get busy(): boolean {
    return this.applying;
  }

  constructor(
    private readonly recipient: ClusterRecipient,
    private readonly stops: Pick<NodeStackStop, 'completedStop'>,
    private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>,
    private readonly execution: Execution,
    private readonly definition: (scope: StackExecutionScope) => Promise<{
      runtime: StackExecutionScope;
      fingerprint: string;
      order: string[];
    }>,
    private readonly onObserved?: (runtime: StackExecutionScope, receipt: InstalledResumeReceipt) => void
  ) {}

  private checkTarget(request: InstalledResumeRequest): void {
    stackExecutionKey(request);
    if (
      !request.audience ||
      request.audience.clusterId !== this.recipient.audience.clusterId ||
      request.audience.nodeId !== this.recipient.audience.nodeId ||
      !operationId.test(request.operationId) ||
      !operationId.test(request.stopOperationId) ||
      !Number.isFinite(Date.parse(request.stopObservedAt)) ||
      !Array.isArray(request.apps) ||
      !request.apps.length
    )
      throw new Error('Invalid cluster resume target');
  }

  private async inspect(request: InstalledResumeRequest) {
    this.checkTarget(request);
    const { plan: stop, receipt } = this.stops.completedStop(request);
    const source = stackExecutionKey(request);
    if (receipt.removedContainers.length)
      throw new Error('The confirmed stop removed infrastructure; restore its services before deployment');
    if (
      stackExecutionKey(stop) !== source ||
      stackExecutionKey(receipt) !== source ||
      !stop.execution ||
      stop.operationId !== request.stopOperationId ||
      receipt.operationId !== stop.operationId ||
      receipt.applications?.operationId !== stop.operationId ||
      receipt.observedAt !== request.stopObservedAt ||
      receipt.authority?.clusterId !== request.audience.clusterId ||
      receipt.authority.nodeId !== request.audience.nodeId ||
      !receipt.applications
    ) {
      throw new Error('The recorded stop does not match the signed stop on this node; review a fresh stop');
    }
    const binding = await this.definition(request);
    if (binding.fingerprint !== stop.definition || !sameAppSet(binding.order, request.apps)) {
      throw new Error('Allocation or application placement changed after the confirmed stop');
    }
    const execution = await this.execution.inspectInstalledStack(binding.runtime);
    const prefix = stackExecutionKey(binding.runtime) + '/';
    const names = binding.order.map((name) => prefix + name);
    const generations = new Map(stop.execution.apps.map((app) => [app.name, app.generation]));
    if (
      stackExecutionKey(execution) !== stackExecutionKey(binding.runtime) ||
      stackExecutionKey(execution) !== stackExecutionKey(stop.execution) ||
      stackExecutionKey(execution) !== stackExecutionKey(receipt.applications) ||
      execution.phase !== 'stopped' ||
      generations.size !== execution.apps.length ||
      execution.apps.some((app) => generations.get(app.name) !== app.generation) ||
      execution.revision !== receipt.applications.revision ||
      !sameAppSet(
        names,
        execution.apps.map((a) => a.name)
      ) ||
      !sameAppSet(names, receipt.applications.stopped)
    )
      throw new Error('Owner no longer retains the exact stopped allocation');
    const definition = stackDefinitionFingerprint([receipt.operationId, binding.fingerprint, names, execution]);
    return { execution, names, definition, stop: receipt.operationId };
  }

  async prepare(request: InstalledResumeRequest): Promise<StackEffectPlan> {
    const { definition } = await this.inspect(request);
    return {
      operation: 'stack.resume-installed',
      project: request.project,
      stack: request.stack,
      audience: this.recipient.audience,
      operationId: request.operationId,
      definition,
      expiresAt: Date.now() + INSTALLED_RESUME_TTL_MS,
    };
  }

  private journal(scope: StackExecutionScope): string {
    return 'lifecycle:installed-resume:' + stackExecutionKey(scope);
  }

  receipt(request: InstalledResumeRequest): InstalledResumeReceipt | null {
    this.checkTarget(request);
    const saved = this.store.kvGetSync<Journal>(this.journal(request), { strict: true });
    return saved?.stop === request.stopOperationId && saved.receipt.operationId === request.operationId ? saved.receipt : null;
  }

  async execute(request: InstalledResumeExecution): Promise<InstalledResumeReceipt> {
    this.checkTarget(request);
    const { plan, permit } = request;
    if (
      plan.operation !== 'stack.resume-installed' ||
      stackExecutionKey(plan) !== stackExecutionKey(request) ||
      plan.operationId !== request.operationId
    )
      throw new Error('Resume permit refers to another operation');
    if (this.applying) throw new Error('Another installed allocation is resuming');
    this.applying = true;
    try {
      const admit = () => this.recipient.admitEffect(plan, permit);
      await admit();
      const prior = this.receipt(request);
      if (prior) {
        if (prior.definition !== plan.definition || prior.epoch !== permit.epoch)
          throw new Error('Resume identity was reused');
        return prior;
      }
      const observed = await this.inspect(request);
      if (plan.definition !== observed.definition) throw new Error('Installed allocation changed after preparation');
      const receipt: InstalledResumeReceipt = {
        project: plan.project,
        stack: plan.stack,
        operationId: plan.operationId,
        audience: this.recipient.audience,
        epoch: permit.epoch,
        definition: plan.definition,
        outcome: 'unconfirmed',
        apps: [],
        observedAt: new Date().toISOString(),
        reason: 'Execution has not been confirmed',
      };
      const write = (first = false) =>
        this.store.kvUpdateSync<Journal>(this.journal(request), (current) => {
          if (first && current?.stop === observed.stop)
            throw new Error('This stop already has a resume attempt; inspect or obtain a fresh stop');
          if (!first && current?.receipt.operationId !== plan.operationId)
            throw new Error('Resume journal was superseded');
          return { stop: observed.stop, receipt };
        });
      await admit();
      write(true);
      const operation = { operationId: plan.operationId, plan: observed.execution };
      try {
        await admit();
        await this.execution.openInstalledStack(operation);
        for (const name of observed.names) {
          await admit();
          await this.execution.resumeInstalledApp({ ...operation, name });
          receipt.apps.push(name);
          receipt.observedAt = new Date().toISOString();
          write();
        }
        await this.execution.refreshObservation?.();
        if (!observed.names.every((name) => this.execution.getHandle(name)?.status === 'online')) {
          throw new Error('The owner could not confirm every resumed application online');
        }
        delete receipt.reason;
        receipt.outcome = 'running';
      } catch (error) {
        receipt.reason = describeFailure(error);
      }
      receipt.observedAt = new Date().toISOString();
      write();
      this.onObserved?.(observed.execution, receipt);
      return receipt;
    } finally {
      this.applying = false;
    }
  }
}

export interface ResumeDestination {
  node: string;
  request: InstalledResumeRequest;
  prepare(): Promise<StackEffectPlan>;
  execute(plan: StackEffectPlan, permit: ClusterPermit): Promise<InstalledResumeReceipt>;
  receipt(): Promise<InstalledResumeReceipt | null>;
}

/** The node reports canonical runtime names, which may belong to an imported allocation. */
function receiptAppsMatch(names: string[], expected: string[], complete: boolean): boolean {
  const apps = new Set(expected);
  let scope: string | undefined;
  for (const name of names) {
    if (typeof name !== 'string') return false;
    const parts = name.split('/');
    if (parts.length !== 3 || !apps.delete(parts[2]!)) return false;
    const key = stackExecutionKey({ project: parts[0]!, stack: parts[1]! });
    if (scope && key !== scope) return false;
    scope = key;
  }
  return !complete || !apps.size;
}

/** Prepare the entire placement before dispatch. A lost reply permits only a receipt lookup. */
export async function resumeDestinations(
  report: InstalledStackResumeResult,
  targets: ResumeDestination[],
  authorize: (plan: StackEffectPlan) => ClusterPermit,
  persist: (report: InstalledStackResumeResult) => void
): Promise<InstalledStackResumeResult> {
  const plans: StackEffectPlan[] = [];
  for (const target of targets) {
    const prepared = await target.prepare();
    const expected = target.request;
    const plan = { ...prepared, expiresAt: Math.min(prepared.expiresAt, Date.now() + INSTALLED_RESUME_TTL_MS) };
    if (
      plan.operation !== 'stack.resume-installed' ||
      plan.project !== expected.project ||
      plan.stack !== expected.stack ||
      plan.operationId !== expected.operationId ||
      plan.audience?.nodeId !== expected.audience.nodeId ||
      plan.audience.clusterId !== expected.audience.clusterId
    )
      throw new Error('Recipient returned a plan for another allocation');
    authorize(plan);
    plans.push(plan);
  }
  report.nodes = targets.map((target) => ({ node: target.node, outcome: 'skipped' }));
  for (const [index, target] of targets.entries()) {
    const item = report.nodes[index]!,
      plan = plans[index]!;
    let dispatched = false;
    try {
      const permit = authorize(plan);
      item.outcome = 'unconfirmed';
      persist(report);
      dispatched = true;
      let reply: InstalledResumeReceipt | null;
      try {
        reply = await target.execute(plan, permit);
      } catch (error) {
        reply = await target.receipt();
        if (!reply) throw error;
      }
      if (
        reply?.operationId !== plan.operationId ||
        reply.project !== plan.project ||
        reply.stack !== plan.stack ||
        reply.definition !== plan.definition ||
        reply.epoch !== permit.epoch ||
        reply.audience?.nodeId !== plan.audience.nodeId ||
        reply.audience.clusterId !== plan.audience.clusterId ||
        !['running', 'unconfirmed'].includes(reply.outcome) ||
        !Array.isArray(reply.apps) ||
        !Number.isFinite(Date.parse(reply.observedAt)) ||
        !receiptAppsMatch(reply.apps, target.request.apps, reply.outcome === 'running')
      ) {
        throw new Error('Missing or invalid installed application receipt');
      }
      item.outcome = reply.outcome;
      item.apps = reply.apps;
      item.observedAt = reply.observedAt;
      if (reply.reason) item.reason = describeFailure(reply.reason);
    } catch (error) {
      item.outcome = dispatched ? 'unconfirmed' : 'failed';
      item.reason = describeFailure(error);
    }
    report.outcome = report.nodes.every((node) => node.outcome === 'running')
      ? 'running'
      : report.nodes.some((node) => node.outcome === 'running' || node.apps?.length)
        ? 'partial'
        : 'unconfirmed';
    persist(report);
    if (item.outcome !== 'running') break;
  }
  return report;
}
