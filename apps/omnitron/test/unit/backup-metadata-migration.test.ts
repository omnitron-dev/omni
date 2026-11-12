import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const fixture = vi.hoisted(() => ({ home: '' }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), get OMNITRON_HOME() { return fixture.home; },
}));
const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const logger = createNullLogger();
let store: InstanceType<typeof DaemonStateStore>;
let service: InstanceType<typeof BackupService> | undefined;
const otherStores: Array<InstanceType<typeof DaemonStateStore>> = [];
const info = { id: 'historical-backup', database: 'main', filename: 'historical.sql.gz',
  createdAt: '2020-01-02T03:04:05.000Z', compressed: true, size: 14 };
const directory = () => path.join(fixture.home, 'backups');
const sidecar = () => path.join(directory(), info.filename + '.meta.json');
const archive = () => path.join(directory(), info.filename);
const row = () => ({ id: info.id, app: info.database, path: archive(), size_bytes: info.size,
  created_at: info.createdAt, metadata: { filename: info.filename, compressed: info.compressed } });
const start = () => { service = new BackupService({ logger } as never, store); return service; };
const synchronous = () => store.initSync().pragma('synchronous', { simple: true });
const preserved = () => expect(JSON.parse(fs.readFileSync(sidecar(), 'utf8'))).toEqual(info);

beforeEach(() => {
  fixture.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-history-'));
  store = new DaemonStateStore(logger, path.join(fixture.home, 'state.db'));
  store.initSync();
  fs.mkdirSync(directory());
  fs.writeFileSync(archive(), 'backup payload');
  fs.writeFileSync(sidecar(), JSON.stringify(info));
});
afterEach(async () => {
  vi.restoreAllMocks();
  service?.dispose(); service = undefined;
  for (const other of otherStores.splice(0)) {
    if (other.initSync().inTransaction) other.initSync().exec('ROLLBACK');
    await other.dispose();
  }
  store.initSync().pragma('query_only = OFF');
  await store.dispose();
  fs.rmSync(fixture.home, { recursive: true, force: true });
});

describe('backup metadata transfers to the existing SQLite index', () => {
  it('commits the complete record with FULL durability before removing its sidecar', () => {
    const insert = store.insertBackupSync.bind(store);
    const modes: unknown[] = [];
    vi.spyOn(store, 'insertBackupSync').mockImplementation(value => {
      modes.push(synchronous());
      insert(value);
    });
    const previous = synchronous();
    start();
    expect(modes).toEqual([2]);
    expect(synchronous()).toBe(previous);
    expect(store.selectBackupsSync()).toEqual([{ ...row(), metadata: JSON.stringify(row().metadata) }]);
    expect(fs.existsSync(sidecar())).toBe(false);
    expect(fs.readFileSync(archive(), 'utf8')).toBe('backup payload');
  });

  it('retains metadata on a real SQLite readonly failure and retries on the same service', async () => {
    const warnings = vi.spyOn(logger, 'warn');
    const previous = synchronous();
    store.initSync().pragma('query_only = ON');
    const backups = start();
    preserved();
    expect(store.selectBackupsSync()).toEqual([]);
    expect(synchronous()).toBe(previous);
    expect(warnings.mock.calls.some(call => JSON.stringify(call).includes('readonly'))).toBe(true);
    store.initSync().pragma('query_only = OFF');
    expect(await backups.listBackups()).toHaveLength(1);
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it('rolls back an insertion when its confirming read fails, retaining a retryable sidecar', async () => {
    const read = store.selectBackupsSync.bind(store);
    let fail = true;
    vi.spyOn(store, 'selectBackupsSync').mockImplementation(app => {
      const rows = read(app);
      if (fail && rows.some(item => item.id === info.id)) throw new Error('index read unavailable');
      return rows;
    });
    const previous = synchronous();
    const backups = start();
    preserved();
    expect(read()).toEqual([]);
    expect(synchronous()).toBe(previous);
    fail = false;
    expect(await backups.listBackups()).toHaveLength(1);
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it('preserves the sidecar when SQLite rejects the transaction commit', async () => {
    const db = store.initSync();
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE history_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE history_child (parent INTEGER REFERENCES history_parent(id) DEFERRABLE INITIALLY DEFERRED);
      CREATE TRIGGER reject_history_commit AFTER INSERT ON backups BEGIN
        INSERT INTO history_child(parent) VALUES (42);
      END;
    `);
    const previous = synchronous();
    const backups = start();
    preserved();
    expect(store.selectBackupsSync()).toEqual([]);
    expect(db.inTransaction).toBe(false);
    expect(synchronous()).toBe(previous);
    db.exec('DROP TRIGGER reject_history_commit');
    expect(await backups.listBackups()).toHaveLength(1);
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it('accepts only an exact existing record, including semantic metadata equality', () => {
    store.insertBackupSync({ ...row(), metadata: { compressed: true, filename: info.filename } });
    const previous = store.selectBackupsSync();
    start();
    expect(store.selectBackupsSync()).toEqual(previous);
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it.each(['app', 'path', 'size_bytes', 'created_at', 'metadata'] as const)('retains a sidecar whose ID conflicts in %s', async field => {
    const other = { ...row() };
    if (field === 'app') other.app = 'other-database';
    if (field === 'path') { other.path = path.join(directory(), 'other.sql'); fs.writeFileSync(other.path, 'other'); }
    if (field === 'size_bytes') other.size_bytes += 1;
    if (field === 'created_at') other.created_at = '2021-01-01T00:00:00.000Z';
    if (field === 'metadata') other.metadata = { ...other.metadata, compressed: false };
    store.insertBackupSync(other);
    const existing = store.selectBackupsSync();
    const warnings = vi.spyOn(logger, 'warn');
    const backups = start();
    preserved();
    expect(store.selectBackupsSync()).toEqual(existing);
    expect(warnings.mock.calls.some(call => JSON.stringify(call).includes('conflict'))).toBe(true);
    store.deleteBackupSync(info.id);
    expect(await backups.listBackups()).toHaveLength(1);
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it('retains a durably indexed sidecar on unlink failure and retries without replacing its row', async () => {
    const unlink = fs.unlinkSync;
    const fault = vi.spyOn(fs, 'unlinkSync').mockImplementation(name => {
      if (String(name) === sidecar()) throw new Error('metadata unlink refused');
      unlink(name);
    });
    const warnings = vi.spyOn(logger, 'warn');
    const backups = start();
    preserved();
    const rows = store.selectBackupsSync();
    expect(rows).toHaveLength(1);
    expect(warnings.mock.calls.some(call => JSON.stringify(call).includes('metadata unlink refused'))).toBe(true);
    fault.mockRestore();
    await backups.listBackups();
    expect(store.selectBackupsSync()).toEqual(rows);
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it('retains the last sidecar when an existing NORMAL commit cannot be checkpointed', async () => {
    const reader = new DaemonStateStore(logger, store.dbPath);
    otherStores.push(reader);
    reader.initSync().exec('BEGIN');
    reader.selectBackupsSync();
    store.insertBackupSync(row());
    store.initSync().pragma('busy_timeout = 20');
    const previous = synchronous();
    const backups = start();
    preserved();
    expect(synchronous()).toBe(previous);
    reader.initSync().exec('ROLLBACK');
    await backups.listBackups();
    expect(fs.existsSync(sidecar())).toBe(false);
  });

  it('does not unlink a sidecar replaced while its previous record was being imported', () => {
    const replacement = { ...info, id: 'replacement-history' };
    const insert = store.insertBackupSync.bind(store);
    vi.spyOn(store, 'insertBackupSync').mockImplementation(value => {
      insert(value);
      const temporary = sidecar() + '.new';
      fs.writeFileSync(temporary, JSON.stringify(replacement));
      fs.renameSync(temporary, sidecar());
    });
    start();
    expect(JSON.parse(fs.readFileSync(sidecar(), 'utf8'))).toEqual(replacement);
    expect(store.selectBackupsSync().map(item => item.id)).toEqual([info.id]);
  });
});
