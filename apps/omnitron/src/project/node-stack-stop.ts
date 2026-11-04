import { createHash, randomUUID } from 'node:crypto';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { OrchestratorControl } from '../orchestrator/execution-contract.js';
import type { StackExecutionPlan, StackExecutionReceipt, StackExecutionScope } from '../shared/dto/stack-execution.js';
import { stackExecutionKey } from '../shared/dto/stack-execution.js';
import type { StopAudience, StopPermit, StopRecipient } from '../cluster/stop-authority.js';

export interface NodeStackStopRequest extends StackExecutionScope { applications: boolean; audience?: StopAudience; keepInfrastructure?: boolean }
export interface NodeStackStopExecution extends StackExecutionScope { operationId: string; permit?: StopPermit; keepInfrastructure?: boolean }
export interface NodeStackStopReceipt extends StackExecutionScope {
  protocol: 1;
  operationId: string;
  outcome: 'stopped';
  observedAt: string;
  applications: StackExecutionReceipt | null;
  removedContainers: string[];
  keepInfrastructure?: true;
  keptContainers?: string[];
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
export type NodeStackStopInventory = Omit<NodeStackStopPlan, 'expiresAt' | 'operationId'>;
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
  definition(scope: NodeStackStopRequest, cached?: boolean): Promise<{ runtime: StackExecutionScope | null; fingerprint: string }>;
  containers(scope: StackExecutionScope): Promise<Array<{ id: string; name: string }>>;
  disableResume(scope: StackExecutionScope): void;
  retireInfrastructure(scope: StackExecutionScope): Promise<void>;
  removeContainer(id: string): Promise<void>;
}
const RECORDS = 'lifecycle:node-stack-stops:v1';
type Records = Record<string, StopRecord>;

/** Durable node-side receipt. The controller never infers a stop from a lost connection. */
export class NodeStackStop {
  private readonly active = new Map<string, { id: string; signature: string | undefined; keepInfrastructure: boolean; promise: Promise<NodeStackStopReceipt> }>();
  private recipient?: StopRecipient;
  private preparing = 0;
  constructor(private readonly store: Pick<DaemonStateStore, 'kvGetSync' | 'kvUpdateSync'>, private readonly ports: StackStopPorts) {}
  setRecipient(recipient: StopRecipient): void { this.recipient = recipient; }
  get busy(): boolean { return this.preparing > 0 || this.active.size > 0; }

  private records(): Records {
    const records = this.store.kvGetSync<Records>(RECORDS, { strict: true }) ?? {};
    for (const [key, record] of Object.entries(records)) {
      if (!record?.plan || record.plan.protocol !== 1 || stackExecutionKey(record.plan) !== key ||
          !['prepared', 'applying', 'failed', 'stopped'].includes(record.phase) ||
          (record.plan.keepInfrastructure !== undefined && typeof record.plan.keepInfrastructure !== 'boolean')) throw new Error('Corrupt node stack-stop journal');
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
  assertMutable(scope?: StackExecutionScope): void {
    const records = this.records();
    const keys = scope ? [stackExecutionKey(scope)] : Object.keys(records);
    for (const key of keys) {
      const record = records[key];
      if (record?.suspended || record?.phase === 'applying' || record?.phase === 'failed' || this.active.has(key)) {
        throw new Error(`Stack '${key}' has an unconfirmed stop (${record?.plan.operationId ?? 'in progress'}); reconcile it before deployment`);
      }
    }
  }
  completedStop(scope: StackExecutionScope): { plan: NodeStackStopPlan; receipt: NodeStackStopReceipt } {
    const record = this.records()[stackExecutionKey(scope)];
    if (record?.phase !== 'stopped' || !record.receipt?.applications || !record.receipt.authority ||
        record.suspended || record.receipt.operationId !== record.plan.operationId) {
      throw new Error('Resume requires a completed, signed stop for this application allocation');
    }
    return { plan: record.plan, receipt: record.receipt };
  }
  async prepare(scope: NodeStackStopRequest): Promise<NodeStackStopPlan> {
    this.preparing++;
    try { return await this.preparePlan(scope); }
    finally { this.preparing--; }
  }
  async inspect(scope: NodeStackStopRequest, cached = true): Promise<NodeStackStopInventory> {
    const key = stackExecutionKey(scope);
    if (typeof scope.applications !== 'boolean') throw new Error('Application placement must be explicit');
    if (scope.keepInfrastructure !== undefined && typeof scope.keepInfrastructure !== 'boolean') throw new Error('Invalid infrastructure retention mode');
    if (scope.audience?.clusterId !== this.recipient?.audience.clusterId || scope.audience?.nodeId !== this.recipient?.audience.nodeId) {
      throw new Error('Stack stop requires matching controller and recipient cluster enrollment');
    }
    if (this.active.has(key)) throw new Error(`Stack '${key}' is already stopping`);
    const definition = await this.ports.definition(scope, cached);
    const execution = definition.runtime ? await this.ports.execution.inspectStackExecution(definition.runtime) : null;
    const containers = await this.ports.containers(scope);
    if (this.active.has(key)) throw new Error(`Stack '${key}' changed while preparing its stop`);
    return { protocol: 1, project: scope.project, stack: scope.stack,
      applications: scope.applications,
      ...(scope.keepInfrastructure && { keepInfrastructure: true }),
      definition: definition.fingerprint, execution, containers,
      ...(this.recipient && { audience: { ...this.recipient.audience } }) };
  }
  private async preparePlan(scope: NodeStackStopRequest): Promise<NodeStackStopPlan> {
    const inventory = await this.inspect(scope, false);
    if (this.active.has(stackExecutionKey(scope))) throw new Error('Stack changed while preparing its stop');
    const plan = { ...inventory, operationId: randomUUID(), expiresAt: Date.now() + 10 * 60_000 };
    return this.write(scope, prior => {
      // Repeated preflights cannot invalidate a still-usable signed challenge.
      if (plan.audience && prior?.phase === 'prepared' && prior.plan.expiresAt > Date.now() &&
          prior.plan.definition === plan.definition && prior.plan.applications === plan.applications &&
          (prior.plan.keepInfrastructure === true) === (plan.keepInfrastructure === true) &&
          prior.plan.audience?.clusterId === plan.audience.clusterId && prior.plan.audience.nodeId === plan.audience.nodeId &&
          stackDefinitionFingerprint([prior.plan.execution, prior.plan.containers]) === stackDefinitionFingerprint([plan.execution, plan.containers])) return prior;
      return { plan, phase: 'prepared', suspended: !!prior && (prior.suspended === true || prior.phase === 'applying' || prior.phase === 'failed') };
    }).plan;
  }
  execute(scope: NodeStackStopExecution): Promise<NodeStackStopReceipt> {
    const key = stackExecutionKey(scope);
    if (scope.keepInfrastructure !== undefined && typeof scope.keepInfrastructure !== 'boolean') throw new Error('Invalid infrastructure retention mode');
    const active = this.active.get(key);
    if (active) {
      if (active.id !== scope.operationId || active.signature !== scope.permit?.signature ||
          active.keepInfrastructure !== (scope.keepInfrastructure === true)) throw new Error(`Stack '${key}' already has another stop in progress`);
      return active.promise;
    }
    const promise = this.executeNow(scope).finally(() => this.active.delete(key));
    this.active.set(key, { id: scope.operationId, signature: scope.permit?.signature, keepInfrastructure: scope.keepInfrastructure === true, promise });
    return promise;
  }
  private async executeNow(scope: NodeStackStopExecution): Promise<NodeStackStopReceipt> {
    const key = stackExecutionKey(scope);
    const record = this.records()[key];
    if (!record || record.plan.operationId !== scope.operationId) throw new Error('Stop plan is missing or superseded; prepare again');
    const { plan } = record;
    if ((scope.keepInfrastructure === true) !== (plan.keepInfrastructure === true)) throw new Error('Infrastructure retention mode changed; prepare a new stop');
    if (Boolean(this.recipient) !== Boolean(plan.audience) || Boolean(this.recipient) !== Boolean(scope.permit)) {
      throw new Error('Stack stop authority changed; prepare a new plan for the enrolled node');
    }
    const admit = () => this.recipient?.admit(plan, scope.permit);
    const definition = await this.ports.definition(plan);
    if (definition.fingerprint !== plan.definition) throw new Error('Node allocation changed; prepare a new stop');
    if (record.phase === 'stopped' && record.receipt) {
      await admit();
      if ((record.receipt.keepInfrastructure === true) !== (plan.keepInfrastructure === true)) throw new Error('Stop receipt infrastructure mode differs from its plan');
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
        if (containers.some(container => !planned.has(container.id)) ||
            (plan.keepInfrastructure && (containers.length !== planned.size ||
              containers.some(container => !plan.containers.some(expected => expected.id === container.id && expected.name === container.name))))) {
          throw new Error('Container ownership changed during stop; inspect and prepare again');
        }
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
      if (!plan.keepInfrastructure) await this.ports.retireInfrastructure(plan);
      const current = await checkInventory();
      await admit();
      const outcomes = await Promise.allSettled(plan.keepInfrastructure ? [] : current.map(container => this.ports.removeContainer(container.id)));
      const failures = outcomes.flatMap((outcome, index) => outcome.status === 'rejected'
        ? [`${current[index]!.name}: ${String(outcome.reason)}`] : []);
      if (failures.length) throw new Error(`Container stop incomplete: ${failures.join('; ')}`);
      const receipt: NodeStackStopReceipt = { protocol: 1, project: scope.project, stack: scope.stack,
        operationId: plan.operationId, outcome: 'stopped', observedAt: new Date().toISOString(), applications,
        removedContainers: plan.keepInfrastructure ? [] : plan.containers.map(container => container.id),
        ...(plan.keepInfrastructure && { keepInfrastructure: true, keptContainers: plan.containers.map(container => container.id) }),
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
    const containers = await this.ports.containers(receipt);
    if (receipt.keepInfrastructure) {
      if (receipt.removedContainers.length || !Array.isArray(receipt.keptContainers) ||
          receipt.keptContainers.length !== new Set(receipt.keptContainers).size ||
          containers.length !== receipt.keptContainers.length || containers.some(container => !receipt.keptContainers!.includes(container.id))) {
        throw new Error('Retained stack infrastructure changed; application stop receipt requires reconciliation');
      }
    } else if (containers.length) throw new Error('Stack containers are still present; stop is not confirmed');
  }
}

export function stackDefinitionFingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
