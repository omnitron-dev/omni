/**
 * An alarm that waits for its sink.
 *
 * A critical alert goes to the platform's alert sink — a project's
 * `monitoring.alertSink`, here daos's `OpsAlerts.raise` in main's
 * notification worker — and the sink is an app that is not always running: a
 * deploy stops it for a minute or two, exactly when «App crashed» fires. So
 * delivery is a state (migration 013), tried every evaluation tick until the
 * sink takes it, the firing before its end, never a warning, never an alert a
 * day old, and never into an app that is not in bootstrap mode.
 *
 * On a real Postgres, in a database of its own, with the real migrations; the
 * orchestrator and the project are this file's, and the sink records its calls.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { sql } from 'kysely';

import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { AlertService } from '../../src/services/alert.service.js';

vi.mock('../../src/monitoring/host-disk.js', () => ({
  diskAtHome: async () => ({ free: 198 * 1024 ** 3, total: 1843 * 1024 ** 3 }),
}));

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {} };
const MINUTE = 60_000;

type Raised = {
  eventId: string;
  status: string;
  ruleName: string;
  value: string;
  summary: string | null;
  host: string;
};

describe.skipIf(!testPg.ok)('an alarm that waits for its sink', () => {
  let own: OwnDatabase;
  let alerts: AlertService;
  const raised: Raised[] = [];
  const apps = [
    { name: 'daos/dev/main', status: 'online', cpu: 1, memory: 1 },
    { name: 'daos/dev/storage', status: 'online', cpu: 1, memory: 1 },
  ];
  let sinkMode: 'bootstrap' | 'classic' = 'bootstrap';

  const main = () => apps[0]!;
  const storage = () => apps[1]!;
  const tick = (at: number = Date.now()) => alerts.evaluate(at);
  const events = () =>
    own.db
      .selectFrom('alert_events')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_events.ruleId')
      .select(['alert_events.id', 'alert_rules.name', 'alert_events.status'])
      .select(['alert_events.deliveredAt', 'alert_events.resolveDeliveredAt', 'alert_events.deliveryError'])
      .orderBy('alert_events.firedAt')
      .execute();

  beforeAll(async () => {
    own = await databaseOfItsOwn(TEST_PG_URL, `court_sink_${process.pid}`);
    const orchestrator = {
      list: () => apps,
      getHandle: (name: string) => {
        const app = apps.find((a) => a.name === name);
        if (!app) return undefined;
        return {
          status: app.status,
          mode: sinkMode,
          supervisor: {
            getChildNames: () => ['http', 'notification-worker'],
            getChildProxy: async (child: string) =>
              child === 'notification-worker'
                ? {
                    getExposedServices: async () => [{ name: 'OpsAlerts', methods: ['raise'] }],
                    callExposedService: async (_service: string, _method: string, args: unknown[]) => {
                      raised.push(args[0] as Raised);
                      return { queued: true };
                    },
                  }
                : {
                    getExposedServices: async () => [{ name: 'HealthService', methods: ['check'] }],
                    callExposedService: async () => undefined,
                  },
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
    alerts = new AlertService({ logger } as never, own.db, orchestrator as never, projects as never);
  });
  afterAll(async () => own?.drop());

  beforeEach(() => {
    raised.length = 0;
    sinkMode = 'bootstrap';
  });

  it('delivers a critical alert once, to the stack’s own sink, and marks it', async () => {
    storage().status = 'crashed';
    await tick();
    await tick();

    expect(raised).toMatchObject([
      {
        status: 'firing',
        ruleName: 'App crashed',
        value: 'daos/dev/storage=crashed',
        host: 'daos/dev',
        summary: 'An app crashed',
      },
    ]);
    const [crash] = await events();
    expect(raised[0]!.eventId).toBe(crash!.id);
    expect(crash).toMatchObject({ status: 'firing', deliveryError: null });
    expect(crash!.deliveredAt).not.toBeNull();
  });

  it('delivers its end, once', async () => {
    storage().status = 'online';
    await tick();
    await tick();

    expect(raised).toMatchObject([{ status: 'resolved', ruleName: 'App crashed' }]);
    const [crash] = await events();
    expect(crash!.resolveDeliveredAt).not.toBeNull();
  });

  it('waits while the sink is down — the reason kept — and delivers the firing, then its end, when it is back', async () => {
    main().status = 'stopped';
    storage().status = 'crashed';
    await tick();
    storage().status = 'online';
    await tick();

    expect(raised).toEqual([]);
    const second = (await events())[1]!;
    expect(second).toMatchObject({ status: 'resolved', deliveredAt: null, resolveDeliveredAt: null });
    expect(second.deliveryError).toBe('daos/dev/main is not online');

    main().status = 'online';
    await tick();

    expect(raised.map((r) => r.status)).toEqual(['firing', 'resolved']);
    const delivered = (await events())[1]!;
    expect(delivered).toMatchObject({ deliveryError: null });
    expect(delivered.deliveredAt).not.toBeNull();
    expect(delivered.resolveDeliveredAt).not.toBeNull();
  });

  it('never delivers a warning', async () => {
    const t0 = Date.now();
    storage().cpu = 95;
    await tick(t0);
    await tick(t0 + 5 * MINUTE);
    storage().cpu = 1;
    await tick(t0 + 6 * MINUTE);

    expect((await events()).some((e) => e.name === 'CPU above 90%')).toBe(true);
    expect(raised.filter((r) => r.ruleName === 'CPU above 90%')).toEqual([]);
  });

  it('never delivers an alert a day old', async () => {
    const crashed = await own.db
      .selectFrom('alert_rules')
      .select('id')
      .where('name', '=', 'App crashed')
      .executeTakeFirstOrThrow();
    await sql`
      INSERT INTO alert_events ("ruleId", status, value, "firedAt")
      VALUES (${crashed.id}::uuid, 'firing', 'daos/dev/old=crashed', now() - interval '25 hours')
    `.execute(own.db);
    await tick();

    expect(raised.filter((r) => r.value === 'daos/dev/old=crashed')).toEqual([]);
  });

  it('refuses a sink that is not a bootstrap app — exec’s HTTP road is never taken', async () => {
    sinkMode = 'classic';
    storage().status = 'crashed';
    await tick();

    expect(raised).toEqual([]);
    const last = (await events()).filter((e) => e.name === 'App crashed').at(-1)!;
    expect(last.deliveryError).toBe('daos/dev/main is not a bootstrap app — its alert sink is refused');

    sinkMode = 'bootstrap';
    storage().status = 'online';
    await tick();
    expect(raised.map((r) => r.status)).toEqual(['firing', 'resolved']);
  });
});
