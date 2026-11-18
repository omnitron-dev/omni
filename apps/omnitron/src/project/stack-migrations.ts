import { assertOperationId } from '@xec-sh/core';
import { createHash } from 'node:crypto';
import { OperationJournal, hasOperationJournal } from '../execution/operation-journal.js';
import { recoveryState } from '../daemon/recovery-state.js';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { OperationReceipt } from '../shared/dto/execution-operations.js';
import type { StackMigrationReview, StackMigrationRequest } from '../shared/dto/project.js';
import type { StackExecutionScope } from '../shared/dto/stack-execution.js';
import { executeMigrationPlan, type LocalMigrationPlan } from '../services/migration-execution.js';
import { withMigrationSdk, releaseTerminalMigrationSdk, type MigrationSdkInspection } from '../../bin/sdk.js';

export interface PreparedStackMigrations { review: StackMigrationReview; plan: LocalMigrationPlan; endpoints: string[]; sdk: MigrationSdkInspection }
const key = (scope: StackExecutionScope) => JSON.stringify([scope.project, scope.stack]);
const owns = (receipt: OperationReceipt, scope: StackExecutionScope) => receipt.kind === 'migration' &&
  receipt.resources.some(resource => resource.kind === 'stack-migration' && resource.project === scope.project && resource.stack === scope.stack);

/** Admission and durable non-replay around the existing migration executor. */
export class StackMigrations {
  private journal?: OperationJournal;
  private readonly active = new Map<string, string>();
  constructor(private readonly store: DaemonStateStore) {}
  private operations() { return this.journal ??= new OperationJournal(this.store, recoveryState); }

  assertIdle(scope?: StackExecutionScope): void {
    if (scope ? this.active.has(key(scope)) : this.active.size > 0)
      throw Error('Stack migrations are in progress; wait for their receipt');
    if (!hasOperationJournal(this.store)) return;
    if (this.operations().pending().some(receipt => receipt.kind === 'migration' && (!scope || owns(receipt, scope))))
      throw Error('A stack migration outcome is unconfirmed; inspect its operation and database history before further lifecycle changes');
  }

  read(scope: StackExecutionScope, id: string): OperationReceipt | null {
    assertOperationId(id);
    const receipt = this.operations().read(id);
    return receipt && owns(receipt, scope) ? receipt : null;
  }

  async complete(receipt: OperationReceipt): Promise<OperationReceipt> {
    if (['succeeded', 'failed', 'cancelled'].includes(receipt.state)) {
      const consumer = receipt.resources.filter(resource => resource.kind === 'sdk-consumer');
      const sources = receipt.resources.filter(resource => resource.kind === 'sdk-source');
      if (consumer.length !== 1) throw Error('Migration receipt has no unique SDK consumer identity');
      const workspaces = [...consumer, ...sources].map(resource => JSON.parse(resource.name) as MigrationSdkInspection['workspaces'][number]);
      await releaseTerminalMigrationSdk(workspaces, { id: receipt.id, review: receipt.inputDigest,
        journal: this.store.dbPath, read: () => this.operations().read(receipt.id) });
    }
    return receipt;
  }

  async execute(request: StackMigrationRequest, inspect: () => Promise<PreparedStackMigrations>,
    output: (target: LocalMigrationPlan[number]['target'], stdout: string) => void,
    drain: () => Promise<void>): Promise<OperationReceipt> {
    assertOperationId(request.operationId);
    request = { ...request, operationId: request.operationId.toLowerCase() };
    if (!/^[a-f0-9]{64}$/.test(request.review)) throw Error('An exact migration review digest is required');
    const prior = this.read(request, request.operationId);
    if (prior) {
      if (prior.inputDigest !== request.review) throw Error('Migration request ID already belongs to another review');
      return this.complete(prior); // A lost reply never grants a second execution.
    }
    this.assertIdle(request);
    this.active.set(key(request), request.operationId);
    try {
      const before = await inspect();
      if (!before.review.stopped || before.review.digest !== request.review)
        throw Error('Stack migration review changed or applications are not fully stopped; inspect again');
      await drain();
      return await withMigrationSdk(before.sdk.root, { id: request.operationId, review: request.review,
        journal: this.store.dbPath, read: () => this.operations().read(request.operationId) }, async hold => {
        let receipt: OperationReceipt | undefined, started = false;
        try {
          const prepared = await inspect();
          if (prepared.review.digest !== request.review || !prepared.review.stopped)
            throw Error('Stack migration review changed or applications are not fully stopped; inspect again');
          const resources = [{ kind: 'stack-migration', name: 'migrations', project: request.project, stack: request.stack },
            ...prepared.sdk.workspaces.map((identity, index) => ({ kind: index === 0 ? 'sdk-consumer' : 'sdk-source', name: JSON.stringify(identity) })),
            ...[...new Set(prepared.plan.map(item => item.target.database))].map(name => ({
              kind: 'database', name, project: request.project, stack: request.stack,
            })), ...prepared.endpoints.map(name => ({ kind: 'database-endpoint', name }))];
          const admitted = this.operations().prepare({ id: request.operationId, kind: 'migration', resources, inputDigest: request.review });
          receipt = admitted.receipt;
          if (!admitted.created) return receipt;
          await hold.retain(); // Durable SDK source fence precedes any child.
          receipt = this.operations().transition(receipt.id, receipt.revision, 'running');
          await executeMigrationPlan(prepared.plan, {
            inspect: async () => {
              const current = await inspect();
              if (!current.review.stopped || current.review.digest !== request.review)
                throw Error('Stack, stop receipt or migration binding changed before execution');
              return current.plan;
            },
            beforeExecution: () => { started = true; }, output,
          });
          receipt = this.operations().transition(receipt.id, receipt.revision, 'succeeded');
          return receipt;
        } catch (error) {
          if (receipt && ['prepared', 'running'].includes(receipt.state)) {
            // A child failure can follow committed migrations. Inspection is
            // not authority to release the fence or replay this request.
            receipt = this.operations().transition(receipt.id, receipt.revision, started ? 'unknown' : 'failed', {
              code: started ? 'MIGRATION_OUTCOME_UNCONFIRMED' : 'MIGRATION_PREFLIGHT_FAILED',
            });
            return receipt;
          }
          throw error;
        } finally {
          if (receipt && ['succeeded', 'failed', 'cancelled'].includes(receipt.state)) await hold.release();
        }
      });
    } finally { this.active.delete(key(request)); }
  }
}

/** Only a digest and safe summary leave the owner; never resolved secrets. */
export function migrationReviewDigest(evidence: unknown): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}
