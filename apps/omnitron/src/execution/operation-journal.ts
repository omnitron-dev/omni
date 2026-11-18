import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
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
const REVIEWED = `${PREFIX}reviewed-backups`;
/** Runtime capability required before selecting a controller for reviewed uncertainty. */
export const BACKUP_REVIEW_PROTOCOL = 2;
export const MIGRATION_OPERATION_PROTOCOL = 1;

/** Avoid opening a write-capable store merely to inspect an absent journal. */
export function hasOperationJournal(store: Pick<DaemonStateStore, 'kvGetSync'>): boolean {
  return store.kvGetSync(INDEX, { strict: true }) !== null;
}

export async function assertBackupReviewRuntime(directory: string): Promise<void> {
  const capability = await import(pathToFileURL(path.join(directory, 'execution/operation-journal.js')).href);
  if (capability.BACKUP_REVIEW_PROTOCOL !== BACKUP_REVIEW_PROTOCOL)
    throw Error('The selected runtime cannot preserve reviewed backup uncertainty');
}

/** Read-only format admission before changing a runtime. Once a review exists,
 * its history and restore fence must remain understandable even after reconciliation. */
export async function assertOperationJournalCompatibility(home: string, directory: string): Promise<void> {
  const filename = path.join(home, 'data/daemon-state.db');
  try { fs.lstatSync(filename); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  const database = openSqliteDatabase(filename, { readonly: true, fileMustExist: true });
  let reviewed: unknown, active: { value: string } | undefined;
  try {
    reviewed = database.prepare('SELECT value FROM state_kv WHERE key = ?').get(REVIEWED);
    active = database.prepare('SELECT value FROM state_kv WHERE key = ?').get(INDEX) as { value: string } | undefined;
  }
  finally { database.close(); }
  if (reviewed !== undefined) await assertBackupReviewRuntime(directory);
  if (active && JSON.parse(active.value).protocol === 3) {
    const capability = await import(pathToFileURL(path.join(directory, 'execution/operation-journal.js')).href);
    if (capability.MIGRATION_OPERATION_PROTOCOL !== MIGRATION_OPERATION_PROTOCOL)
      throw Error('The selected backend cannot preserve pending stack migration authority');
  }
}
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

type ActiveIndex = { protocol: 1 | 2 | 3; claims: Record<string, string> };
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
  exactKeys(value, ['id', 'kind', 'resources', 'inputDigest', 'protocol', 'revision', 'state', 'createdAt', 'updatedAt', 'execution', 'observation', 'artifact', 'code', 'review']);
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
  if (receipt.review !== undefined) {
    const review = receipt.review;
    if (!object(review)) invalid('Invalid unknown backup review');
    exactKeys(review, ['decision', 'reviewedRevision', 'actor', 'reason', 'at']);
    if (receipt.kind !== 'backup' || review.decision !== 'allow-new-backup' ||
        !Number.isSafeInteger(review.reviewedRevision) || review.reviewedRevision < 1 || review.reviewedRevision >= receipt.revision ||
        !label(review.actor, 256) || !label(review.reason, 1024) || typeof review.at !== 'string' || !Number.isFinite(Date.parse(review.at)) ||
        !['unknown', 'failed', 'cancelled'].includes(receipt.state)) invalid('Invalid unknown backup review');
  }
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
/** Read the whole ledger in the catalogue's read-only transaction. An unindexed
 * unfinished effect is just as unsafe as an active claim. Previously reviewed
 * unknown backups retain their original receipt and restore fence. */
export function certifiedIdleOperationDigest(rows: Iterable<{ key: string; value: string }>, certifiedAt: string): string {
  const at = Date.parse(certifiedAt);
  if (!Number.isFinite(at)) invalid('Missing prior operation certificate time');
  const digest = createHash('sha256');
  let index: unknown, reviewed: unknown;
  const unknown: string[] = [];
  let receipts = 0;
  for (const { key, value } of rows) {
    digest.update(JSON.stringify([key, value]));
    const data: unknown = JSON.parse(value);
    if (key === INDEX) { index = data; continue; }
    if (key === REVIEWED) { reviewed = data; continue; }
    const receipt = checkReceipt(data, key.slice(PREFIX.length));
    if (!key.startsWith(PREFIX) || Date.parse(receipt.createdAt) > at || Date.parse(receipt.updatedAt) > at ||
        Date.parse(receipt.createdAt) > Date.parse(receipt.updatedAt) || receipt.review && Date.parse(receipt.review.at) > at)
      invalid('Operation changed after the previous recovery certificate');
    if (!TERMINAL.has(receipt.state)) {
      if (receipt.state !== 'unknown' || !receipt.review) invalid('Unresolved operation at cold startup');
      unknown.push(receipt.id);
    }
    receipts++;
  }
  if (index !== undefined || reviewed !== undefined || receipts) {
    if (!object(index) || (index['protocol'] !== 1 && index['protocol'] !== 2) || !object(index['claims']) || Object.keys(index['claims']).length)
      invalid('Missing or active operation claims at cold startup');
    exactKeys(index, ['protocol', 'claims']);
    if (index['protocol'] === 2 ? !Array.isArray(reviewed) : reviewed !== undefined || unknown.length > 0)
      invalid('Incomplete reviewed operation index at cold startup');
    if (Array.isArray(reviewed) && (reviewed.some(id => typeof id !== 'string') ||
        JSON.stringify([...reviewed].sort()) !== JSON.stringify(unknown.sort())))
      invalid('Reviewed operation index does not match its historical receipts');
  }
  return digest.digest('hex');
}

export class OperationJournal {
  constructor(private readonly store: DaemonStateStore, private readonly recovery: RecoveryState) {
    // Restore fences before the backend can certify its startup state.
    for (const receipt of this.pending()) this.hold(receipt);
    this.reviewed(); // Validate retained restore fences before admitting work.
  }

  private hold(receipt: OperationIntent): void { this.recovery.hold(`${PREFIX}${receipt.id}`, `${receipt.kind} (${receipt.id})`); }
  private index(): ActiveIndex {
    const value = this.store.kvGetSync<unknown>(INDEX, { strict: true });
    if (value === null) return { protocol: 1, claims: {} };
    if (!object(value) || ![1, 2, 3].includes(value['protocol'] as number) || !object(value['claims'])) invalid('Invalid active operation index');
    exactKeys(value, ['protocol', 'claims']);
    if (value['protocol'] === 2 && this.store.kvGetSync(REVIEWED, { strict: true }) === null)
      invalid('Reviewed backup index is missing');
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

  private reviewedIndex(): string[] {
    const value = this.store.kvGetSync<unknown>(REVIEWED, { strict: true });
    if (value === null) return [];
    if (!Array.isArray(value) || new Set(value).size !== value.length) invalid('Invalid reviewed backup index');
    for (const id of value) { assertOperationId(id); if (id !== id.toLowerCase()) invalid('Invalid reviewed backup identity'); }
    return value;
  }

  /** Reviewed uncertainty remains visible and fences every non-backup effect. */
  reviewed(): OperationReceipt[] {
    return this.store.initSync().transaction(() => this.reviewedIndex().map(id => {
      const receipt = this.read(id);
      if (!receipt?.review || receipt.state !== 'unknown') invalid('Reviewed backup index references an invalid receipt');
      return receipt;
    })).deferred();
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
        if (!receipt || receipt.review || TERMINAL.has(receipt.state)) invalid('Active operation index references an invalid receipt');
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
        if (!TERMINAL.has(prior.state) && !prior.review) { this.claims(index, prior); this.hold(prior); }
        return prior;
      }
      if (intent.kind !== 'backup') {
        const keys = new Set(intent.resources.map(resourceKey));
        const reviewed = this.reviewed().find(previous => previous.resources.some(resource => keys.has(resourceKey(resource))));
        if (reviewed) throw new OperationJournalError('OPERATION_CONFLICT', `Unknown backup ${reviewed.id} still blocks non-backup effects; reconcile its execution first`);
      }
      for (const resource of intent.resources) {
        const owner = index.claims[resourceKey(resource)];
        if (owner) throw new OperationJournalError('OPERATION_CONFLICT', `Resource is held by operation ${owner}`);
      }
      this.hold(intent);
      const now = new Date().toISOString();
      const next: OperationReceipt = { ...intent, protocol: 1, revision: 1, state: 'prepared', createdAt: now, updatedAt: now };
      for (const resource of intent.resources) index.claims[resourceKey(resource)] = intent.id;
      // Older controllers must fail closed even on direct boot, before they
      // can reopen the durable application stop while migrations are pending.
      if (intent.kind === 'migration') index.protocol = 3;
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
      const reviewed = this.reviewedIndex();
      if (receipt.review) {
        if (!reviewed.includes(id)) invalid('Reviewed backup fence is missing');
      } else this.claims(index, receipt);
      const result = checkReceipt({ ...change(receipt), revision: revision + 1, updatedAt: new Date().toISOString() }, id);
      this.hold(receipt);
      if (!receipt.review && (TERMINAL.has(result.state) || result.review)) {
        for (const resource of receipt.resources) delete index.claims[resourceKey(resource)];
        // Older controllers reject protocol 2 at boot, even when launched
        // directly rather than selected through current admission commands.
        if (result.review && index.protocol !== 3) index.protocol = 2;
        if (index.protocol === 3 && ![...new Set(Object.values(index.claims))].some(owner => this.read(owner)?.kind === 'migration'))
          index.protocol = this.store.kvGetSync(REVIEWED, { strict: true }) !== null || result.review ? 2 : 1;
        this.store.kvSetSync(INDEX, index);
      }
      if (!receipt.review && result.review) this.store.kvSetSync(REVIEWED, [...reviewed, id]);
      else if (receipt.review && TERMINAL.has(result.state)) this.store.kvSetSync(REVIEWED, reviewed.filter(value => value !== id));
      return result;
    });
    // A thrown/unknown commit must retain the in-memory fence as well.
    if (TERMINAL.has(next.state) || next.review) this.recovery.release(PREFIX + id);
    return structuredClone(next);
  }

  recordExecution(id: string, revision: number, resource: ExecutionResource): OperationReceipt {
    assertExecutionResource(resource);
    return this.update(id, revision, receipt => {
      if (receipt.review) invalid('A reviewed backup cannot start or change execution ownership');
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
      if (receipt.review && !['failed', 'cancelled'].includes(state)) invalid('A reviewed unknown backup requires confirmed termination');
      if (!NEXT[receipt.state].includes(state)) throw new OperationJournalError('OPERATION_STATE_CONFLICT', `Cannot move operation from ${receipt.state} to ${state}`);
      if (receipt.state === 'unknown' && TERMINAL.has(state) && !completion.observation) invalid('Reconcile the unknown execution before completing its operation');
      if (!TERMINAL.has(state) && (completion.observation || completion.artifact)) invalid('Only a known terminal outcome can publish completion evidence');
      if (completion.artifact && state !== 'succeeded') invalid('Only a successful operation can publish an artifact');
      return { ...receipt, ...structuredClone(completion), state };
    });
  }

  /** Called only after the controller has relinquished this attempt. The review
   * releases its backup claim, but cannot certify an archive or permit a restore. */
  acknowledgeUnknownBackup(id: string, revision: number, actor: string, reason: string): OperationReceipt {
    if (!label(actor, 256) || !label(reason, 1024)) invalid('An authenticated actor and a reason of 1–1024 characters are required');
    return this.update(id, revision, receipt => {
      if (receipt.kind !== 'backup' || receipt.state !== 'unknown' || receipt.review ||
          receipt.resources.length !== 2 || receipt.resources.filter(value => value.kind === 'database').length !== 1 ||
          receipt.resources.filter(value => value.kind === 'database-endpoint').length !== 1 ||
          receipt.execution?.type !== 'docker-container')
        throw new OperationJournalError('OPERATION_STATE_CONFLICT', 'Only an unreviewed unknown database backup can be acknowledged');
      return { ...receipt, review: { decision: 'allow-new-backup', reviewedRevision: revision, actor, reason, at: new Date().toISOString() } };
    });
  }
}
