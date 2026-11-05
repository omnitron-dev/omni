import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '', copy: vi.fn(), restore: vi.fn(), inventory: vi.fn() }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), get OMNITRON_HOME() { return state.home; },
}));
vi.mock('../../src/infrastructure/container-runtime.js', () => ({ inspectStackContainers: state.inventory }));
vi.mock('../../src/services/backup-storage.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), backupStorageObjects: state.copy, restoreStorageObjects: state.restore,
}));
const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
let store: InstanceType<typeof DaemonStateStore>;
const targets = ['one', 'two'].map((project, index) => ({ project, stack: 'dev', id: String(index + 1).repeat(64), infra: {
  getResolvedContainerName: (service: string) => service === 'minio' ? project + '-minio' : null,
  getConnectionInfo: () => ({ accessKey: project, secretKey: project + '-secret' }),
  getPostgresDatabases: () => [], getMinioBuckets: () => ['storage', 'uploads'],
} }));
function service(selected = targets) {
  const projects = { getInfraManager: () => ({ listInstances: () => selected }),
    listProjectRegistrations: () => [], getRunningStacks: () => [] };
  return new BackupService({ logger } as never, store, projects as never);
}
beforeEach(() => {
  state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-scope-'));
  store = new DaemonStateStore(logger as never, path.join(state.home, 'state.db'));
  state.copy.mockReset().mockImplementation(async (_target, destination) => fs.writeFileSync(destination, 'qualified-test-backup'));
  state.restore.mockReset().mockResolvedValue(undefined);
  state.inventory.mockReset().mockImplementation(async (scope, names) => {
    const target = targets.find(item => item.project === scope.project)!;
    return [{ id: target.id, name: names[0] }];
  });
});
afterEach(async () => { vi.restoreAllMocks(); await store.dispose(); fs.rmSync(state.home, { recursive: true, force: true }); });

describe('artifact backups belong to one allocation', () => {
  it('backs up a quiesced stack through its retained infrastructure and immutable ID', async () => {
    const backup = await service().createArtifactBackup({ kind: 'storage-objects', project: 'two', stack: 'dev', bucket: 'uploads' });
    expect(backup).toMatchObject({ project: 'two', stack: 'dev', bucket: 'uploads', scope: 'stack' });
    expect(state.copy.mock.calls[0]![0]).toEqual({ container: targets[1]!.id, accessKey: 'two', secretKey: 'two-secret', bucket: 'uploads' });
    expect(JSON.parse(store.selectBackupsSync()[0]!.metadata!)).toMatchObject({ project: 'two', stack: 'dev', bucket: 'uploads' });
  });
  it('rejects an ambiguous legacy target before any transfer', async () => {
    await expect(service().createStorageBackup()).rejects.toThrow(/one\/dev, two\/dev/);
    expect(state.copy).not.toHaveBeenCalled(); expect(state.inventory).not.toHaveBeenCalled();
  });
  it('does not redirect an unavailable explicit stack to another one', async () => {
    await expect(service().createArtifactBackup({ kind: 'storage-objects', project: 'missing', stack: 'dev', bucket: 'storage' })).rejects.toThrow('missing/dev/minio');
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('does not copy when the inspected container is absent or its ownership cannot be confirmed', async () => {
    state.inventory.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('allocation changed'));
    for (let i = 0; i < 2; i++) await expect(service([targets[0]!]).createStorageBackup()).rejects.toThrow();
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('requires a bucket in the public API rather than silently choosing storage', async () => {
    await expect(service().createArtifactBackup({ kind: 'storage-objects', project: 'one', stack: 'dev' } as never)).rejects.toThrow('bucket');
    expect(state.copy).not.toHaveBeenCalled();
  });
  it('restores the recorded stack and bucket despite a different first allocation', async () => {
    const backups = service();
    const info = await backups.createArtifactBackup({ kind: 'storage-objects', project: 'two', stack: 'dev', bucket: 'uploads' });
    await backups.restoreBackup(info.id);
    expect(state.restore.mock.calls[0]![0]).toMatchObject({ container: targets[1]!.id, bucket: 'uploads' });
  });
  it('refuses to restore an origin whose infrastructure is no longer present', async () => {
    const info = await service().createArtifactBackup({ kind: 'storage-objects', project: 'two', stack: 'dev', bucket: 'storage' });
    await expect(service([targets[0]!]).restoreBackup(info.id)).rejects.toThrow('two/dev/minio');
    expect(state.restore).not.toHaveBeenCalled();
  });
  it('records no successful backup after a failed object transfer', async () => {
    state.copy.mockRejectedValue(new Error('mirror failed'));
    await expect(service([targets[0]!]).createStorageBackup()).rejects.toThrow('mirror failed');
    expect(store.selectBackupsSync()).toEqual([]);
  });
  it('a full pass covers every declared bucket and names each failed allocation', async () => {
    const backups = service();
    vi.spyOn(backups, 'createBackup').mockRejectedValue(new Error('no control plane in this test'));
    vi.spyOn(backups, 'createSecretsBackup').mockRejectedValue(new Error('no daemon in this test'));
    state.copy.mockImplementation(async (target, destination) => {
      if (target.accessKey === 'two') throw new Error('object source unavailable');
      fs.writeFileSync(destination, 'test');
    });
    const result = await backups.createFullBackup();
    expect(result.filter(item => item.ok)).toHaveLength(2);
    expect(result).toContainEqual(expect.objectContaining({ project: 'two', stack: 'dev', target: 'storage-objects/uploads', ok: false }));
    expect(store.kvGetSync('backup:last-pass')).toMatchObject({ full: { outcome: 'partial', failures: expect.arrayContaining([
      expect.objectContaining({ target: 'two/dev/storage-objects/uploads' }),
    ]) } });
  });
  it('retention keeps each bucket independently', async () => {
    const backups = service([targets[0]!]);
    for (const bucket of ['storage', 'uploads', 'storage', 'uploads']) await backups.createStorageBackup(undefined, bucket);
    await (backups as unknown as { pruneOldBackups(database: string, keep: number): Promise<void> }).pruneOldBackups('storage-objects', 1);
    expect((await backups.listBackups()).map(item => item.bucket).sort()).toEqual(['storage', 'uploads']);
  });
  it('records a broken inventory without abandoning the remaining allocations', async () => {
    const broken = { ...targets[0]!, infra: { ...targets[0]!.infra, getMinioBuckets() { throw new Error('bad bucket declaration'); } } };
    const backups = service([broken, targets[1]!]);
    vi.spyOn(backups, 'createBackup').mockRejectedValue(new Error('no control plane in this test'));
    vi.spyOn(backups, 'createSecretsBackup').mockRejectedValue(new Error('no daemon in this test'));
    const results = await backups.createFullBackup();
    expect(results).toContainEqual(expect.objectContaining({ project: 'one', target: 'storage-objects', ok: false, error: 'bad bucket declaration' }));
    expect(results.filter(item => item.ok)).toHaveLength(2);
  });
  it('keeps scheduled retention inside the handoff fence', async () => {
    const backups = service([targets[0]!]);
    let finish!: () => void;
    const delayed = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(backups, 'createAllBackups').mockResolvedValue([]);
    const internal = backups as unknown as { pruneOldBackups(): Promise<void>; runScheduledBackup(name: string): Promise<string> };
    vi.spyOn(internal, 'pruneOldBackups').mockImplementation(() => delayed);
    const operation = internal.runScheduledBackup('all');
    await Promise.resolve();
    expect(backups.activeOperationCount()).toBe(1);
    expect(() => backups.prepareHandoff()).toThrow('Backup or restore is active');
    finish(); await operation;
    backups.prepareHandoff();
    await expect(backups.setSchedule('all', 'hourly')).rejects.toThrow('paused');
    expect(await backups.listSchedules()).toEqual({});
    await expect(internal.runScheduledBackup('all')).resolves.toBe('empty');
    await backups.resumeAfterHandoff();
    await backups.setSchedule('all', 'hourly');
    backups.prepareHandoff();
    expect((await backups.getStatus()).schedules[0]?.armed).toBe(false);
    await backups.resumeAfterHandoff();
    expect((await backups.getStatus()).schedules[0]?.armed).toBe(true);
    backups.dispose();
  });
  it('refuses handoff while a copy is active, then fences new admission until abort resumes it', async () => {
    const backups = service([targets[0]!]);
    let finish!: () => void;
    const delayed = new Promise<void>(resolve => { finish = resolve; });
    state.copy.mockImplementation(async (_target, destination) => { await delayed; fs.writeFileSync(destination, 'test'); });
    const operation = backups.createStorageBackup();
    expect(backups.activeOperationCount()).toBe(1);
    expect(() => backups.prepareHandoff()).toThrow('Backup or restore is active');
    finish(); await operation;
    expect(backups.activeOperationCount()).toBe(0);
    backups.prepareHandoff();
    await expect(backups.createStorageBackup()).rejects.toThrow('paused');
    await backups.resumeAfterHandoff();
    await expect(backups.createStorageBackup()).resolves.toMatchObject({ project: 'one' });
  });
});
