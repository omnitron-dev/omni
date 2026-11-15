import { createHash } from 'node:crypto';
import {
  assertExecutionResource, assertOperationId,
  type ExecutionResource, type ExecutionResourceObservation,
} from '@xec-sh/core';
import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { RecoveryState } from '../daemon/recovery-state.js';
import type {
  OperationArtifact, OperationIntent, OperationReceipt, OperationResource, OperationState,
} from '../shared/dto/execution-operations.js';

const PREFIX = 'execution.operation.';
const INDEX = `${PREFIX}active`;
const DIGEST = /^[a-f0-9]{64}$/;
const KIND = /^[a-z][a-z0-9.-]{0,63}$/;
const TERMINAL = new Set<OperationState>(['succeeded', 'failed', 'cancelled']);
const NEXT: Record<OperationState, readonly OperationState[]> = {
  prepared: ['running', 'failed', 'cancelled', 'unknown'],
  running: ['cancelling', 'succeeded', 'failed', 'unknown'],
  cancelling: ['succeeded', 'failed', 'cancelled', 'unknown'],
  unknown: ['cancelling', 'succeeded', 'failed', 'cancelled'],
  succeeded: [], failed: [], cancelled: [],
};

type ActiveIndex = { protocol: 1; claims: Record<string, string> };
type Completion = { observation?: ExecutionResourceObservation; artifact?: OperationArtifact; code?: string };
type FailureCode = 'OPERATION_CONFLICT' | 'OPERATION_REVISION_CONFLICT' |
  'OPERATION_STATE_CONFLICT' | 'OPERATION_JOURNAL_INVALID';

export class OperationJournalError extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); this.name = 'OperationJournalError'; }
}

function invalid(message: string): never { throw new OperationJournalError('OPERATION_JOURNAL_INVALID', message); }
function label(value: unknown, maximum = 512): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) invalid('Unexpected operation journal field');
}
function resourceKey(resource: OperationResource): string {
  return createHash('sha256').update(JSON.stringify([resource.kind, resource.project ?? null, resource.stack ?? null, resource.name])).digest('hex');
}
function normalizeIntent(value: OperationIntent): OperationIntent {
  if (!object(value)) invalid('Invalid operation intent');
  assertOperationId(value['id']);
  if (typeof value['kind'] !== 'string' || !KIND.test(value['kind']) || typeof value['inputDigest'] !== 'string' || !DIGEST.test(value['inputDigest']) || !Array.isArray(value['resources']) ||
      value['resources'].length === 0 || value['resources'].length > 32) invalid('Invalid operation intent');
  const resources = value['resources'].map(resource => {
    if (!object(resource)) invalid('Invalid operation resource');
    exactKeys(resource, ['kind', 'project', 'stack', 'name']);
    if (typeof resource['kind'] !== 'string' || !KIND.test(resource['kind']) || !label(resource['name']) ||
        (resource['project'] === undefined) !== (resource['stack'] === undefined) ||
        resource['project'] !== undefined && (!label(resource['project'], 128) || !label(resource['stack'], 128))) {
      invalid('Invalid operation resource');
    }
    return { kind: resource['kind'], name: resource['name'],
      ...(resource['project'] === undefined ? {} : { project: resource['project'] as string, stack: resource['stack'] as string }) };
  }).sort((a, b) => { const left = resourceKey(a), right = resourceKey(b); return left < right ? -1 : left > right ? 1 : 0; });
  if (new Set(resources.map(resourceKey)).size !== resources.length) invalid('Duplicate operation resource');
  return { id: value['id'].toLowerCase(), kind: value['kind'], inputDigest: value['inputDigest'], resources };
}
function checkArtifact(value: unknown): asserts value is OperationArtifact {
  if (!object(value)) invalid('Invalid operation artifact');
  exactKeys(value, ['id', 'sizeBytes', 'sha256']);
  if (!label(value['id']) || !Number.isSafeInteger(value['sizeBytes']) || (value['sizeBytes'] as number) < 0 ||
      value['sha256'] !== undefined && (typeof value['sha256'] !== 'string' || !DIGEST.test(value['sha256']))) invalid('Invalid operation artifact');
}
function matchesResource(expected: ExecutionResource, actual: ExecutionResource): boolean {
  return expected.type === actual.type && expected.operationId === actual.operationId && expected.daemonId === actual.daemonId &&
    (expected.id === undefined || expected.id === actual.id);
}
function checkObservation(value: unknown, execution: ExecutionResource): asserts value is ExecutionResourceObservation {
  if (!object(value)) invalid('Missing execution observation');
  exactKeys(value, ['resource', 'state']);
  assertExecutionResource(value['resource']);
  if (!['running', 'stopped', 'absent', 'unknown'].includes(value['state'] as string) || !matchesResource(execution, value['resource'])) {
    invalid('Observation does not match the recorded execution');
  }
}
function checkReceipt(value: unknown, expectedId: string): OperationReceipt {
  if (!object(value)) invalid('Missing operation receipt');
  exactKeys(value, ['id', 'kind', 'resources', 'inputDigest', 'protocol', 'revision', 'state', 'createdAt', 'updatedAt', 'execution', 'observation', 'artifact', 'code']);
  const intent = normalizeIntent(value as unknown as OperationIntent);
  if (intent.id !== expectedId || value['id'] !== intent.id || value['protocol'] !== 1 || !Number.isSafeInteger(value['revision']) ||
      (value['revision'] as number) < 1 || typeof value['state'] !== 'string' || !Object.hasOwn(NEXT, value['state']) ||
      typeof value['createdAt'] !== 'string' || !Number.isFinite(Date.parse(value['createdAt'])) ||
      typeof value['updatedAt'] !== 'string' || !Number.isFinite(Date.parse(value['updatedAt'])) ||
      JSON.stringify(value['resources']) !== JSON.stringify(intent.resources)) invalid('Invalid operation receipt');
  if (value['execution'] !== undefined) {
    assertExecutionResource(value['execution']);
    if (value['execution'].operationId !== intent.id) invalid('Execution belongs to a different operation');
  }
  if (value['observation'] !== undefined) {
    if (value['execution'] === undefined) invalid('Observation has no recorded execution');
    checkObservation(value['observation'], value['execution'] as ExecutionResource);
  }
  if (value['artifact'] !== undefined) checkArtifact(value['artifact']);
  if (value['code'] !== undefined && (typeof value['code'] !== 'string' || !/^[A-Z][A-Z0-9_]{0,95}$/.test(value['code']))) invalid('Invalid operation diagnostic code');
  const receipt = value as unknown as OperationReceipt;
  if (receipt.artifact && receipt.state !== 'succeeded') invalid('An incomplete operation cannot publish an artifact');
  if (receipt.observation && !TERMINAL.has(receipt.state)) invalid('An incomplete operation cannot publish completion evidence');
  if (TERMINAL.has(receipt.state) && receipt.execution &&
      (!receipt.observation?.resource.id || !['stopped', 'absent'].includes(receipt.observation.state))) {
    invalid('Terminal operation has no confirmed execution outcome');
  }
  return receipt;
}

/** One FULL-WAL receipt per attempt and a small index of unfinished claims.
 * This is persistence for the existing executor, not a second executor. */
export class OperationJournal {
  constructor(private readonly store: DaemonStateStore, private readonly recovery: RecoveryState) {
    // Restore fences before the backend can certify its startup state.
    for (const receipt of this.pending()) this.hold(receipt);
  }

  private hold(receipt: OperationIntent): void { this.recovery.hold(`${PREFIX}${receipt.id}`, `${receipt.kind} (${receipt.id})`); }
  private index(): ActiveIndex {
    const value = this.store.kvGetSync<unknown>(INDEX, { strict: true });
    if (value === null) return { protocol: 1, claims: {} };
    if (!object(value) || value['protocol'] !== 1 || !object(value['claims'])) invalid('Invalid active operation index');
    exactKeys(value, ['protocol', 'claims']);
    for (const [key, id] of Object.entries(value['claims'])) {
      if (!DIGEST.test(key)) invalid('Invalid operation claim');
      assertOperationId(id);
      if (id !== id.toLowerCase()) invalid('Invalid operation claim identity');
    }
    return value as ActiveIndex;
  }
  private claims(index: ActiveIndex, receipt: OperationReceipt): void {
    if (receipt.resources.some(resource => index.claims[resourceKey(resource)] !== receipt.id)) invalid('Operation resource claim is missing');
  }

  read(id: string): OperationReceipt | null {
    assertOperationId(id);
    const key = id.toLowerCase();
    const value = this.store.kvGetSync<unknown>(PREFIX + key, { strict: true });
    return value === null ? null : structuredClone(checkReceipt(value, key));
  }

  pending(): OperationReceipt[] {
    // A consistent read snapshot avoids racing another connection's completion.
    return this.store.initSync().transaction(() => {
      const index = this.index();
      return [...new Set(Object.values(index.claims))].map(id => {
        const receipt = this.read(id);
        if (!receipt || TERMINAL.has(receipt.state)) invalid('Active operation index references an invalid receipt');
        this.claims(index, receipt);
        const ownedKeys = new Set(receipt.resources.map(resourceKey));
        if (Object.entries(index.claims).some(([key, owner]) => owner === id && !ownedKeys.has(key))) invalid('Operation has an undeclared resource claim');
        return receipt;
      });
    }).deferred();
  }

  prepare(value: OperationIntent): { receipt: OperationReceipt; created: boolean } {
    const intent = normalizeIntent(value);
    let created = false;
    const receipt = this.store.kvUpdateSync<OperationReceipt>(PREFIX + intent.id, current => {
      const index = this.index();
      if (current !== null) {
        const prior = checkReceipt(current, intent.id);
        if (JSON.stringify(normalizeIntent(prior)) !== JSON.stringify(intent)) {
          throw new OperationJournalError('OPERATION_CONFLICT', `Operation ${intent.id} already has different inputs`);
        }
        if (!TERMINAL.has(prior.state)) { this.claims(index, prior); this.hold(prior); }
        return prior;
      }
      for (const resource of intent.resources) {
        const owner = index.claims[resourceKey(resource)];
        if (owner) throw new OperationJournalError('OPERATION_CONFLICT', `Resource is held by operation ${owner}`);
      }
      this.hold(intent);
      const now = new Date().toISOString();
      const next: OperationReceipt = { ...intent, protocol: 1, revision: 1, state: 'prepared', createdAt: now, updatedAt: now };
      for (const resource of intent.resources) index.claims[resourceKey(resource)] = intent.id;
      this.store.kvSetSync(INDEX, index);
      created = true;
      return next;
    });
    return { receipt: structuredClone(receipt), created };
  }

  private update(id: string, revision: number, change: (receipt: OperationReceipt) => OperationReceipt): OperationReceipt {
    assertOperationId(id);
    if (!Number.isSafeInteger(revision) || revision < 1) invalid('Invalid expected operation revision');
    id = id.toLowerCase();
    const next = this.store.kvUpdateSync<OperationReceipt>(PREFIX + id, current => {
      const receipt = checkReceipt(current, id);
      if (receipt.revision !== revision) throw new OperationJournalError('OPERATION_REVISION_CONFLICT', `Operation ${id} changed; read its receipt before acting`);
      if (TERMINAL.has(receipt.state)) throw new OperationJournalError('OPERATION_STATE_CONFLICT', `Operation ${id} is already terminal`);
      const index = this.index();
      this.claims(index, receipt);
      this.hold(receipt);
      const result = checkReceipt({ ...change(receipt), revision: revision + 1, updatedAt: new Date().toISOString() }, id);
      if (TERMINAL.has(result.state)) {
        for (const resource of receipt.resources) delete index.claims[resourceKey(resource)];
        this.store.kvSetSync(INDEX, index);
      }
      return result;
    });
    // A thrown/unknown commit must retain the in-memory fence as well.
    if (TERMINAL.has(next.state)) this.recovery.release(PREFIX + id);
    return structuredClone(next);
  }

  recordExecution(id: string, revision: number, resource: ExecutionResource): OperationReceipt {
    assertExecutionResource(resource);
    return this.update(id, revision, receipt => {
      if (resource['operationId'] !== receipt.id || receipt.execution && !matchesResource(receipt.execution, resource)) {
        invalid('Cannot change execution ownership');
      }
      return { ...receipt, execution: structuredClone(resource) };
    });
  }

  transition(id: string, revision: number, state: OperationState, completion: Completion = {}): OperationReceipt {
    if (!object(completion)) invalid('Invalid operation completion');
    exactKeys(completion, ['observation', 'artifact', 'code']);
    return this.update(id, revision, receipt => {
      if (!NEXT[receipt.state].includes(state)) throw new OperationJournalError('OPERATION_STATE_CONFLICT', `Cannot move operation from ${receipt.state} to ${state}`);
      if (receipt.state === 'unknown' && TERMINAL.has(state) && !completion.observation) invalid('Reconcile the unknown execution before completing its operation');
      if (!TERMINAL.has(state) && (completion.observation || completion.artifact)) invalid('Only a known terminal outcome can publish completion evidence');
      if (completion.artifact && state !== 'succeeded') invalid('Only a successful operation can publish an artifact');
      return { ...receipt, ...structuredClone(completion), state };
    });
  }
}
