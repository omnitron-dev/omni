import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { DockerTestManager, type DockerContainer } from '@omnitron-dev/testing/docker';
import { DatabaseManager, sql, type DatabaseConnection } from '@omnitron-dev/titan-database';
import { MigrationRunner } from '@omnitron-dev/titan-database/migration';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
// Exercise the compiled package entry, including migration and public type exports.
import { LiveEditService, lumenAuthoringMigration, type LumenAuthoringDatabase } from '@omnitron-dev/titan-lumen';

const author = { userId: 'postgres-qualified-author', roles: ['admin'] };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const managers: DatabaseManager[] = [];
let docker: DockerTestManager;
let container: DockerContainer | undefined;
let connection: DatabaseConnection;
let dataDirectory: string | undefined;
const network = 'lumen-authoring-' + randomUUID();

async function connect(options: { coerceBigint?: boolean } = {}) {
  const manager = new DatabaseManager({ connection: { ...connection, ...options } }, createNullLogger());
  managers.push(manager);
  await manager.init();
  return manager;
}

async function closeConnections() {
  const results = await Promise.allSettled(managers.splice(0).map(manager => manager.closeAll()));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'Unable to close PostgreSQL qualification connections');
}

beforeAll(async () => {
  const root = process.env['LUMEN_POSTGRES_DATA_ROOT'];
  if (!root || !isAbsolute(root)) throw new Error('Set LUMEN_POSTGRES_DATA_ROOT to an existing absolute test storage directory');
  await access(root);
  dataDirectory = await mkdtemp(join(root, 'authoring-'));
  // Explicit lifecycle avoids the global orphan reaper on a shared development host.
  docker = DockerTestManager.getInstance({ cleanup: false, startupTimeout: 60_000 });
  container = await docker.createContainer({
    name: network,
    image: 'postgres:16-alpine',
    ports: { 5432: 'auto' },
    networks: [network],
    volumes: [dataDirectory + ':/var/lib/postgresql/data'],
    resources: { memoryBytes: 512 * 1024 * 1024, cpus: 1, pidsLimit: 128 },
    environment: { POSTGRES_DB: 'lumen_qualification', POSTGRES_USER: 'lumen_test', POSTGRES_PASSWORD: randomUUID() },
    command: ['postgres', '-c', 'shared_buffers=32MB', '-c', 'max_connections=24',
      '-c', 'fsync=on', '-c', 'synchronous_commit=on', '-c', 'full_page_writes=on'],
    healthcheck: { test: ['CMD', 'pg_isready', '-h', '127.0.0.1', '-U', 'lumen_test', '-d', 'lumen_qualification'], interval: '1s', timeout: '3s', retries: 30 },
    waitFor: { healthcheck: true, timeout: 60_000 },
  });
  connection = { dialect: 'postgres', connection: {
    host: container.host, port: container.ports.get(5432)!, database: 'lumen_qualification', user: 'lumen_test',
    password: container.environment['POSTGRES_PASSWORD']!,
  }, pool: { max: 1, acquireTimeoutMillis: 5000, idleTimeoutMillis: 1000 } };
  const manager = await connect();
  await expect(new LiveEditService({ corpusId: 'before-migration' }, manager).getDocument('guide.pdx')).rejects.toThrow('lumen_documents');
  await new MigrationRunner(await manager.getConnection<LumenAuthoringDatabase>(), [lumenAuthoringMigration], {
    useTransactions: true, enforceChecksums: true,
  }).up();
  await closeConnections();
});

afterEach(closeConnections);
afterAll(async () => {
  try { await closeConnections(); }
  finally {
    try { await docker?.cleanupAll(); }
    finally { if (dataDirectory) await rm(dataDirectory, { recursive: true, force: true }); }
  }
});

describe('durable authoring on real PostgreSQL', () => {
  it('uses the migrated PostgreSQL engine with isolated storage and enforced resource limits', async () => {
    const manager = await connect();
    expect(manager.getDialect()).toBe('postgres');
    const db = await manager.getConnection<LumenAuthoringDatabase>();
    const settings = await sql<{ engine: string; fsync: string; sync: string }>`select version() as engine, current_setting('fsync') as fsync, current_setting('synchronous_commit') as sync`.execute(db);
    expect(settings.rows[0]).toMatchObject({ engine: expect.stringContaining('PostgreSQL 16.'), fsync: 'on', sync: 'on' });
    await new MigrationRunner(db, [lumenAuthoringMigration], { useTransactions: true, enforceChecksums: true }).up();
    expect(await db.selectFrom('lumen_documents').selectAll().execute()).toEqual([]);
    const inspected = JSON.parse(execFileSync('docker', ['inspect', container!.name], { encoding: 'utf8' }))[0];
    expect(inspected.HostConfig).toMatchObject({ Memory: 512 * 1024 * 1024, NanoCpus: 1_000_000_000, PidsLimit: 128 });
    expect(inspected.HostConfig.PortBindings['5432/tcp']).toMatchObject([{ HostIp: '127.0.0.1' }]);
    expect(Object.keys(inspected.NetworkSettings.Networks)).toEqual([network]);
    expect(inspected.Mounts).toMatchObject([{ Type: 'bind', Source: dataDirectory, Destination: '/var/lib/postgresql/data' }]);
    for (const resources of [{ cpus: 0 }, { cpus: Number.NaN }, { memoryBytes: 1 }, { pidsLimit: -1 }])
      await expect(docker.createContainer({ image: 'postgres:16-alpine', resources })).rejects.toThrow(RangeError);
  });

  it('lets one independent connection win first ownership and each subsequent revision CAS', async () => {
    const peers = await Promise.all(Array.from({ length: 8 }, () => connect()));
    const pids = await Promise.all(peers.map(async manager => (await sql<{ pid: number }>`select pg_backend_pid() as pid`
      .execute(await manager.getConnection())).rows[0]!.pid));
    expect(new Set(pids).size).toBe(8);
    const services = peers.map(manager => new LiveEditService({ corpusId: 'connection-race' }, manager));
    const events = services.map(service => { const event = vi.fn(); service.on('live-edit', event); return event; });
    const seed = '# Initial source\nOriginal disk seed.';
    const initial = await Promise.all(services.map((service, index) => service.applyEdit({
      docId: 'race.pdx', patch: 'claim ' + index, baseRevision: 0, baseHash: hash(seed),
    }, author, seed)));
    expect(initial.filter(result => result.success)).toHaveLength(1);
    expect(initial.filter(result => result.conflict)).toHaveLength(7);
    const first = initial.find(result => result.success)!;
    const edits = await Promise.all(services.map((service, index) => service.applyEdit({
      docId: 'race.pdx', patch: 'edit ' + index, baseRevision: 1, baseHash: first.hash!,
    }, author, 'A later filesystem version')));
    expect(edits.filter(result => result.success)).toHaveLength(1);
    expect(edits.filter(result => result.conflict)).toHaveLength(7);
    for (const [index, event] of events.entries())
      expect(event).toHaveBeenCalledTimes(Number(initial[index]!.success) + Number(edits[index]!.success));
    const current = await services[0]!.getDocument('race.pdx');
    expect(current).toMatchObject({ revision: 2, hash: edits.find(result => result.success)!.hash, origin: 'disk', seedHash: hash(seed) });
    expect((await services[0]!.getHistory('race.pdx', author)).map(version => version.revision)).toEqual([2, 1, 0]);
  });

  it('rolls back both tables and sends no event when a deferred constraint rejects COMMIT', async () => {
    const manager = await connect();
    const live = new LiveEditService({ corpusId: 'commit-failure' }, manager);
    const first = await live.applyEdit({ docId: 'commit.pdx', patch: 'committed seed', baseRevision: 0, baseHash: hash('') }, author);
    const db = await manager.getConnection<LumenAuthoringDatabase>();
    await sql.raw('CREATE TABLE commit_parent (id integer PRIMARY KEY)').execute(db);
    await sql.raw('CREATE TABLE commit_child (parent integer REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED)').execute(db);
    await sql.raw(`CREATE FUNCTION fail_lumen_commit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.corpus = 'commit-failure' AND NEW.revision = 2 THEN INSERT INTO commit_child VALUES (999); END IF; RETURN NEW; END $$`).execute(db);
    await sql.raw('CREATE TRIGGER fail_commit AFTER INSERT ON lumen_document_revisions FOR EACH ROW EXECUTE FUNCTION fail_lumen_commit()').execute(db);
    const event = vi.fn(); live.on('live-edit', event);
    const payload = { docId: 'commit.pdx', patch: 'uncommitted edit', baseRevision: 1, baseHash: first.hash! };
    await expect(live.applyEdit(payload, author)).rejects.toMatchObject({ code: '23503' });
    expect(event).not.toHaveBeenCalled();
    expect(await live.getDocument('commit.pdx')).toMatchObject({ revision: 1, content: 'committed seed', hash: first.hash });
    expect((await live.getHistory('commit.pdx', author)).map(version => version.revision)).toEqual([1, 0]);
    expect((await sql`select * from commit_child`.execute(db)).rows).toEqual([]);
    await sql.raw('DROP TRIGGER fail_commit ON lumen_document_revisions').execute(db);
    expect(await live.applyEdit(payload, author)).toMatchObject({ success: true, revision: 2 });
    expect(event).toHaveBeenCalledTimes(1);
  });

  it('retries an aborted PostgreSQL transaction through Kysera without publishing the failed attempt', async () => {
    const manager = await connect();
    const live = new LiveEditService({ corpusId: 'serialization-retry' }, manager);
    const db = await manager.getConnection<LumenAuthoringDatabase>();
    await sql.raw('CREATE SEQUENCE serialization_attempt').execute(db);
    await sql.raw(`CREATE FUNCTION abort_lumen_attempt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.corpus = 'serialization-retry' AND NEW.revision = 1 AND nextval('serialization_attempt') = 1 THEN
        RAISE EXCEPTION 'transaction retry qualification' USING ERRCODE = '40001'; END IF; RETURN NEW; END $$`).execute(db);
    await sql.raw('CREATE TRIGGER abort_attempt AFTER INSERT ON lumen_document_revisions FOR EACH ROW EXECUTE FUNCTION abort_lumen_attempt()').execute(db);
    const event = vi.fn(); live.on('live-edit', event);
    const result = await live.applyEdit({ docId: 'retry.pdx', patch: 'one committed version', baseRevision: 0, baseHash: hash('') }, author);
    expect(result).toMatchObject({ success: true, revision: 1 });
    expect(event).toHaveBeenCalledTimes(1);
    expect(Number((await sql<{ last_value: number | string }>`select last_value from serialization_attempt`.execute(db)).rows[0]?.last_value)).toBe(2);
    expect((await live.getHistory('retry.pdx', author)).map(version => version.revision)).toEqual([1, 0]);
    await sql.raw('DROP TRIGGER abort_attempt ON lumen_document_revisions').execute(db);
  });

  it('preserves source hash, history and exact Unicode after reopening the PostgreSQL server', async () => {
    const manager = await connect();
    const options = { corpusId: 'restart' };
    const live = new LiveEditService(options, manager);
    const source = '# Исходный документ\nα → β';
    const first = await live.applyEdit({ docId: 'guide.pdx', patch: 'Первая правка.', baseRevision: 0, baseHash: hash(source) }, author, source);
    const second = await live.applyEdit({ docId: 'guide.pdx', patch: '  Последняя строка.  ', baseRevision: 1, baseHash: first.hash! }, author);
    await closeConnections();
    execFileSync('docker', ['restart', '--time', '5', container!.name], { timeout: 30_000, stdio: 'ignore' });
    const deadline = Date.now() + 30_000;
    while (!await container!.isHealthy()) {
      if (Date.now() >= deadline) throw new Error('The isolated PostgreSQL server did not become healthy after restart');
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const reopened = new LiveEditService(options, await connect({ coerceBigint: false }));
    expect(await reopened.getDocument('guide.pdx')).toMatchObject({ content: second.content, revision: 2, hash: hash(second.content!), seedHash: hash(source), origin: 'disk' });
    expect((await reopened.getHistory('guide.pdx', author)).map(version => [version.revision, version.content, version.hash])).toEqual([
      [2, second.content, hash(second.content!)], [1, first.content, hash(first.content!)], [0, source, hash(source)],
    ]);
    expect(await reopened.applyEdit({ docId: 'guide.pdx', patch: 'stale', baseRevision: 1, baseHash: first.hash! }, author)).toMatchObject({ success: false, conflict: true, revision: 2 });
  });
});
