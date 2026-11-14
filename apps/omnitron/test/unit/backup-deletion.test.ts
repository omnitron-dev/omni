import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), get OMNITRON_HOME() { return state.home; },
}));
const { BackupService } = await import('../../src/services/backup.service.js');
const { BackupRpcService } = await import('../../src/services/backup.rpc-service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const { recoveryState } = await import('../../src/daemon/recovery-state.js');
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child() { return this; } };
let store: InstanceType<typeof DaemonStateStore>;
let backups: InstanceType<typeof BackupService>;
let rpc: InstanceType<typeof BackupRpcService>;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function archive(id: string, options: { filename?: string; recordedFilename?: string; location?: string; at?: string } = {}) {
  const file = options.location ?? path.join(state.home, 'backups', options.filename ?? id + '.sql.gz');
  fs.writeFileSync(file, 'private test archive', { mode: 0o600 });
  store.insertBackupSync({ id, app: 'ledger', path: file, size_bytes: fs.statSync(file).size,
    created_at: options.at ?? '2026-11-14T12:00:00Z', metadata: {
      filename: options.recordedFilename ?? path.basename(file), type: 'postgres', project: 'fixture', stack: 'dev', compressed: true,
    } });
  return file;
}

function privateMethods() {
  return backups as unknown as {
    pgRestoreLocal(config: unknown, filename: string, compressed: boolean): Promise<void>;
    pruneOldBackups(database: string, keep: number): Promise<void>;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-deletion-'));
  store = new DaemonStateStore(logger as never, path.join(state.home, 'state.db'));
  const infra = { getConnectionInfo: () => ({ host: '127.0.0.1', port: 1, user: 'fixture', password: 'fixture' }),
    getResolvedContainerName: () => null, getPostgresDatabases: () => ['ledger'] };
  const projects = { listProjectRegistrations: () => [{ name: 'fixture' }], getRunningStacks: () => ['dev'],
    getInfraManager: () => ({ listInstances: () => [], getInstance: () => infra }) };
  backups = new BackupService({ logger } as never, store, projects as never);
  rpc = new BackupRpcService(backups);
});

afterEach(async () => {
  vi.restoreAllMocks();
  backups.dispose();
  await store.dispose();
  fs.rmSync(state.home, { recursive: true, force: true });
});

describe('backup retirement shares the application lifecycle', () => {
  it('keeps a slow unlink off the event loop and inside the recovery/handoff fence', async () => {
    const file = archive('slow');
    const release = deferred();
    const unlink = fs.promises.unlink;
    const asynchronous = vi.spyOn(fs.promises, 'unlink').mockImplementation(async filename => {
      if (filename === file) await release.promise;
      await unlink(filename);
    });
    const synchronous = vi.spyOn(fs, 'unlinkSync');
    const deleting = rpc.deleteBackup({ backupId: 'slow' });
    try {
      await vi.waitFor(() => expect(asynchronous).toHaveBeenCalledWith(file));
      await setImmediate();
      expect(synchronous).not.toHaveBeenCalled();
      expect(backups.activeOperationCount()).toBe(1);
      expect(recoveryState.token()).toBeNull();
      expect(() => backups.prepareHandoff()).toThrow('Backup or restore is active');
      expect(store.selectBackupsSync().map(row => row.id)).toEqual(['slow']);
      expect((await backups.listBackups()).map(row => row.id)).toEqual(['slow']);
    } finally { release.resolve(); await deleting; }
    expect(fs.existsSync(file)).toBe(false);
    expect(store.selectBackupsSync()).toEqual([]);
    expect(backups.activeOperationCount()).toBe(0);
    expect(recoveryState.token()).not.toBeNull();
  });

  it('returns the filesystem failure through RPC and preserves the indexed archive', async () => {
    const file = archive('denied');
    const denied = Object.assign(new Error('permission denied'), { code: 'EPERM' });
    vi.spyOn(fs.promises, 'unlink').mockRejectedValue(denied);
    await expect(rpc.deleteBackup({ backupId: 'denied' })).rejects.toThrow('permission denied');
    expect(fs.existsSync(file)).toBe(true);
    expect((await backups.listBackups()).map(row => row.id)).toEqual(['denied']);
    expect(store.selectBackupsSync().map(row => row.id)).toEqual(['denied']);
    expect(logger.info.mock.calls.some(([, message]) => message === 'Backup deleted')).toBe(false);
    expect(backups.activeOperationCount()).toBe(0);
  });

  it('preserves a partial sidecar deletion for explicit retry even after listing it', async () => {
    const file = archive('sidecar', { filename: 'custom-snapshot.db' });
    fs.writeFileSync(file + '-wal', 'pending sidecar');
    const unlink = fs.promises.unlink;
    const failure = vi.spyOn(fs.promises, 'unlink').mockImplementation(async filename => {
      if (filename === file + '-wal') throw Object.assign(new Error('sidecar busy'), { code: 'EBUSY' });
      await unlink(filename);
    });
    await expect(rpc.deleteBackup({ backupId: 'sidecar' })).rejects.toThrow('index retained for retry');
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(file + '-wal')).toBe(true);
    expect(await backups.listBackups()).toEqual([]);
    expect(store.selectBackupsSync().map(row => row.id)).toEqual(['sidecar']);
    failure.mockRestore();
    await expect(rpc.deleteBackup({ backupId: 'sidecar' })).resolves.toEqual({ success: true });
    expect(fs.existsSync(file + '-wal')).toBe(false);
    expect(store.selectBackupsSync()).toEqual([]);
  });

  it('reports an unconfirmed index removal and permits a retry with absent archive files', async () => {
    const file = archive('index');
    const failure = vi.spyOn(store, 'deleteBackupSync').mockImplementation(() => { throw new Error('index unavailable'); });
    await expect(rpc.deleteBackup({ backupId: 'index' })).rejects.toThrow('files were removed but index deletion was not confirmed');
    expect(fs.existsSync(file)).toBe(false);
    expect(await backups.listBackups()).toEqual([]);
    expect(store.selectBackupsSync().map(row => row.id)).toEqual(['index']);
    failure.mockRestore();
    await expect(rpc.deleteBackup({ backupId: 'index' })).resolves.toEqual({ success: true });
    expect(store.selectBackupsSync()).toEqual([]);
  });

  it('does not admit deletion after handoff preparation', async () => {
    const file = archive('held');
    backups.prepareHandoff();
    await expect(rpc.deleteBackup({ backupId: 'held' })).rejects.toThrow('paused for backend handoff');
    expect(fs.existsSync(file)).toBe(true);
    expect(store.selectBackupsSync()).toHaveLength(1);
  });

  it('uses the indexed path for non-default artifacts instead of a metadata-selected filename', async () => {
    const unrelated = archive('unrelated');
    const file = archive('custom', { filename: 'reviewed.custom-archive', recordedFilename: path.basename(unrelated) });
    await expect(rpc.deleteBackup({ backupId: 'custom' })).resolves.toEqual({ success: true });
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.existsSync(unrelated)).toBe(true);
    expect(store.selectBackupsSync().map(row => row.id)).toEqual(['unrelated']);
  });

  it('refuses an index path outside the managed backup directory', async () => {
    const file = archive('outside', { location: path.join(state.home, 'unrelated.data') });
    await expect(rpc.deleteBackup({ backupId: 'outside' })).rejects.toThrow('outside its managed backup directory');
    expect(fs.existsSync(file)).toBe(true);
    expect(store.selectBackupsSync()).toHaveLength(1);
  });

  it('waits for a restore of the same archive while another archive remains independent', async () => {
    const file = archive('restoring');
    const other = archive('independent');
    const release = deferred();
    const restore = vi.spyOn(privateMethods(), 'pgRestoreLocal').mockImplementation(async () => release.promise);
    const restoring = backups.restoreBackup('restoring');
    await vi.waitFor(() => expect(restore).toHaveBeenCalled());
    const deleting = rpc.deleteBackup({ backupId: 'restoring' });
    try {
      await expect(rpc.deleteBackup({ backupId: 'independent' })).resolves.toEqual({ success: true });
      expect(fs.existsSync(other)).toBe(false);
      expect(fs.existsSync(file)).toBe(true);
      expect(backups.activeOperationCount()).toBe(2);
      expect(() => backups.prepareHandoff()).toThrow('Backup or restore is active');
    } finally { release.resolve(); await restoring; await deleting; }
    expect(fs.existsSync(file)).toBe(false);
    expect(backups.activeOperationCount()).toBe(0);
  });

  it('rejects a queued restore when the preceding deletion removed its index identity', async () => {
    const file = archive('deleting');
    const release = deferred();
    const unlink = fs.promises.unlink;
    const removing = vi.spyOn(fs.promises, 'unlink').mockImplementation(async filename => {
      if (filename === file) await release.promise;
      await unlink(filename);
    });
    const restore = vi.spyOn(privateMethods(), 'pgRestoreLocal').mockResolvedValue(undefined);
    const deleting = rpc.deleteBackup({ backupId: 'deleting' });
    await vi.waitFor(() => expect(removing).toHaveBeenCalledWith(file));
    const restoring = expect(backups.restoreBackup('deleting')).rejects.toThrow('changed while waiting for its archive');
    release.resolve();
    await deleting; await restoring;
    expect(restore).not.toHaveBeenCalled();
    expect(backups.activeOperationCount()).toBe(0);
  });

  it('serializes concurrent deletions without claiming a second successful mutation', async () => {
    const file = archive('twice');
    const unlink = vi.spyOn(fs.promises, 'unlink');
    const first = rpc.deleteBackup({ backupId: 'twice' });
    const second = expect(rpc.deleteBackup({ backupId: 'twice' })).rejects.toThrow('changed while waiting for its archive');
    await expect(first).resolves.toEqual({ success: true });
    await second;
    expect(unlink.mock.calls.filter(([filename]) => filename === file)).toHaveLength(1);
    expect(backups.activeOperationCount()).toBe(0);
  });

  it('surfaces retention failure, retains its retry ID and continues independent eligible deletions', async () => {
    const failed = archive('oldest', { at: '2026-11-10T00:00:00Z' });
    const other = archive('older', { at: '2026-11-11T00:00:00Z' });
    const retained = archive('newest');
    fs.writeFileSync(failed + '-wal', 'sidecar');
    const unlink = fs.promises.unlink;
    const failure = vi.spyOn(fs.promises, 'unlink').mockImplementation(async filename => {
      if (filename === failed + '-wal') throw Object.assign(new Error('retirement denied'), { code: 'EPERM' });
      await unlink(filename);
    });
    await expect(privateMethods().pruneOldBackups('ledger', 1)).rejects.toThrow('could not delete 1 archive');
    expect(fs.existsSync(other)).toBe(false);
    expect(fs.existsSync(retained)).toBe(true);
    expect((await backups.listBackups()).map(row => row.id)).toEqual(['newest']);
    expect(store.selectBackupsSync().map(row => row.id).sort()).toEqual(['newest', 'oldest']);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ backupId: 'oldest' }), 'Backup retention could not confirm deletion');
    failure.mockRestore();
    await privateMethods().pruneOldBackups('ledger', 1);
    expect(store.selectBackupsSync().map(row => row.id)).toEqual(['newest']);
    expect(fs.existsSync(failed + '-wal')).toBe(false);
  });
});
