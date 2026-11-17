import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { RecoveryState } from '../../src/daemon/recovery-state.js';
import { OperationJournal, assertOperationJournalCompatibility } from '../../src/execution/operation-journal.js';

const native = vi.hoisted(() => ({ home: '', runtime: '', activation: false,
  services: vi.fn(), shutdown: vi.fn(), closed: vi.fn() }));
vi.mock('../../src/daemon/runtime-installation.js', () => ({ RuntimeInstallation: {
  open: async () => ({ home: native.home, exclusive: async (work: () => Promise<unknown>) => work(),
    activation: () => native.activation, selection: () => ({ current: 'a'.repeat(64) }),
    artifact: async () => ({ directory: native.runtime }), close: native.closed }),
} }));
vi.mock('../../src/daemon/managed-runtime.js', () => ({ readManagedRuntime: async () => ({
  instanceHome: native.home, directory: path.join(native.home, 'execution'), scope: 'user',
}) }));
vi.mock('../../src/daemon/execution-journal.js', () => ({ ExecutionJournal: class {
  async read() { return { owner: { pid: 123, id: 'owner' } }; }
} }));
vi.mock('../../src/daemon/owner-reconciliation.js', () => ({ withOwnerBootFence: async (_config: unknown, work: () => Promise<unknown>) => work(),
  assertCleanManagedShutdown: native.shutdown }));
vi.mock('../../src/commands/service-resident.js', () => ({ assertResidentServicesStopped: native.services }));
const { acknowledgeStoppedBackup } = await import('../../src/daemon/backup-recovery.js');
let store: DaemonStateStore;
let journal: OperationJournal;
let id: string;
let revision: number;
beforeEach(async () => {
  vi.clearAllMocks(); native.services.mockReset(); native.shutdown.mockReset(); native.activation = false;
  native.home = await fs.mkdtemp(path.join(os.tmpdir(), 'backup-offline-review-'));
  native.runtime = path.join(native.home, 'candidate');
  await fs.mkdir(path.join(native.runtime, 'execution'), { recursive: true });
  await fs.writeFile(path.join(native.runtime, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(native.runtime, 'execution/operation-journal.js'), 'export const BACKUP_REVIEW_PROTOCOL = 2;');
  store = new DaemonStateStore(createNullLogger(), path.join(native.home, 'data/daemon-state.db'));
  journal = new OperationJournal(store, new RecoveryState()); id = randomUUID();
  const prepared = journal.prepare({ id, kind: 'backup', inputDigest: 'b'.repeat(64), resources: [
    { kind: 'database', project: 'example', stack: 'dev', name: 'ledger' }, { kind: 'database-endpoint', name: 'fixture/ledger' },
  ] }).receipt;
  const running = journal.transition(id, prepared.revision, 'running');
  const owned = journal.recordExecution(id, running.revision, { type: 'docker-container', operationId: id, daemonId: 'fixture' });
  revision = journal.transition(id, owned.revision, 'unknown').revision;
});
afterEach(async () => { await store.dispose(); await fs.rm(native.home, { recursive: true, force: true }); });

describe('offline unknown backup review', () => {
  it('uses the canonical journal only after native shutdown proof and preserves the unknown outcome', async () => {
    const result = await acknowledgeStoppedBackup(id, revision, 'Lost creation acknowledgement');
    expect(native.services).toHaveBeenCalledWith('user');
    expect(native.shutdown).toHaveBeenCalledWith(expect.any(Object), { pid: 123, lifetime: null }, []);
    expect(result).toMatchObject({ id, state: 'unknown', revision: revision + 1,
      review: { actor: `local-uid:${process.getuid!()}`, reviewedRevision: revision, decision: 'allow-new-backup' } });
    expect(journal.read(id)).toEqual(result); expect(journal.pending()).toEqual([]);
    expect(native.closed).toHaveBeenCalledOnce();
  });

  it.each(['services', 'shutdown'] as const)('refuses uncertain %s evidence before changing the receipt', async boundary => {
    native[boundary].mockImplementationOnce(() => { throw Error('native state unconfirmed'); });
    const prior = journal.read(id);
    await expect(acknowledgeStoppedBackup(id, revision, 'Review')).rejects.toThrow('native state unconfirmed');
    expect(journal.read(id)).toEqual(prior); expect(journal.pending()).toEqual([prior]);
    expect(native.closed).toHaveBeenCalledOnce();
  });

  it('refuses an unfinished runtime activation and a stale operation revision', async () => {
    native.activation = true;
    await expect(acknowledgeStoppedBackup(id, revision, 'Review')).rejects.toThrow('activation is unfinished');
    native.activation = false;
    await expect(acknowledgeStoppedBackup(id, revision - 1, 'Review')).rejects.toThrow('changed');
    expect(journal.read(id)?.review).toBeUndefined();
  });

  it('refuses a runtime without the capability, and later prevents downgrading away the decision', async () => {
    const supported = native.runtime;
    native.runtime = path.join(native.home, 'old');
    await fs.mkdir(path.join(native.runtime, 'execution'), { recursive: true });
    await fs.writeFile(path.join(native.runtime, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(native.runtime, 'execution/operation-journal.js'), 'export const BACKUP_REVIEW_PROTOCOL = 0;');
    await assertOperationJournalCompatibility(native.home, native.runtime);
    await expect(acknowledgeStoppedBackup(id, revision, 'Review')).rejects.toThrow('cannot preserve');
    expect(journal.read(id)?.review).toBeUndefined();
    journal.acknowledgeUnknownBackup(id, revision, 'operator', 'Review');
    await expect(assertOperationJournalCompatibility(native.home, native.runtime)).rejects.toThrow('cannot preserve');
    await assertOperationJournalCompatibility(native.home, supported);
  });
});
