import { createHash, randomUUID } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { OrchestratorControl } from '../orchestrator/execution-contract.js';
import type { StackExecutionPlan, StackExecutionReceipt, StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackExecutionKey } from '../shared/dto/stack-execution.js';
import type { StopAudience, StopPermit, StopRecipient } from '../cluster/stop-authority.js';

export interface NodeStackStopRequest extends StackExecutionScope { applications: boolean; audience?: StopAudience }
export interface NodeStackStopExecution extends StackExecutionScope { operationId: string; permit?: StopPermit }
export interface NodeStackStopReceipt extends StackExecutionScope {
  protocol: 1;
  operationId: string;
  outcome: 'stopped';
  observedAt: string;
  applications: StackExecutionReceipt | null;
  removedContainers: string[];
  authority?: { clusterId: string; nodeId: string; epoch: string };
}
export interface NodeStackStopPlan extends NodeStackStopRequest {
  protocol: 1;
  operationId: string;
  expiresAt: number;
  execution: StackExecutionPlan | null;
  definition: string;
  containers: Array<{ id: string; name: string }>;
}
interface StopRecord {
  plan: NodeStackStopPlan;
  phase: 'prepared' | 'applying' | 'failed' | 'stopped';
  receipt?: NodeStackStopReceipt;
  error?: string;
  suspended?: boolean;
}
interface StackStopPorts {
  execution: Pick<OrchestratorControl, 'inspectStackExecution' | 'stopStackExecution'>;
  /** Fails closed for unbound legacy app allocations. Never guesses ownership. */
  definition(scope: NodeStackStopRequest): Promise<{ runtime: StackExecutionScope | null; fingerprint: string }>;
  containers(scope: StackExecutionScope): Promise<Array<{ id: string; name: string }>>;
  disableResume(scope: StackExecutionScope): void;
  retireInfrastructure(scope: StackExecutionScope): Promise<void>;
  removeContainer(id: string): Promise<void>;
}
const RECORDS = 'lifecycle:node-stack-stops:v1';
type Records = Record<string, StopRecord>;

/** Durable node-side receipt. The controller never infers a stop from a lost connection. */
export class NodeStackStop {
  private readonly active = new Map<string, { id: string; signature: string | undefined; promise: Promise<NodeStackStopReceipt> }>();
  private recipient?: StopRecipient;
  private preparing = 0;
  constructor(private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>, private readonly ports: StackStopPorts) {}
  setRecipient(recipient: StopRecipient): void { this.recipient = recipient; }
  get busy(): boolean { return this.preparing > 0 || this.active.size > 0; }

  private records(): Records {
    const records = this.store.kvGetSync<Records>(RECORDS, { strict: true }) ?? {};
    for (const [key, record] of Object.entries(records)) {
      if (!record?.plan || record.plan.protocol !== 1 || stackExecutionKey(record.plan) !== key ||
          !['prepared', 'applying', 'failed', 'stopped'].includes(record.phase)) throw new Error('Corrupt node stack-stop journal');
    }
    return records;
  }
  private write(scope: StackExecutionScope, change: (record: StopRecord | undefined) => StopRecord): StopRecord {
    const key = stackExecutionKey(scope);
    return this.store.kvUpdateSync<Records>(RECORDS, () => {
      const records = this.records();
      records[key] = change(records[key]);
      return records;
    })[key]!;
  }
  assertMutable(scope: StackExecutionScope): void {
    const record = this.records()[stackExecutionKey(scope)];
    if (record?.suspended || record?.phase === 'applying' || record?.phase === 'failed') {
      throw new Error(`Stack '${stackExecutionKey(scope)}' has an unconfirmed stop (${record.plan.operationId}); reconcile it before deployment`);
    }
  }
  async prepare(scope: NodeStackStopRequest): Promise<NodeStackStopPlan> {
    this.preparing++;
    try { return await this.preparePlan(scope); }
    finally { this.preparing--; }
  }
  private async preparePlan(scope: NodeStackStopRequest): Promise<NodeStackStopPlan> {
    const key = stackExecutionKey(scope);
    if (typeof scope.applications !== 'boolean') throw new Error('Application placement must be explicit');
    if (scope.audience?.clusterId !== this.recipient?.audience.clusterId || scope.audience?.nodeId !== this.recipient?.audience.nodeId) {
      throw new Error('Stack stop requires matching controller and recipient cluster enrollment');
    }
    if (this.active.has(key)) throw new Error(`Stack '${key}' is already stopping`);
    const definition = await this.ports.definition(scope);
    const execution = definition.runtime ? await this.ports.execution.inspectStackExecution(definition.runtime) : null;
    const containers = await this.ports.containers(scope);
    if (this.active.has(key)) throw new Error(`Stack '${key}' changed while preparing its stop`);
    const plan: NodeStackStopPlan = { protocol: 1, project: scope.project, stack: scope.stack,
      applications: scope.applications, operationId: randomUUID(), expiresAt: Date.now() + 10 * 60_000,
      definition: definition.fingerprint, execution, containers,
      ...(this.recipient && { audience: { ...this.recipient.audience } }) };
    return this.write(scope, prior => {
      // Repeated preflights cannot invalidate a still-usable signed challenge.
      if (plan.audience && prior?.phase === 'prepared' && prior.plan.expiresAt > Date.now() &&
          prior.plan.definition === plan.definition && prior.plan.applications === plan.applications &&
          prior.plan.audience?.clusterId === plan.audience.clusterId && prior.plan.audience.nodeId === plan.audience.nodeId &&
          stackDefinitionFingerprint([prior.plan.execution, prior.plan.containers]) === stackDefinitionFingerprint([execution, containers])) return prior;
      return { plan, phase: 'prepared', suspended: !!prior && (prior.suspended === true || prior.phase === 'applying' || prior.phase === 'failed') };
    }).plan;
  }
  execute(scope: NodeStackStopExecution): Promise<NodeStackStopReceipt> {
    const key = stackExecutionKey(scope);
    const active = this.active.get(key);
    if (active) {
      if (active.id !== scope.operationId || active.signature !== scope.permit?.signature) throw new Error(`Stack '${key}' already has another stop in progress`);
      return active.promise;
    }
    const promise = this.executeNow(scope).finally(() => this.active.delete(key));
    this.active.set(key, { id: scope.operationId, signature: scope.permit?.signature, promise });
    return promise;
  }
  private async executeNow(scope: NodeStackStopExecution): Promise<NodeStackStopReceipt> {
    const key = stackExecutionKey(scope);
    const record = this.records()[key];
    if (!record || record.plan.operationId !== scope.operationId) throw new Error('Stop plan is missing or superseded; prepare again');
    const { plan } = record;
    if (Boolean(this.recipient) !== Boolean(plan.audience) || Boolean(this.recipient) !== Boolean(scope.permit)) {
      throw new Error('Stack stop authority changed; prepare a new plan for the enrolled node');
    }
    const admit = () => this.recipient?.admit(plan, scope.permit);
    const definition = await this.ports.definition(plan);
    if (definition.fingerprint !== plan.definition) throw new Error('Node allocation changed; prepare a new stop');
    if (record.phase === 'stopped' && record.receipt) {
      await admit();
      await this.verifyStopped(record.receipt);
      return record.receipt;
    }
    if (record.phase === 'prepared' && Date.now() > plan.expiresAt) throw new Error('Stop plan expired; prepare again');
    await admit();
    this.write(scope, current => {
      if (current?.plan.operationId !== plan.operationId) throw new Error('Stop plan was superseded');
      return { plan, phase: 'applying' };
    });
    try {
      // Never stop the apps before discovering that the reviewed container inventory was replaced.
      const planned = new Set(plan.containers.map(container => container.id));
      const checkInventory = async () => {
        const containers = await this.ports.containers(plan);
        if (containers.some(container => !planned.has(container.id))) throw new Error('Container ownership changed during stop; inspect and prepare again');
        return containers;
      };
      await checkInventory();
      await admit();
      if (definition.runtime) this.ports.disableResume(definition.runtime);
      const applications = plan.execution
        ? await this.ports.execution.stopStackExecution({ operationId: plan.operationId, plan: plan.execution }) : null;
      // Drain existing reconciliation and remove the desired state before
      // deleting containers. Other stacks keep their monitors and resources.
      await admit();
      await this.ports.retireInfrastructure(plan);
      const current = await checkInventory();
      await admit();
      const outcomes = await Promise.allSettled(current.map(container => this.ports.removeContainer(container.id)));
      const failures = outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
        ? [`${current[index]!.name}: ${String(outcome.reason)}`] : []);
      if (failures.length) throw new Error(`Container stop incomplete: ${failures.join('; ')}`);
      const receipt: NodeStackStopReceipt = { protocol: 1, project: scope.project, stack: scope.stack,
        operationId: plan.operationId, outcome: 'stopped', observedAt: new Date().toISOString(), applications,
        removedContainers: plan.containers.map(container => container.id),
        ...(plan.audience && scope.permit && { authority: { ...plan.audience, epoch: scope.permit.epoch } }) };
      await this.verifyStopped(receipt);
      this.write(scope, currentRecord => {
        if (currentRecord?.plan.operationId !== plan.operationId) throw new Error('Stop authority changed');
        return { plan, phase: 'stopped', receipt };
      });
      return receipt;
    } catch (error) {
      this.write(scope, current => {
        if (current?.plan.operationId !== plan.operationId) throw new Error('Stop authority changed', { cause: error });
        return { plan, phase: 'failed', error: String(error) };
      });
      throw error;
    }
  }
  private async verifyStopped(receipt: NodeStackStopReceipt): Promise<void> {
    if (receipt.applications) {
      const state = await this.ports.execution.inspectStackExecution(receipt.applications);
      if (state.revision !== receipt.applications.revision || state.phase !== 'stopped') {
        throw new Error('The application allocation changed after its stop receipt');
      }
    }
    if ((await this.ports.containers(receipt)).length) throw new Error('Stack containers are still present; stop is not confirmed');
  }
}

export function stackDefinitionFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
