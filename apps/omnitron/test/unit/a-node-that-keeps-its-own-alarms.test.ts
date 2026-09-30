/**
 * A node that keeps its own alarms.
 *
 * A node daemon runs without Postgres, and the alert engine was provided on
 * the master alone — `daemon.module.ts`, "master only — requires PG". So the
 * test stack's alerts were evaluated by nobody: its log said
 * `alert-evaluation — no alert service` at every start, and the bell built for
 * them in release 5 had no caller (omni-3f on test, 2026-09-30). The owner
 * chose that a node counts its own alarms in its own SQLite, with the four
 * critical defaults, independent of the Mac and of the stack's Postgres.
 *
 * On a real SQLite file through `SlaveStorageService`, as the node opens it;
 * the orchestrator, the project and the sink are this file's.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql, type Kysely } from 'kysely';

import { SlaveStorageService, NODE_ALERT_RULES } from '../../src/services/slave-storage.service.js';
import { AlertService } from '../../src/services/alert.service.js';

vi.mock('../../src/monitoring/host-disk.js', () => ({
  diskAtHome: async () => ({ free: 198 * 1024 ** 3, total: 1843 * 1024 ** 3 }),
}));

const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {}, child: () => logger };

type Raised = {
  eventId: string;
  status: string;
  ruleName: string;
  value: string;
  summary: string | null;
  host: string;
};

describe('a node’s own alarms, on its SQLite', () => {
  let dir: string;
  let storage: SlaveStorageService;
  let db: Kysely<any>;
  let alerts: AlertService;
  const raised: Raised[] = [];
  const apps = [
    { name: 'daos/test/main', status: 'online', cpu: 1, memory: 1 },
    { name: 'daos/test/storage', status: 'online', cpu: 1, memory: 1 },
  ];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'omnitron-node-alarms-'));
    storage = new SlaveStorageService(logger as never, join(dir, 'slave.db'));
    db = await storage.getDb();
    const orchestrator = {
      list: () => apps,
      getHandle: (name: string) => {
        const app = apps.find((a) => a.name === name);
        if (!app) return undefined;
        return {
          status: app.status,
          mode: 'bootstrap',
          supervisor: {
            getChildNames: () => ['notification-worker'],
            getChildProxy: async () => ({
              getExposedServices: async () => [{ name: 'OpsAlerts', methods: ['raise'] }],
              callExposedService: async (_s: string, _m: string, args: unknown[]) => {
                raised.push(args[0] as Raised);
                return { queued: true };
              },
            }),
          },
        };
      },
    };
    const projects = {
      listProjects: () => [{ name: 'daos' }],
      loadProjectConfig: async () => ({
        monitoring: { alertSink: { app: 'main', service: 'OpsAlerts', method: 'raise' } },
      }),
    };
    alerts = new AlertService({ logger } as never, db, orchestrator as never, projects as never);
  });

  afterAll(async () => {
    await db?.destroy();
    rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    raised.length = 0;
  });

  it('seeds the four critical defaults, and no warning it could show nobody', async () => {
    const rules = await db.selectFrom('alert_rules').select(['name', 'severity', 'enabled']).orderBy('name').execute();
    expect(rules.map((r) => r.name).sort()).toEqual(
      ['App crashed', 'App erroring', 'Container unhealthy', 'Disk space below 50 GiB'].sort()
    );
    expect(rules.every((r) => r.severity === 'critical' && r.enabled === 1)).toBe(true);
    expect(NODE_ALERT_RULES).toHaveLength(4);
  });

  it('delivers a crash on the node to the stack it runs, with its summary, once', async () => {
    apps[1]!.status = 'crashed';
    await alerts.evaluate();
    await alerts.evaluate();

    expect(raised).toMatchObject([
      {
        status: 'firing',
        ruleName: 'App crashed',
        value: 'daos/test/storage=crashed',
        summary: 'An app crashed',
        host: 'daos/test',
      },
    ]);
    const [event] = await db.selectFrom('alert_events').selectAll().execute();
    expect(event).toMatchObject({ status: 'firing', deliveryError: null });
    expect(event!.deliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(raised[0]!.eventId).toBe(event!.id);
    // The event keeps the rule's annotations as JSON, not a JSON string of it.
    expect(JSON.parse(event!.annotations as string)).toEqual({ summary: 'An app crashed' });
  });

  it('and its end', async () => {
    apps[1]!.status = 'online';
    await alerts.evaluate();

    expect(raised).toMatchObject([{ status: 'resolved', ruleName: 'App crashed' }]);
    const [event] = await db.selectFrom('alert_events').selectAll().execute();
    expect(event).toMatchObject({ status: 'resolved' });
    expect(event!.resolveDeliveredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('keeps an operator’s change to a default across a restart, and a rule’s events go with it', async () => {
    await sql`UPDATE alert_rules SET enabled = 0 WHERE name = 'Container unhealthy'`.execute(db);
    const reopened = new SlaveStorageService(logger as never, join(dir, 'slave.db'));
    const again = await reopened.getDb();
    const row = await again
      .selectFrom('alert_rules')
      .select('enabled')
      .where('name', '=', 'Container unhealthy')
      .executeTakeFirst();
    expect(row?.enabled).toBe(0);
    expect(await again.selectFrom('alert_rules').select('id').execute()).toHaveLength(4);
    await again.destroy();

    await sql`DELETE FROM alert_rules WHERE name = 'App crashed'`.execute(db);
    expect(await db.selectFrom('alert_events').selectAll().execute()).toEqual([]);
  });
});

describe('the node runs the engine', () => {
  const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

  it('provides it on the slave role and schedules it on both', () => {
    const module = read('../../src/daemon/daemon.module.ts');
    const block = module.slice(module.indexOf('ALERT_SERVICE_TOKEN,\n        {\n          useClass: AlertService'));
    expect(block.slice(0, 1600)).toMatch(
      /\] as any\] : \[\[[\s\S]*?ALERT_SERVICE_TOKEN,[\s\S]*?slaveStorage\.getDb\(\)/
    );
    expect(read('../../src/daemon/daemon.ts')).not.toMatch(/!isSlave \? await container\.resolveAsync<AlertService>/);
  });
});
