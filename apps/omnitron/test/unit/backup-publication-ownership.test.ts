import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const state = vi.hoisted(() => ({ home: '', dump: vi.fn<(...args: unknown[]) => Promise<void>>() }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), get OMNITRON_HOME() { return state.home; },
}));
vi.mock('../../src/services/backup-pipeline.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), dumpToFile: state.dump,
}));
const { dumpToFile } = await vi.importActual<typeof import('../../src/services/backup-pipeline.js')>('../../src/services/backup-pipeline.js');
const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const logger = createNullLogger();
let store: InstanceType<typeof DaemonStateStore>;
let backups: InstanceType<typeof BackupService>;

function destination(): string { return state.dump.mock.calls[0]![2] as string; }
const runProducer = (output: string, compress: boolean) => dumpToFile(process.execPath,
  ['-e', 'process.stdout.end("verified harmless backup bytes")'], output, compress);

beforeEach(() => {
  state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-publication-'));
  store = new DaemonStateStore(logger, path.join(state.home, 'state.db'));
  const infra = {
    getPostgresDatabases: () => ['main'],
    getConnectionInfo: () => ({ host: '127.0.0.1', port: 5432, user: 'test', password: 'test' }),
    getResolvedContainerName: () => 'never-executed-test-container',
  };
  const projects = {
    listProjectRegistrations: () => [{ name: 'example' }], getRunningStacks: () => ['dev'],
    getInfraManager: () => ({ getInstance: () => infra, listInstances: () => [{ project: 'example', stack: 'dev', infra }] }),
  };
  backups = new BackupService({ logger } as never, store, projects as never);
  state.dump.mockReset().mockImplementation(async (_command, _args, output, compress) => {
    await runProducer(output as string, compress as boolean);
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  backups.dispose();
  await store.dispose();
  fs.rmSync(state.home, { recursive: true, force: true });
});

describe('database backup publication ownership', () => {
  it('does not delete an existing destination refused by the real pipeline', async () => {
    state.dump.mockImplementation(async (_command, _args, output, compress) => {
      fs.writeFileSync(output as string, 'another writer owns this destination', { flag: 'wx' });
      await runProducer(output as string, compress as boolean);
    });
    await expect(backups.createBackup('example/dev/main')).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(destination(), 'utf8')).toBe('another writer owns this destination');
    expect(store.selectBackupsSync()).toEqual([]);
  });

  it('preserves a completed destination when publication acknowledgement is lost', async () => {
    state.dump.mockImplementation(async (_command, _args, output, compress) => {
      await runProducer(output as string, compress as boolean);
      throw new Error('publication acknowledgement unavailable');
    });
    const error = await backups.createBackup('example/dev/main').then(() => undefined, reason => reason as Error);
    expect(gunzipSync(fs.readFileSync(destination())).toString()).toBe('verified harmless backup bytes');
    expect(store.selectBackupsSync()).toEqual([]);
    expect(error?.message).toContain('Publication was not confirmed');
  });

  it('retains a durable complete orphan when the index write fails before insertion', async () => {
    vi.spyOn(store, 'insertBackupSync').mockImplementation(() => { throw new Error('index unavailable'); });
    const error = await backups.createBackup('example/dev/main').then(() => undefined, reason => reason as Error);
    expect(gunzipSync(fs.readFileSync(destination())).toString()).toBe('verified harmless backup bytes');
    expect(store.selectBackupsSync()).toEqual([]);
    expect(error?.message).toContain('Complete backup file retained');
    expect(error?.message).toContain('index completion was not confirmed');
    expect(error?.message).toContain(destination());
    expect(error?.cause).toMatchObject({ message: 'index unavailable' });
  });

  it('does not destroy an indexed backup after an ambiguous committed index write', async () => {
    const insert = store.insertBackupSync.bind(store);
    vi.spyOn(store, 'insertBackupSync').mockImplementation(row => {
      insert(row);
      throw new Error('index acknowledgement unavailable');
    });
    const error = await backups.createBackup('example/dev/main').then(() => undefined, reason => reason as Error);
    const rows = store.selectBackupsSync();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.path).toBe(destination());
    expect(gunzipSync(fs.readFileSync(destination())).toString()).toBe('verified harmless backup bytes');
    expect(error?.message).toContain('index completion was not confirmed');
  });
});
