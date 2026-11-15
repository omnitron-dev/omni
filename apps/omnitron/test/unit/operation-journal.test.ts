import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ExecutionResource } from '@xec-sh/core';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { RecoveryState } from '../../src/daemon/recovery-state.js';
import { OperationJournal } from '../../src/execution/operation-journal.js';
import type { OperationIntent, OperationReceipt } from '../../src/shared/dto/execution-operations.js';

const resource = { kind: 'postgresql', project: 'example', stack: 'dev', name: 'main' };
const key = (id: string) => `execution.operation.${id}`;
const activeKey = 'execution.operation.active';
const intent = (overrides: Partial<OperationIntent> = {}): OperationIntent => ({
  id: randomUUID(), kind: 'backup.dump', resources: [resource], inputDigest: 'a'.repeat(64), ...overrides,
});
const execution = (id: string): ExecutionResource => ({ type: 'docker-container', operationId: id, daemonId: 'fixture-daemon', id: 'b'.repeat(64) });

describe('durable execution operations', () => {
  let directory: string;
  let store: DaemonStateStore;
  let recovery: RecoveryState;
  let journal: OperationJournal;
  const opened: DaemonStateStore[] = [];
  function open(): DaemonStateStore {
    const result = new DaemonStateStore(createNullLogger(), path.join(directory, 'state.db'));
    opened.push(result);
    return result;
  }
  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-operation-'));
    store = open(); recovery = new RecoveryState(); journal = new OperationJournal(store, recovery);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const database of opened.splice(0)) await database.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it('commits intent and resource claims with FULL WAL before returning permission to execute', () => {
    let receiptWrite = false;
    const write = store.kvSetSync.bind(store);
    vi.spyOn(store, 'kvSetSync').mockImplementation((name, value) => {
      expect(store.initSync().inTransaction).toBe(true);
      expect(store.initSync().pragma('synchronous', { simple: true })).toBe(2);
      expect(recovery.token()).toBeNull();
      if (name !== activeKey) receiptWrite = true;
      write(name, value);
    });
    const request = intent();
    const result = journal.prepare(request);
    expect(result.created).toBe(true);
    expect(receiptWrite).toBe(true);
    expect(store.initSync().pragma('synchronous', { simple: true })).toBe(1);
    expect(journal.pending()).toEqual([result.receipt]);
  });

  it('returns the same attempt after a lost reply and rejects reusing its ID for different inputs', () => {
    const first = intent({ resources: [resource, { ...resource, name: 'archive' }] });
    const prepared = journal.prepare(first);
    const repeated = journal.prepare({ ...first, resources: [...first.resources].reverse() });
    expect(repeated).toEqual({ ...prepared, created: false });
    expect(() => journal.prepare({ ...first, inputDigest: 'c'.repeat(64) })).toThrow(expect.objectContaining({ code: 'OPERATION_CONFLICT' }));
    expect(journal.read(first.id)).toEqual(prepared.receipt);
  });

  it('does not let concurrent connections claim the same database, but allows independent projects', () => {
    const second = new OperationJournal(open(), new RecoveryState());
    const first = journal.prepare(intent()).receipt;
    expect(() => second.prepare(intent())).toThrow(expect.objectContaining({ code: 'OPERATION_CONFLICT' }));
    const unrelated = second.prepare(intent({ resources: [{ ...resource, project: 'other' }] })).receipt;
    expect(journal.pending().map(receipt => receipt.id).sort()).toEqual([first.id, unrelated.id].sort());
  });

  it('rolls back both claim and intent when the receipt write fails, without admitting execution', () => {
    const request = intent();
    const write = store.kvSetSync.bind(store);
    vi.spyOn(store, 'kvSetSync').mockImplementation((name, value) => {
      if (name === key(request.id)) throw new Error('injected disk write failure');
      write(name, value);
    });
    expect(() => journal.prepare(request)).toThrow('disk write failure');
    expect(journal.read(request.id)).toBeNull();
    expect(journal.pending()).toEqual([]);
    expect(recovery.token()).toBeNull();
    vi.restoreAllMocks();
    const retry = journal.prepare(request);
    expect(retry.created).toBe(true);
    journal.transition(request.id, retry.receipt.revision, 'cancelled');
    expect(recovery.token()).not.toBeNull();
  });

  it('refuses effects when recovery invalidation cannot be persisted', () => {
    let fail = false;
    recovery.attach(() => { if (fail) throw new Error('recovery journal unavailable'); });
    fail = true;
    const request = intent();
    expect(() => journal.prepare(request)).toThrow('recovery journal unavailable');
    expect(journal.pending()).toEqual([]);
    expect(journal.read(request.id)).toBeNull();
  });

  it('rejects stale revisions before changing execution ownership', () => {
    const first = journal.prepare(intent()).receipt;
    const running = journal.transition(first.id, first.revision, 'running');
    expect(() => journal.recordExecution(first.id, first.revision, execution(first.id))).toThrow(expect.objectContaining({ code: 'OPERATION_REVISION_CONFLICT' }));
    expect(journal.read(first.id)).toEqual(running);
    const recorded = journal.recordExecution(first.id, running.revision, execution(first.id));
    expect(() => journal.recordExecution(first.id, recorded.revision, { ...execution(first.id), daemonId: 'another-daemon' })).toThrow('ownership');
  });

  it('retains an unknown execution across promise rejection and a database reopen', async () => {
    const first = journal.prepare(intent()).receipt;
    const running = journal.transition(first.id, first.revision, 'running');
    const owned = journal.recordExecution(first.id, running.revision, execution(first.id));
    await expect(recovery.run('caller', async () => {
      journal.transition(first.id, owned.revision, 'unknown', { code: 'EXECUTION_OUTCOME_UNKNOWN' });
      throw new Error('transport ended without a remote outcome');
    })).rejects.toThrow('transport ended');
    expect(recovery.token()).toBeNull();
    await store.dispose();
    const nextRecovery = new RecoveryState();
    const next = new OperationJournal(open(), nextRecovery);
    expect(nextRecovery.token()).toBeNull();
    expect(next.pending()).toMatchObject([{ id: first.id, state: 'unknown', execution: execution(first.id) }]);
    expect(() => next.prepare(intent())).toThrow(expect.objectContaining({ code: 'OPERATION_CONFLICT' }));
    const pending = next.read(first.id)!;
    expect(() => next.transition(first.id, pending.revision, 'running')).toThrow('Cannot move');
    expect(() => next.transition(first.id, pending.revision, 'failed')).toThrow('Reconcile');
    const completed = next.transition(first.id, pending.revision, 'failed', { observation: { resource: execution(first.id), state: 'stopped' } });
    expect(nextRecovery.token()).not.toBeNull();
    expect(completed.state).toBe('failed');
    expect(next.prepare(intent()).created).toBe(true);
  });

  it.each(['running', 'unknown'] as const)('does not accept a %s observation as termination', state => {
    const first = journal.prepare(intent()).receipt;
    const running = journal.transition(first.id, first.revision, 'running');
    const owned = journal.recordExecution(first.id, running.revision, execution(first.id));
    expect(() => journal.transition(first.id, owned.revision, 'failed', { observation: { resource: execution(first.id), state } })).toThrow('confirmed execution outcome');
    expect(journal.read(first.id)).toEqual(owned);
    expect(recovery.token()).toBeNull();
  });

  it('cannot infer absence on another daemon or from an unacknowledged creation', () => {
    const first = journal.prepare(intent()).receipt;
    const reference = execution(first.id);
    const { id: _container, ...unacknowledged } = reference;
    const running = journal.transition(first.id, first.revision, 'running');
    const owned = journal.recordExecution(first.id, running.revision, unacknowledged);
    const unknown = journal.transition(first.id, owned.revision, 'unknown');
    expect(() => journal.transition(first.id, unknown.revision, 'cancelled', { observation: { resource: unacknowledged, state: 'absent' } })).toThrow('confirmed execution outcome');
    expect(() => journal.transition(first.id, unknown.revision, 'cancelled', { observation: { resource: { ...reference, daemonId: 'other' }, state: 'absent' } })).toThrow('does not match');
    const resolved = journal.transition(first.id, unknown.revision, 'cancelled', { observation: { resource: reference, state: 'absent' } });
    expect(resolved.observation?.resource.id).toBe(reference.id);
    expect(recovery.token()).not.toBeNull();
  });

  it('retains both durable and recovery claims if the terminal commit fails', () => {
    const first = journal.prepare(intent()).receipt;
    const write = store.kvSetSync.bind(store);
    vi.spyOn(store, 'kvSetSync').mockImplementation((name, value) => {
      if (name === key(first.id)) throw new Error('injected completion write failure');
      write(name, value);
    });
    expect(() => journal.transition(first.id, first.revision, 'cancelled')).toThrow('completion write failure');
    expect(journal.pending()).toEqual([first]);
    expect(recovery.token()).toBeNull();
    vi.restoreAllMocks();
    journal.transition(first.id, first.revision, 'cancelled');
    expect(journal.pending()).toEqual([]);
    expect(recovery.token()).not.toBeNull();
  });

  it('keeps completion immutable and publishes only successful artifacts', () => {
    const first = journal.prepare(intent()).receipt;
    const running = journal.transition(first.id, first.revision, 'running');
    expect(() => journal.transition(first.id, running.revision, 'failed', { artifact: { id: 'archive', sizeBytes: 20 } })).toThrow('successful');
    const completed = journal.transition(first.id, running.revision, 'succeeded', { artifact: { id: 'archive', sizeBytes: 20, sha256: 'd'.repeat(64) } });
    expect(journal.prepare(first)).toEqual({ receipt: completed, created: false });
    expect(() => journal.transition(first.id, completed.revision, 'running')).toThrow('already terminal');
    completed.artifact!.id = 'mutated result';
    expect(journal.read(first.id)?.artifact?.id).toBe('archive');
  });

  it('rejects attempts to overwrite ownership through completion fields', () => {
    const first = journal.prepare(intent()).receipt;
    expect(() => journal.transition(first.id, first.revision, 'cancelled', { execution: undefined } as never)).toThrow('Unexpected operation journal field');
    expect(journal.pending()).toEqual([first]);
  });

  it.each(['index', 'receipt'] as const)('refuses startup with a corrupt %s instead of certifying an empty system', target => {
    const first = journal.prepare(intent()).receipt;
    store.initSync().prepare('UPDATE state_kv SET value = ? WHERE key = ?').run('{broken', target === 'index' ? activeKey : key(first.id));
    expect(() => new OperationJournal(open(), new RecoveryState())).toThrow('Corrupt daemon state');
  });

  it('refuses a missing or inconsistent receipt referenced by an active claim', () => {
    const first = journal.prepare(intent()).receipt;
    store.kvDeleteSync(key(first.id));
    expect(() => journal.pending()).toThrow('invalid receipt');
    store.kvSetSync(key(first.id), { ...first, resources: [{ ...resource, name: 'different' }] } satisfies OperationReceipt);
    expect(() => journal.pending()).toThrow();
  });
});
