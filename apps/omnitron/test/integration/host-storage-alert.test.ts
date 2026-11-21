import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { sql, type Kysely } from 'kysely';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { TEST_POSTGRES_URL } from '@omnitron-dev/testing/env';
import { readHostStorage, storageDecision, storageSnapshot } from '../../src/monitoring/host-storage.js';
import { AlertService } from '../../src/services/alert.service.js';
import { SlaveStorageService } from '../../src/services/slave-storage.service.js';
import { SyncService, type SyncBatch } from '../../src/services/sync.service.js';
import { SyncRpcService } from '../../src/services/sync.rpc-service.js';
import { projectStorageAlert } from '../../src/services/host-storage-alert.js';
import { registerDaemonJobs } from '../../src/daemon/daemon-scheduler.js';
import { STORAGE_ALERT_RULE, migration as pgSeed } from '../../src/database/alert-bridge/migrations/018_host_storage_alert.js';
import * as sqliteSeed from '../../src/database/alert-bridge/slave-migrations/002_host_storage_alert.js';
import { createMigrationRunner } from '../../src/migration/index.js';
import { SLAVE_MIGRATIONS } from '../../src/database/slave-migrations/index.js';
import { STORAGE_ORIGIN_ROLLBACK } from '../../src/database/alert-bridge/layout.js';
import { Findings, checkHostStorage } from '../../src/commands/doctor.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const fixture = vi.hoisted(() => ({ root: '' }));
vi.mock('../../src/monitoring/host-storage.js', async (importActual) => {
  const actual = await importActual<typeof import('../../src/monitoring/host-storage.js')>();
  return {
    ...actual,
    readHostStorage: (root = fixture.root, platform: NodeJS.Platform = 'linux') =>
      actual.readHostStorage(root, platform, join(root, 'proc')),
  };
});
vi.mock('../../src/monitoring/desktop-notifier.js', () => ({ notifyDesktop: vi.fn() }));
vi.mock('../../src/monitoring/host-disk.js', () => ({
  diskAtHome: async () => ({ free: 100 * 1024 ** 3, total: 200 * 1024 ** 3 }),
}));

const logger = createNullLogger();
const receipts: Array<{ status: string; eventId: string; value: string }> = [];
const project = {
  listWorkspaceNames: () => ['example'],
  loadProjectConfig: async () => ({
    monitoring: { alertSink: { app: 'api', service: 'Notifications', method: 'record' } },
  }),
};
const healthyApps = {
  list: () => [{ name: 'example/test/api', status: 'online', cpu: 0, memory: 100 }],
  getHandle: () => ({
    status: 'online',
    mode: 'bootstrap',
    supervisor: {
      getChildNames: () => ['sink'],
      getChildProxy: async () => ({
        getExposedServices: async () => [{ name: 'Notifications', methods: ['record'] }],
        callExposedService: async (_s: string, _m: string, args: [(typeof receipts)[number]]) => {
          receipts.push(args[0]);
          return true;
        },
      }),
    },
  }),
};
let dir: string;
let storage: SlaveStorageService;
let db: Kysely<OmnitronDatabase>;
let sync: SyncService;
let alerts: AlertService;
const rule = STORAGE_ALERT_RULE;
let now: number;
const slot = '0000:01:00.0';

async function write(path: string, text: string) {
  const file = join(fixture.root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text + '\n');
}
async function array(n: number, repaired = false) {
  const base = `block/md${n}/md/`;
  const members = {
    'dev-nvme0n1p1/state': 'in_sync,writemostly',
    [`dev-${repaired ? 'nvme7' : 'nvme1'}n1p1/state`]: repaired ? 'in_sync' : 'faulty',
  };
  await Promise.all(
    Object.entries({
      level: 'raid1',
      degraded: repaired ? '0' : '1',
      raid_disks: '2',
      array_state: 'clean',
      sync_action: 'idle',
      uuid: `79212bc4-d995-472e-bf37-feda807f100${n}`,
      ...members,
    }).map(([p, v]) => write(base + p, v))
  );
  if (repaired) await rm(join(fixture.root, base, 'dev-nvme1n1p1'), { recursive: true, force: true });
}
async function nvme(n: number, state: string, sectors: string, address = slot) {
  const base = `class/nvme/nvme${n}`;
  await Promise.all([
    write(base + '/state', state),
    write(base + '/address', address),
    write(base + '/transport', 'pcie'),
    write(`block/nvme${n}n1/size`, sectors),
    write(`block/nvme${n}n1/nsid`, '1'),
    mkdir(join(fixture.root, base, `nvme${n}n1`), { recursive: true }),
  ]);
}
async function node() {
  storage = new SlaveStorageService(logger, join(dir, 'node.db'));
  db = (await storage.getDb()) as unknown as Kysely<OmnitronDatabase>;
  await createMigrationRunner(db as unknown as Kysely<unknown>, [...SLAVE_MIGRATIONS,
    { name: '002_host_storage_alert', checksum: STORAGE_ORIGIN_ROLLBACK.node, up: sqliteSeed.up }], { verbose: false }).up();
  sync = new SyncService(db, logger, 'node-reported-name', 'slave');
  alerts = new AlertService({ logger } as never, db, healthyApps as never, project as never, sync);
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'host-storage-'));
  fixture.root = join(dir, 'sys');
  await Promise.all(['block', 'class/nvme'].map((p) => mkdir(join(fixture.root, p), { recursive: true })));
  receipts.length = 0;
  now = Date.now();
  await node();
});
afterEach(async () => {
  await storage.dispose();
  await rm(dir, { recursive: true, force: true });
});

async function rollbackPreserves(
  db: Kysely<OmnitronDatabase>,
  seed: { up(db: Kysely<unknown>): Promise<unknown>; down(db: Kysely<unknown>): Promise<unknown> }
) {
  const before = await db.selectFrom('alert_events').selectAll().orderBy('id').execute();
  const untyped = db as unknown as Kysely<unknown>;
  await seed.down(untyped);
  await seed.up(untyped);
  expect(await db.selectFrom('alert_events').selectAll().orderBy('id').execute()).toEqual(before);
}

it('reads independent kernel observations, reports source gaps and keeps private identity out of snapshots', async () => {
  await Promise.all([array(0), array(1), array(2), nvme(1, 'dead', '0')]);
  const storage = storageSnapshot(await readHostStorage());
  expect(storage.status).toBe('degraded');
  expect(storage.resources.map((r) => [r.name, r.health])).toEqual(
    ['md0', 'md1', 'md2', 'nvme1', 'nvme1n1'].map((n) => [n, 'degraded'])
  );
  expect(storage.resources[0]!.detail).toMatch(
    /degraded=1.*in_sync=1\/2.*nvme0n1p1=in_sync,writemostly.*nvme1n1p1=faulty/
  );
  expect(JSON.stringify(storage)).not.toMatch(/0000:01:00|79212bc4|privateKey|mirrors|\/sys\//);
  const findings = new Findings();
  await checkHostStorage(findings);
  expect(findings.all()).toMatchObject([
    {
      id: 'disk.hardware',
      severity: 'error',
      evidence: expect.arrayContaining([expect.stringContaining('nvme1 state=dead')]),
    },
  ]);
  await rm(join(fixture.root, 'block/md1/md/degraded'));
  expect((await readHostStorage()).resources.find((resource) => resource.name === 'md1')).toMatchObject({
    health: 'degraded',
    detail: expect.stringContaining('degraded=?'),
  });
  await rm(join(fixture.root, 'class'), { recursive: true });
  expect(await readHostStorage()).toMatchObject({
    status: 'degraded',
    issues: ['NVMe controller inventory unavailable'],
  });
  await rm(join(fixture.root, 'block'), { recursive: true });
  expect((await readHostStorage()).status).toBe('unknown');
  expect((await readHostStorage(fixture.root, 'darwin')).status).toBe('unsupported');
});

it('distinguishes every controller state, an empty inventory and an unreadable or missing reading', async () => {
  expect((await readHostStorage()).status).toBe('not-applicable');
  await rm(join(fixture.root, 'class/nvme'), { recursive: true });
  expect((await readHostStorage()).status).toBe('not-applicable');
  await write('class/nvme', 'obstructed inventory');
  expect((await readHostStorage()).status).toBe('unknown');
  await rm(join(fixture.root, 'class/nvme'));
  for (const state of [
    'new',
    'connecting',
    'resetting',
    'deleting',
    'deleting (no IO)',
    'unrecognized',
    'dead',
    'live',
  ]) {
    await nvme(3, state, '100');
    const [controller] = (await readHostStorage()).resources;
    expect(controller?.health).toBe(state === 'dead' ? 'degraded' : state === 'live' ? 'healthy' : 'unknown');
  }
  await write('block/nvme3n1/size', '');
  expect((await readHostStorage()).status).toBe('unknown');
});

it('does not accept an unrelated object reusing an unidentifiable kernel name', async () => {
  await write('class/nvme/nvme2/state', 'dead');
  const previous = storageDecision(await readHostStorage(), []);
  await rm(join(fixture.root, 'class/nvme/nvme2'), { recursive: true });
  await write('class/nvme/nvme2/state', 'live');
  const next = storageDecision(await readHostStorage(), previous.subjects);
  expect(next.firing).toBe(true);
  expect(next.value).toContain('restoration unconfirmed');
});

it('recognizes a standalone controller and namespace restored under new Linux names at the same PCI slot', async () => {
  await nvme(1, 'dead', '0');
  const initial = storageDecision(await readHostStorage(), []);
  await rm(join(fixture.root, 'class/nvme/nvme1'), { recursive: true });
  await rm(join(fixture.root, 'block/nvme1n1'), { recursive: true });
  await nvme(7, 'live', '200', '0000:07:00.0');
  expect(storageDecision(await readHostStorage(), initial.subjects).firing).toBe(true);
  await nvme(8, 'live', '200');
  const recovery = storageDecision(await readHostStorage(), initial.subjects);
  expect(recovery.firing).toBe(false);
  expect(recovery.restored).toEqual(['nvme8 state=live', 'nvme8n1 sectors=200']);
});

it('records an existing incident on the first evaluation and coalesces updates across restart, loss and verified replacement', async () => {
  await Promise.all([array(0), array(1), array(2)]);
  await db
    .updateTable('alert_rules')
    .set({ annotations: JSON.stringify({ summary: rule.summary, node: 'operator label' }) })
    .where('id', '=', rule.id)
    .execute();
  let initial: Promise<void> | undefined;
  registerDaemonJobs(
    {
      addInterval(name: string, _ms: number, run: () => Promise<void>, options?: { immediate?: boolean }) {
        if (name === 'alert-evaluation' && options?.immediate) initial = run();
      },
    } as never,
    {
      logger,
      orchestrator: healthyApps as never,
      authService: null,
      fleetService: null,
      infraService: null,
      alertService: alerts,
      logManager: {} as never,
      metricsService: {} as never,
      metricsInterval: 60_000,
      healthCheckInterval: 60_000,
    }
  );
  expect(initial).toBeDefined();
  await initial;
  now = Date.now();
  await Promise.all([alerts.evaluate(now + 1), alerts.evaluate(now + 1)]);
  expect(receipts.map((r) => r.status)).toEqual(['firing']);
  const event = (await alerts.getEvents())[0]!;
  expect(event.value).toContain('md2');
  await rollbackPreserves(db, sqliteSeed);
  await storage.dispose();
  await node();
  await nvme(1, 'dead', '0');
  await alerts.evaluate(now + 10);
  expect((await alerts.getEvents())[0]).toMatchObject({
    id: event.id,
    status: 'firing',
    value: expect.stringContaining('nvme1 state=dead'),
  });
  expect((await sync.drainBuffer()).entries).toHaveLength(2);
  await alerts.evaluate(now + 11);
  expect((await sync.drainBuffer()).entries).toHaveLength(2);
  await rename(fixture.root, fixture.root + '-held');
  await alerts.evaluate(now + 12);
  expect((await alerts.getEvents())[0]).toMatchObject({
    id: event.id,
    status: 'firing',
    value: expect.stringContaining('last fault: state=dead'),
  });
  await rename(fixture.root + '-held', fixture.root);
  await Promise.all([
    rm(join(fixture.root, 'class/nvme/nvme1'), { recursive: true }),
    rm(join(fixture.root, 'block/nvme1n1'), { recursive: true }),
  ]);
  // Different PCI slot and kernel number; complete mirror membership must prove the substitution.
  await Promise.all([nvme(7, 'live', '200', '0000:07:00.0'), array(0, true), array(1, true), array(2, true)]);
  await write('block/md2/md/raid_disks', '1');
  await alerts.evaluate(now + 13);
  expect((await alerts.getEvents())[0]!.status).toBe('firing');
  await write('block/md2/md/raid_disks', '2');
  await write('block/md2/md/sync_action', 'recover');
  await alerts.evaluate(now + 14);
  expect((await alerts.getEvents())[0]!.status).toBe('firing');
  await write('block/md2/md/sync_action', 'idle');
  await rename(join(fixture.root, 'block/md2'), join(fixture.root, 'block/md9'));
  await alerts.evaluate(now + 2 * 86_400_000);
  await alerts.evaluate(now + 2 * 86_400_000 + 1);
  expect(await alerts.getEvents()).toMatchObject([
    { id: event.id, status: 'resolved', value: expect.stringContaining('mirrors fully synchronized') },
  ]);
  expect(receipts.map((r) => [r.eventId, r.status])).toEqual([
    [event.id, 'firing'],
    [event.id, 'resolved'],
  ]);
  await rollbackPreserves(db, sqliteSeed);
});

const pg = await requiresTestPostgres(TEST_POSTGRES_URL);
it('commits the firing transition and outbox together, then retries without duplicate delivery', async () => {
  await nvme(1, 'dead', '0');
  await sql`CREATE TRIGGER refuse_alert BEFORE INSERT ON sync_buffer WHEN NEW.category = 'alerts'
    BEGIN SELECT raise(ABORT, 'outbox unavailable'); END`.execute(db);
  await expect(alerts.evaluate(now)).rejects.toThrow('outbox unavailable');
  expect(await alerts.getEvents()).toEqual([]);
  expect(receipts).toEqual([]);
  await sql`DROP TRIGGER refuse_alert`.execute(db);
  await alerts.evaluate(now + 1);
  expect(receipts).toHaveLength(1);
  expect((await sync.drainBuffer()).entries).toHaveLength(1);
});
describe.skipIf(!pg.ok)('receipt-backed mesh storage alerts', () => {
  let master: OwnDatabase;
  beforeAll(async () => {
    master = await databaseOfItsOwn(TEST_POSTGRES_URL, `storage_alert_${process.pid}`);
    await pgSeed.up(master.db as unknown as Kysely<unknown>);
  });
  afterAll(async () => {
    await master?.drop();
  });
  it('commits out-of-order revisions once per enrolled source, with independent local notifications', async () => {
    const target = new SyncService(master.db, logger, 'controller', 'master');
    const masterAlerts = new AlertService({ logger } as never, master.db, healthyApps as never, project as never);
    // Exercise the pre-018 shape. Historical annotation.node was written by both the receiver and rule authors.
    const untyped = master.db as unknown as Kysely<unknown>;
    await pgSeed.down!(untyped);
    await sql`ALTER TABLE alert_events DROP COLUMN "originNode", DROP COLUMN "legacyOrigin"`.execute(master.db);
    const legacyRule = await master.db
      .selectFrom('alert_rules')
      .select('id')
      .where('name', '=', 'App crashed')
      .executeTakeFirstOrThrow();
    const legacy = await master.db
      .insertInto('alert_events')
      .values({
        ruleId: legacyRule.id,
        status: 'firing',
        annotations: JSON.stringify({ node: 'historic-label' }),
        firedAt: new Date(now),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await pgSeed.up(untyped);
    await masterAlerts.evaluate(now);
    expect(await masterAlerts.getActiveAlerts()).toMatchObject([
      { id: legacy.id, node: null, reportedNode: 'historic-label' },
    ]);
    expect(receipts).toEqual([]);
    await master.db.deleteFrom('alert_events').where('id', '=', legacy.id).execute();
    const rpc = new SyncRpcService(sync);
    await nvme(1, 'dead', '0');
    // PostgreSQL normalizes jsonb key order. Identical readings across processes still refer to one unchanged revision.
    await masterAlerts.evaluate(now);
    await masterAlerts.evaluate(now + 1);
    const local = await masterAlerts.getEvents();
    expect(local).toMatchObject([{ status: 'firing', annotations: { storageRevision: 1 } }]);
    expect(local[0]!.annotations).not.toHaveProperty('storage');
    await master.db.deleteFrom('alert_events').where('id', '=', local[0]!.id).execute();
    receipts.length = 0;
    await alerts.evaluate(now);
    await write('class/nvme/nvme1/state', 'live');
    await alerts.evaluate(now + 1);
    await nvme(1, 'live', '200');
    await alerts.evaluate(now + 2);
    expect((await rpc.drainBuffer({ limit: 10 })).entries).toEqual([]);
    const batch = await rpc.drainBuffer({ limit: 10, storageAlertVersion: 1 });
    const [first, update, end] = batch.entries;
    expect(batch.entries.map((e) => e.payload['revision'])).toEqual([1, 2, 3]);
    expect(JSON.stringify(batch.entries)).not.toMatch(/"key"|"subjects"|"mirrors"|0000:01:00/);
    const a = randomUUID(),
      b = randomUUID();
    // A retained local DB that also holds a projection must keep both origins and all lifecycle receipts through rollback.
    await db.transaction().execute((trx) => projectStorageAlert(trx, a, first!.payload));
    await rollbackPreserves(db, sqliteSeed);
    await db.transaction().execute((trx) => projectStorageAlert(trx, a, end!.payload));
    await rollbackPreserves(db, sqliteSeed);
    const receive = (nodeId: string, ...entries: SyncBatch['entries']) =>
      target.receiveBatch({
        ...batch,
        nodeId,
        entries,
        checksum: createHash('sha256').update(JSON.stringify(entries)).digest('hex'),
      });
    await receive(a, update!);
    await receive(a, first!);
    await receive(b, { ...first!, payload: { ...first!.payload, node: a, originNode: a } });
    expect((await masterAlerts.getActiveAlerts()).map((x) => x.node).sort()).toEqual([a, b].sort());
    const called = receipts.length;
    // The master's healthy local snapshot must neither settle a replica nor deliver its notifications.
    await masterAlerts.evaluate(now + 3);
    expect(await masterAlerts.getActiveAlerts()).toHaveLength(2);
    expect(receipts).toHaveLength(called);
    await rollbackPreserves(master.db, { up: pgSeed.up, down: pgSeed.down! });
    const applied = await receive(a, end!);
    expect(applied.committedIds).toEqual([end!.id]);
    await receive(a, { ...first!, id: 'replayed-firing' });
    expect((await receive(a, end!)).duplicateIds).toEqual([end!.id]);
    expect((await masterAlerts.getActiveAlerts()).map((x) => x.node)).toEqual([b]);
    expect((await masterAlerts.getEvents()).map((e) => e.status).sort()).toEqual(['firing', 'resolved']);
    await rollbackPreserves(master.db, { up: pgSeed.up, down: pgSeed.down! });
    const ids = batch.entries.map((e) => e.id);
    const receipt = await receive(a, ...batch.entries);
    expect(receipt.committedIds).toEqual(expect.arrayContaining(ids));
    await sync.ackDrained(ids, { version: 1, committedIds: receipt.committedIds!, discardedIds: [] });
    expect((await sync.drainBuffer()).entries).toEqual([]);
    expect(
      (await sql<{ count: number }>`SELECT count(*)::int AS count FROM alert_events`.execute(master.db)).rows[0]?.count
    ).toBe(2);
  });
});
