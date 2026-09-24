/**
 * Alerts nobody had to write.
 *
 * A fresh master evaluated every rule in `alert_rules` every fifteen
 * seconds, and there were none; a rule's wait (`forDuration`) was stored and
 * read by nothing, so a CPU spike of one tick paged as loudly as an hour of
 * it; an acknowledgement named whoever the request said.
 *
 * Run on a real Postgres, in a database of its own, with every row made by
 * the writer that makes it in production: the defaults by the migrator, the
 * events by `evaluate`, the acknowledgement by the RPC inside a session.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';

import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';
import { AlertService } from '../../src/services/alert.service.js';
import { AlertRpcService } from '../../src/services/alert.rpc-service.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { alertRuleTypeOf, readAlertRuleFields } from '../../src/shared/alert-expression.js';
import { migrateOmnitronDb } from '../../src/database/migration-runner.js';
import * as m011 from '../../src/database/migrations/011_alerts_nobody_had_to_write.js';

const TEST_PG_URL = process.env['TEST_DATABASE_URL'] ?? 'postgresql://test:test@localhost:15432/test';
const testPg = await requiresTestPostgres(TEST_PG_URL);

const logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {} };
const MINUTE = 60_000;

describe.skipIf(!testPg.ok)('alerts nobody had to write', () => {
  let own: OwnDatabase;
  let apps: Array<{ name: string; status: string; cpu: number; memory: number }>;
  let alerts: AlertService;

  const events = () =>
    own.db
      .selectFrom('alert_events')
      .innerJoin('alert_rules', 'alert_rules.id', 'alert_events.ruleId')
      .select(['alert_events.id', 'alert_rules.name', 'alert_events.status', 'alert_events.value'])
      .select(['alert_events.acknowledgedAt', 'alert_events.acknowledgedBy'])
      .orderBy('alert_events.firedAt')
      .execute();
  const names = async () =>
    (await own.db.selectFrom('alert_rules').select('name').orderBy('name').execute()).map((r) => r.name);

  beforeAll(async () => {
    own = await databaseOfItsOwn(TEST_PG_URL, `court_alerts_${process.pid}`);
    apps = [{ name: 'daos/dev/main', status: 'online', cpu: 5, memory: 200 * 1024 * 1024 }];
    alerts = new AlertService({ logger } as never, own.db, { list: () => apps } as never);
  });
  afterAll(async () => own?.drop());

  describe('a fresh master', () => {
    it('starts with the five defaults, each on and each one the evaluator reads', async () => {
      const rules = await alerts.getRules();

      expect(rules.map((r) => r.name).sort()).toEqual(m011.DEFAULT_ALERT_RULES.map((r) => r.name).sort());
      for (const rule of rules) {
        expect(rule.enabled, rule.name).toBe(true);
        expect(rule.summary, rule.name).toBeTruthy();
        expect(readAlertRuleFields(rule, false).problems, rule.name).toEqual([]);
        expect(rule.type, rule.name).toBe(alertRuleTypeOf(rule.expression));
      }
    });
  });

  describe('a rule with a wait', () => {
    it('does not fire until its condition has held for all of it', async () => {
      const t0 = Date.now();
      apps[0]!.cpu = 95;

      await alerts.evaluate(t0);
      await alerts.evaluate(t0 + 5 * MINUTE - 1000);
      expect(await events()).toEqual([]);

      await alerts.evaluate(t0 + 5 * MINUTE);
      expect(await events()).toMatchObject([{ name: 'CPU above 90%', status: 'firing', value: 'daos/dev/main=95.0' }]);

      await alerts.evaluate(t0 + 5 * MINUTE + 15_000);
      expect(await events()).toHaveLength(1);
    });

    it('starts the wait again when the condition lets go, or the rule is edited', async () => {
      apps[0]!.cpu = 5;
      await alerts.evaluate();
      expect((await events()).map((e) => e.status)).toEqual(['resolved']);

      const t0 = Date.now();
      apps[0]!.cpu = 95;
      await alerts.evaluate(t0);
      apps[0]!.cpu = 5;
      await alerts.evaluate(t0 + 2 * MINUTE);
      apps[0]!.cpu = 95;
      await alerts.evaluate(t0 + 3 * MINUTE);
      // Five minutes after the first reading, two after the condition came back.
      await alerts.evaluate(t0 + 5 * MINUTE);
      expect(await events()).toHaveLength(1);

      const cpu = (await alerts.getRules()).find((r) => r.name === 'CPU above 90%')!;
      await alerts.updateRule(cpu.id, { summary: 'Hot for five minutes' });
      await alerts.evaluate(t0 + 8 * MINUTE);
      // Five minutes after the condition came back — but the rule changed at minute 5.
      expect(await events()).toHaveLength(1);
      await alerts.evaluate(t0 + 13 * MINUTE);
      expect((await events()).map((e) => e.status)).toEqual(['resolved', 'firing']);

      apps[0]!.cpu = 5;
      await alerts.evaluate();
    });
  });

  describe('a rule without one', () => {
    it('fires on the first reading', async () => {
      apps[0]!.status = 'crashed';
      await alerts.evaluate();
      expect((await events()).filter((e) => e.status === 'firing')).toMatchObject([
        { name: 'App crashed', value: 'daos/dev/main=crashed' },
      ]);
    });
  });

  describe('an acknowledgement', () => {
    it('is signed by the session’s user, and leaves the alert firing', async () => {
      const [user] = await sql<{ id: string }>`
        INSERT INTO omnitron_users (username, "passwordHash", role) VALUES ('operator-one', 'x', 'operator')
        RETURNING id
      `.execute(own.db).then((r) => r.rows);
      const crashed = (await events()).find((e) => e.name === 'App crashed')!;
      const rpc = new AlertRpcService(alerts);

      const result = await runWithAuth({ userId: user!.id, roles: ['operator'], permissions: [] } as never, () =>
        rpc.acknowledgeAlert({ alertId: crashed.id, acknowledgedBy: 'another-operator' } as never)
      );

      expect(result).toEqual({ success: true });
      const after = (await events()).find((e) => e.id === crashed.id)!;
      expect(after).toMatchObject({ status: 'firing', acknowledgedBy: 'operator-one' });
      expect(after.acknowledgedAt).not.toBeNull();
    });

    it('is counted, and every severity is named in the summary, zero included', async () => {
      expect(await alerts.getSummary()).toEqual({
        firing: 1,
        acknowledged: 1,
        resolved: 2,
        total: 3,
        bySeverity: { info: 0, warning: 0, critical: 1 },
      });
    });

    it('of an alert already resolved, or already taken, changes nothing', async () => {
      const [resolved, firing] = [(await events()).find((e) => e.status === 'resolved')!, (await events()).find((e) => e.status === 'firing')!];
      expect(await alerts.acknowledgeAlert(resolved.id, randomUUID())).toBe(false);
      expect((await events()).find((e) => e.id === resolved.id)!.acknowledgedAt).toBeNull();

      expect(await alerts.acknowledgeAlert(firing.id, randomUUID())).toBe(false);
      expect((await events()).find((e) => e.id === firing.id)!).toMatchObject({ acknowledgedBy: 'operator-one' });
    });

    it('from the CLI is signed with the identity the socket admitted', async () => {
      const t = Date.now();
      apps[0]!.status = 'errored';
      await alerts.evaluate(t);
      await alerts.evaluate(t + MINUTE);
      const erroring = (await events()).find((e) => e.name === 'App erroring' && e.status === 'firing')!;

      const result = await runWithAuth({ userId: 'omnitron-local', roles: ['admin'], permissions: [] } as never, () =>
        new AlertRpcService(alerts).acknowledgeAlert({ alertId: erroring.id })
      );

      expect(result).toEqual({ success: true });
      expect((await events()).find((e) => e.id === erroring.id)!).toMatchObject({ acknowledgedBy: 'omnitron-local' });
      apps[0]!.status = 'online';
      await alerts.evaluate();
    });
  });

  describe('a default', () => {
    it('the operator deletes stays deleted when the master starts again', async () => {
      await own.db.deleteFrom('alert_rules').where('name', '=', 'Memory above 2 GiB').execute();
      await migrateOmnitronDb(own.db as never);
      expect(await names()).not.toContain('Memory above 2 GiB');
    });

    it('the operator edits is theirs: `down` leaves it and `up` does not overwrite it', async () => {
      await own.db.updateTable('alert_rules').set({ expression: 'app.*.cpu > 95' }).where('name', '=', 'CPU above 90%').execute();

      await m011.down(own.db as never);
      expect(await names()).toEqual(['CPU above 90%']);

      await m011.up(own.db as never);
      expect(await names()).toEqual(m011.DEFAULT_ALERT_RULES.map((r) => r.name).sort());
      const cpu = await own.db.selectFrom('alert_rules').select('expression').where('name', '=', 'CPU above 90%').executeTakeFirstOrThrow();
      expect(cpu.expression).toBe('app.*.cpu > 95');
    });
  });
});
