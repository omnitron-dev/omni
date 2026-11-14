import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), get OMNITRON_HOME() { return state.home; },
}));
const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');
const { savedDaemonOverrides } = await import('../../src/config/saved.js');
const logger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };
let store: InstanceType<typeof DaemonStateStore>;
let backups: InstanceType<typeof BackupService>;

beforeEach(() => {
  state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-deadline-'));
  store = new DaemonStateStore(logger as never, path.join(state.home, 'state.db'));
});
afterEach(async () => {
  backups?.dispose();
  vi.unstubAllEnvs();
  await store.dispose();
  fs.rmSync(state.home, { recursive: true, force: true });
});

function service(docker = false) {
  const infra = { getConnectionInfo: () => ({ host: '127.0.0.1', port: 1, user: 'fixture', password: 'fixture' }),
    getResolvedContainerName: () => docker ? 'private-test-fixture' : null, getPostgresDatabases: () => ['ledger'] };
  const projects = { listProjectRegistrations: () => [{ name: 'fixture' }], getRunningStacks: () => ['dev'],
    getInfraManager: () => ({ listInstances: () => [], getInstance: () => infra }) };
  backups = new BackupService({ logger } as never, store, projects as never);
  return backups;
}

describe('persisted database transfer deadline', () => {
  it('reports its effective default and validates saved policy before replacing it', async () => {
    const backup = service();
    expect((await backup.getStatus()).databaseTimeoutMs).toBe(1_800_000);
    const config = savedDaemonOverrides({ role: 'master', initialized: true, initializedAt: '2026-11-14',
      backups: { databaseTimeoutMs: 3_600_000 } });
    backup.configure(config.backups);
    for (const invalid of [0, -1, 0.5, NaN, Infinity, 86_400_001, null, '60000']) {
      expect(() => backup.configure({ databaseTimeoutMs: invalid as number })).toThrow(/timeout/);
      expect((await backup.getStatus()).databaseTimeoutMs).toBe(3_600_000);
    }
    expect(() => backup.configure(null as never)).toThrow(/configuration object/);
    await backup.setSchedule('all', 'hourly');
    expect(() => backup.configure({ databaseTimeoutMs: 60_000 })).toThrow(/before starting/);
  });

  it.skipIf(process.platform === 'win32').each([false, true])('enforces dump and restore deadlines through the public service (Docker=%s)', async docker => {
    // Synthetic commands exercise real streams, process cleanup and the backup
    // index without opening a database or addressing a running Docker service.
    const commands = path.join(state.home, 'bin');
    fs.mkdirSync(commands);
    const program = `#!${process.execPath}
const restore = process.argv.includes('psql') || process.argv[1].endsWith('/psql');
const done = () => setTimeout(() => { if (!restore) process.stdout.write('SELECT 1;\\n'); }, Number(process.env.OMNI_BACKUP_FIXTURE_DELAY));
if (restore) { process.stdin.resume(); process.stdin.on('end', done); } else done();
`;
    for (const name of ['docker', 'pg_dump', 'psql']) fs.writeFileSync(path.join(commands, name), program, { mode: 0o700 });
    vi.stubEnv('PATH', `${commands}${path.delimiter}${process.env['PATH']}`);
    vi.stubEnv('OMNI_BACKUP_FIXTURE_DELAY', '0');
    const backup = service(docker);
    backup.configure({ databaseTimeoutMs: 5_000 });
    const record = await backup.createBackup('fixture/dev/ledger');
    await backup.restoreBackup(record.id);
    expect((await backup.listBackups()).map(item => item.id)).toEqual([record.id]);

    backup.configure({ databaseTimeoutMs: 300 });
    vi.stubEnv('OMNI_BACKUP_FIXTURE_DELAY', '5000');
    const dumping = backup.createBackup('fixture/dev/ledger');
    expect(() => backup.configure({ databaseTimeoutMs: 5_000 })).toThrow(/before starting/);
    await expect(dumping).rejects.toThrow(/300 ms deadline/);
    await expect(backup.restoreBackup(record.id)).rejects.toThrow(/300 ms deadline/);
    expect(backup.activeOperationCount()).toBe(0);
    expect((await backup.listBackups()).map(item => item.id)).toEqual([record.id]);
    expect(fs.readdirSync(path.join(state.home, 'backups')).filter(name => name.endsWith('.partial'))).toEqual([]);
  });
});
