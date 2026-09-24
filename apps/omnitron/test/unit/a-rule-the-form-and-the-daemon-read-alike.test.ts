/**
 * A rule the form and the daemon read alike.
 *
 * A rule is a name, an expression, a severity, a wait and a sentence. Each
 * had a different checker in each place, or none: `updateRule` stored
 * whatever `Partial<AlertRule>` it was sent — an `id`, a `createdAt`, a
 * `type` — the form checked the expression alone, and a rule's `type` was
 * picked in the form beside the expression that already said it, and read
 * by nothing. `readAlertRuleFields` is now the one reading: the console runs
 * it before sending, the RPC before storing.
 *
 * And a rule's acknowledgement named whoever the request said, so any
 * operator could sign one with another's name. The session says who.
 */

import { describe, it, expect, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  ALERT_EXPRESSION_FORMS,
  ALERT_RULE_LIMITS,
  alertRuleTypeOf,
  readAlertRuleFields,
  severityRank,
} from '../../src/shared/alert-expression.js';
import { AlertRpcService } from '../../src/services/alert.rpc-service.js';
import { AlertService } from '../../src/services/alert.service.js';
import { runWithAuth } from '../../src/services/auth-context.js';

const create = (input: unknown) => readAlertRuleFields(input, false);
const update = (input: unknown) => readAlertRuleFields(input, true);
const fieldsOf = (problems: string[]) => problems.map((p) => p.slice(0, p.indexOf(':')));

describe('a new rule', () => {
  it('names every missing field, one problem each', () => {
    expect(fieldsOf(create({}).problems)).toEqual(['name', 'expression', 'severity']);
    // Not an object at all reads as empty — never a throw from inside the check.
    for (const input of [null, 'rule', 42]) expect(fieldsOf(create(input).problems)).toHaveLength(3);
  });

  it('with only what it needs fires at once, lists its expression, and is on', () => {
    const { fields, problems } = create({ name: ' Disk ', expression: ' app.main.cpu > 80 ', severity: 'info' });
    expect(problems).toEqual([]);
    expect(fields).toEqual({
      name: 'Disk',
      expression: 'app.main.cpu > 80',
      severity: 'info',
      forDuration: null,
      summary: null,
      enabled: true,
    });
  });

  it('with an expression the evaluator cannot read says what it can', () => {
    const [problem] = create({ name: 'Disk', expression: 'disk.usage > 90', severity: 'warning' }).problems;
    expect(problem).toMatch(/^expression: not one the evaluator reads — app\.<name\|\*>\.status/);
  });
});

describe('an update', () => {
  it('reads only what it carries', () => {
    expect(update({ enabled: false })).toEqual({ fields: { enabled: false }, problems: [] });
    expect(update({ summary: '   ' })).toEqual({ fields: { summary: null }, problems: [] });
    expect(update({})).toEqual({ fields: {}, problems: [] });
  });
});

describe('each field', () => {
  it.each([1.5, -1, ALERT_RULE_LIMITS.forDuration + 1, '60'])('a wait of %j is refused', (forDuration) => {
    expect(fieldsOf(update({ forDuration }).problems)).toEqual(['forDuration']);
  });

  it('a wait of zero, or none, fires at once; a day is the longest', () => {
    expect(update({ forDuration: 0 }).fields).toEqual({ forDuration: null });
    expect(update({ forDuration: null }).fields).toEqual({ forDuration: null });
    expect(update({ forDuration: 86_400 }).fields).toEqual({ forDuration: 86_400 });
  });

  it('a severity is one of three, in rank order — not a log level', () => {
    expect(severityRank('info')).toBeLessThan(severityRank('warning'));
    expect(severityRank('warning')).toBeLessThan(severityRank('critical'));
    for (const severity of ['error', 'fatal', 'warn']) {
      expect(fieldsOf(update({ severity }).problems), severity).toEqual(['severity']);
    }
  });

  it('a summary is at most 500 characters, and blank is none', () => {
    expect(fieldsOf(update({ summary: 'x'.repeat(501) }).problems)).toEqual(['summary']);
    expect(update({ summary: '' }).fields).toEqual({ summary: null });
  });

  it('on or off is a boolean', () => {
    expect(fieldsOf(update({ enabled: 'yes' }).problems)).toEqual(['enabled']);
  });
});

describe('what a rule watches', () => {
  it('is read off its expression, for every form the evaluator reads', () => {
    expect(alertRuleTypeOf('app.*.cpu > 90')).toBe('metric');
    expect(alertRuleTypeOf('app.main.memory >= 1024')).toBe('metric');
    expect(alertRuleTypeOf('app.*.status == crashed')).toBe('health');
    expect(alertRuleTypeOf('infra.*.health != healthy')).toBe('health');
    expect(alertRuleTypeOf('log.error.count > 10')).toBeNull();
    expect(ALERT_EXPRESSION_FORMS).toHaveLength(3);
  });
});

describe('the RPC', () => {
  const service = () => {
    const alertService = {
      createRule: vi.fn(async (fields: unknown) => fields),
      updateRule: vi.fn(async (_id: string, fields: unknown) => fields),
      acknowledgeAlert: vi.fn(async () => true),
    };
    return { rpc: new AlertRpcService(alertService as never), alertService };
  };

  it('refuses what the form refuses, naming each problem, and stores nothing', async () => {
    const { rpc, alertService } = service();
    await expect(
      rpc.createRule({ name: 'Disk', expression: 'disk.usage > 90', severity: 'error' } as never)
    ).rejects.toThrow(/createRule: expression: not one the evaluator reads.*; severity: one of info, warning, critical/);
    expect(alertService.createRule).not.toHaveBeenCalled();
  });

  it('takes no type from the caller — it is the expression’s', async () => {
    const { rpc, alertService } = service();
    await rpc.createRule({ name: 'Hot', expression: 'app.*.cpu > 90', severity: 'warning', type: 'log' } as never);
    expect(alertService.createRule.mock.calls[0]![0]).not.toHaveProperty('type');
  });

  it('updates only the fields it read — never an id, a date or a type from the payload', async () => {
    const { rpc, alertService } = service();
    await rpc.updateRule({ id: 'r1', enabled: false, createdAt: '2020-01-01', type: 'log' } as never);
    expect(alertService.updateRule).toHaveBeenCalledWith('r1', { enabled: false });
  });

  it('signs an acknowledgement with the session’s user, whatever name the payload carries', async () => {
    const { rpc, alertService } = service();
    await runWithAuth({ userId: 'u-7', roles: ['operator'], permissions: [] } as never, () =>
      rpc.acknowledgeAlert({ alertId: 'e1', acknowledgedBy: 'another-operator' } as never)
    );
    expect(alertService.acknowledgeAlert).toHaveBeenCalledWith('e1', 'u-7');
  });
});

describe('the evaluation loop', () => {
  it('is one — the scheduler’s job; the service keeps no timer of its own', () => {
    const SRC = new URL('../../src/', import.meta.url).pathname;
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return name.endsWith('.ts') ? [path] : [];
      });
    const callers = sources(SRC)
      .filter((path) => /alertService\??\.evaluate\(/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(SRC, path));

    expect(callers).toEqual(['daemon/daemon-scheduler.ts']);
    expect('start' in AlertService.prototype).toBe(false);
    expect('stop' in AlertService.prototype).toBe(false);
  });
});
