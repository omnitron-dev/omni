/**
 * A disk nobody watched.
 *
 * The master's disk filled and stopped the container engine three times —
 * 2026-07-01, 09-14, 09-29 — and nothing warned before any of them: no alert
 * rule could say «disk», and the one check, doctor's, runs when somebody runs
 * doctor and warns below 10 GiB. On 09-29 the engine stopped at 21 GiB free
 * of 1.8 TiB.
 *
 * `host.disk.free` is now a form the evaluator reads, from the reading doctor
 * takes, and migration 012 seeds a rule on it: under 50 GiB for a minute,
 * critical.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AlertService } from '../../src/services/alert.service.js';
import { DISK_ALERT_RULE } from '../../src/database/migrations/012_a_disk_nobody_watched.js';
import { alertRuleTypeOf, readAlertRuleFields } from '../../src/shared/alert-expression.js';

const GiB = 1024 ** 3;
const MINUTE = 60_000;

const disk = vi.hoisted(() => ({ free: null as number | null, reads: 0 }));
vi.mock('../../src/monitoring/host-disk.js', () => ({
  diskAtHome: async () => {
    disk.reads++;
    return disk.free === null ? null : { free: disk.free, total: 1843 * GiB };
  },
}));

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

/** A master with one enabled rule, and — when given — its firing event; recording what the evaluation wrote. */
function masterWith(expression: string, firing?: { id: string }) {
  const rule = {
    id: 'r1',
    name: DISK_ALERT_RULE.name,
    expression,
    forDuration: DISK_ALERT_RULE.forDuration,
    enabled: true,
  };
  const fired: Array<Record<string, unknown>> = [];
  const set: Array<Record<string, unknown>> = [];
  const chain: any = {
    selectAll: () => chain,
    where: () => chain,
    set: (v: Record<string, unknown>) => {
      set.push(v);
      return chain;
    },
    values: (v: Record<string, unknown>) => {
      fired.push(v);
      return chain;
    },
    execute: async () => [rule],
    executeTakeFirst: async () => firing,
  };
  const db = { selectFrom: () => chain, updateTable: () => chain, insertInto: () => chain };
  const alerts = new AlertService({ logger } as never, db as never, { list: () => [] } as never);
  return { alerts, fired, resolved: () => set.filter((v) => v['status'] === 'resolved') };
}

beforeEach(() => {
  disk.free = null;
  disk.reads = 0;
  logger.warn.mockClear();
});

describe('the seeded rule', () => {
  it('fires after a minute under 50 GiB, and says how much is left', async () => {
    const { alerts, fired } = masterWith(DISK_ALERT_RULE.expression);
    disk.free = 21 * GiB;

    const t0 = Date.now();
    await alerts.evaluate(t0);
    await alerts.evaluate(t0 + MINUTE - 1000);
    expect(fired).toEqual([]);

    await alerts.evaluate(t0 + MINUTE);
    expect(fired).toMatchObject([{ status: 'firing', value: '21.0 GiB free' }]);
  });

  it('stays quiet with room to spare', async () => {
    const { alerts, fired } = masterWith(DISK_ALERT_RULE.expression);
    disk.free = 198 * GiB;

    const t0 = Date.now();
    await alerts.evaluate(t0);
    await alerts.evaluate(t0 + 2 * MINUTE);
    expect(fired).toEqual([]);
  });

  it('resolves when the space comes back', async () => {
    const { alerts, resolved } = masterWith(DISK_ALERT_RULE.expression, { id: 'e1' });
    disk.free = 198 * GiB;

    await alerts.evaluate();
    expect(resolved()).toHaveLength(1);
  });

  it('is one the console’s form and the daemon read alike', () => {
    expect(DISK_ALERT_RULE.expression).toBe('host.disk.free < 53687091200');
    expect(readAlertRuleFields(DISK_ALERT_RULE, false).problems).toEqual([]);
    expect(alertRuleTypeOf(DISK_ALERT_RULE.expression)).toBe(DISK_ALERT_RULE.type);
  });
});

describe('a disk that could not be read', () => {
  it('does not fire: «unknown» is not «full»', async () => {
    const { alerts, fired } = masterWith(DISK_ALERT_RULE.expression);

    const t0 = Date.now();
    await alerts.evaluate(t0);
    await alerts.evaluate(t0 + 2 * MINUTE);
    expect(fired).toEqual([]);
  });

  it('does not resolve either — nor is «fine» — and says so', async () => {
    const { alerts, resolved } = masterWith(DISK_ALERT_RULE.expression, { id: 'e1' });

    await alerts.evaluate();
    expect(resolved()).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ ruleName: DISK_ALERT_RULE.name }),
      expect.stringContaining('could not read')
    );
  });
});

describe('the reading', () => {
  it('is taken once a tick, and only when a rule asks', async () => {
    disk.free = 198 * GiB;
    await masterWith('app.*.cpu > 90').alerts.evaluate();
    expect(disk.reads).toBe(0);

    await masterWith(DISK_ALERT_RULE.expression).alerts.evaluate();
    expect(disk.reads).toBe(1);
  });

  it('is the one doctor takes — doctor keeps no statfs of its own', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const doctor = fs.readFileSync(path.resolve(here, '../../src/commands/doctor.ts'), 'utf8');

    expect(doctor).toContain("import { diskAtHome } from '../monitoring/host-disk.js';");
    expect(doctor).not.toMatch(/statfs/);
  });
});
