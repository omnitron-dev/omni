import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('../../src/config/defaults.js', async importOriginal => ({
  ...await importOriginal<Record<string, unknown>>(), get OMNITRON_HOME() { return state.home; },
}));
const { BackupService } = await import('../../src/services/backup.service.js');
const { DaemonStateStore } = await import('../../src/daemon/daemon-state-store.service.js');

// Opt into an already cached image. No host ports, application volumes or pulls.
const image = process.env['OMNITRON_TEST_POSTGRES_IMAGE'];
const exec = promisify(execFile);
describe.skipIf(!image)('PostgreSQL backup and restore through the public service', () => {
  const name = `omnitron-backup-pg-${randomUUID()}`;
  const database = 'backup_regression';
  const user = 'fixture';
  const password = randomUUID();
  const env = { ...process.env, POSTGRES_PASSWORD: password, PGPASSWORD: password };
  const logger = { info: vi.fn<(context: unknown, message: string) => void>(), warn() {}, error() {}, debug() {}, child() { return this; } };
  let container: string | undefined;
  let store: InstanceType<typeof DaemonStateStore> | undefined;
  let backups: InstanceType<typeof BackupService>;

  async function docker(args: string[]): Promise<string> {
    try { return (await exec('docker', args, { env, timeout: 15_000, maxBuffer: 1024 * 1024 })).stdout; }
    catch (error) { throw new Error(String((error as Error).message).split(password).join('[redacted]')); }
  }
  const sql = (query: string) => docker(['exec', container!, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
    '-U', user, '-d', database, '-At', '-c', query]);

  beforeAll(async () => {
    state.home = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-postgres-'));
    container = (await docker(['create', '--pull=never', '--name', name,
      '--label', `omnitron.backup-test=${name}`, '--network', 'none', '--cpus', '0.5', '--memory', '256m', '--pids-limit', '64',
      '--read-only', '--tmpfs', '/var/lib/postgresql/data:rw,size=134217728',
      '--tmpfs', '/var/run/postgresql:rw,size=8388608,mode=1777', '--tmpfs', '/tmp:rw,size=16777216,mode=1777',
      '-e', 'POSTGRES_PASSWORD', '-e', 'PGPASSWORD', '-e', `POSTGRES_USER=${user}`, '-e', `POSTGRES_DB=${database}`,
      '-e', 'PSQLRC=/tmp/restore-test.psqlrc', image!,
      '-c', 'shared_buffers=16MB', '-c', 'max_connections=10', '-c', 'max_wal_size=32MB', '-c', 'min_wal_size=32MB',
      '-c', 'listen_addresses=127.0.0.1'])).trim();
    expect(container).toMatch(/^[a-f0-9]{64}$/);
    await docker(['start', container]);
    // The image's temporary initialization server has no TCP listener. This
    // checks the final server, rather than racing its shutdown during initdb.
    await vi.waitFor(async () => {
      expect((await docker(['exec', container!, 'psql', '-X', '-h', '127.0.0.1', '-U', user,
        '-d', database, '-At', '-c', 'SELECT current_database()'])).trim()).toBe(database);
    }, { timeout: 60_000, interval: 250 });

    store = new DaemonStateStore(logger as never, path.join(state.home, 'state.db'));
    const infra = { getConnectionInfo: () => ({ host: '127.0.0.1', port: 5432, user, password }),
      getResolvedContainerName: () => container, getPostgresDatabases: () => [database] };
    const projects = { listProjectRegistrations: () => [{ name: 'fixture' }], getRunningStacks: () => ['private'],
      getInfraManager: () => ({ listInstances: () => [], getInstance: () => infra }) };
    backups = new BackupService({ logger } as never, store, projects as never);
    backups.configure({ databaseTimeoutMs: 30_000 });

    await sql('CREATE TABLE startup_side_effect (value text)');
    await docker(['exec', container, 'sh', '-c', 'umask 077; printf "%s" "$1" > /tmp/restore-test.psqlrc',
      'startup-fixture', "\\set ON_ERROR_STOP off\nINSERT INTO startup_side_effect VALUES ('psqlrc');\n"]);
    // Prove the hostile startup file is used by bare psql, then clear its effect.
    await docker(['exec', container, 'psql', '-U', user, '-d', database, '-At', '-c', 'SELECT 1']);
    expect((await sql('SELECT count(*) FROM startup_side_effect')).trim()).toBe('1');
    await sql('TRUNCATE startup_side_effect');
  }, 90_000);

  afterAll(async () => {
    backups?.dispose();
    await store?.dispose();
    if (container && /^[a-f0-9]{64}$/.test(container)) {
      expect((await docker(['inspect', container, '--format', '{{ index .Config.Labels "omnitron.backup-test" }}'])).trim()).toBe(name);
      await docker(['rm', '--force', container]);
      expect((await docker(['ps', '-aq', '--no-trunc', '--filter', `id=${container}`])).trim()).toBe('');
    }
    if (state.home) fs.rmSync(state.home, { recursive: true, force: true });
  });

  function archive(source: string, compressed: boolean): string {
    const id = randomUUID();
    const filename = `${id}.sql${compressed ? '.gz' : ''}`;
    const location = path.join(state.home, 'backups', filename);
    fs.writeFileSync(location, compressed ? gzipSync(source) : source, { mode: 0o600 });
    store!.insertBackupSync({ id, app: database, path: location, size_bytes: fs.statSync(location).size,
      created_at: new Date().toISOString(), metadata: { filename, compressed, type: 'postgres', project: 'fixture', stack: 'private' } });
    return id;
  }

  it.each([false, true])('stops on SQL failure without reporting success or executing the remaining SQL (compressed=%s)', async compressed => {
    const prefix = compressed ? 'compressed' : 'plain';
    const id = archive(`CREATE TABLE ${prefix}_before (value int);\nSELECT 1/0;\nCREATE TABLE ${prefix}_after (value int);\n`, compressed);
    logger.info.mockClear();
    await expect(backups.restoreBackup(id)).rejects.toThrow(/division by zero/);
    expect((await sql(`SELECT to_regclass('${prefix}_before') IS NOT NULL, to_regclass('${prefix}_after') IS NULL`)).trim()).toBe('t|t');
    expect((await sql('SELECT count(*) FROM startup_side_effect')).trim()).toBe('0');
    expect(logger.info.mock.calls.some(([, message]) => message === 'Backup restored')).toBe(false);
    expect(backups.activeOperationCount()).toBe(0);
  });

  it('round-trips a real compressed pg_dump and ignores psql startup files', async () => {
    await sql('DROP TABLE IF EXISTS plain_before, compressed_before');
    await sql("CREATE TABLE restore_values (id int PRIMARY KEY, value text); INSERT INTO restore_values VALUES (1, 'Привет'), (2, 'line one' || chr(10) || 'line two')");
    const backup = await backups.createBackup(`fixture/private/${database}`);
    await sql('DROP TABLE restore_values, startup_side_effect');
    await backups.restoreBackup(backup.id);
    expect(JSON.parse(await sql('SELECT json_agg(t ORDER BY id) FROM restore_values t'))).toEqual(
      [{ id: 1, value: 'Привет' }, { id: 2, value: 'line one\nline two' }]);
    expect((await sql('SELECT count(*) FROM startup_side_effect')).trim()).toBe('0');
  });
});
