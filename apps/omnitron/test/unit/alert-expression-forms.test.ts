/**
 * Which alert expressions the evaluator can actually read.
 *
 * `evaluateExpression` answers anything it does not recognise with
 * `firing: false` — the same answer a healthy platform gives — so a rule the
 * evaluator cannot read sits in the console enabled, green, and permanently
 * inert. `omnitron doctor` reports those as `alerts.unreadable-rule`, and it
 * asks this predicate rather than keeping its own copy of the grammar: two
 * lists would eventually disagree about which rules work, and the
 * disagreement would be silent on both sides.
 */

import { describe, it, expect } from 'vitest';

import { isAlertExpressionParseable } from '../../src/services/alert.service.js';

describe('expressions the evaluator understands', () => {
  it.each([
    'app.main.status != online',
    'app.*.status == errored',
    'app.main.cpu > 80',
    'app.*.memory >= 1024',
    'infra.postgres.health != healthy',
    'infra.*.health == unhealthy',
  ])('accepts %s', (expression) => {
    expect(isAlertExpressionParseable(expression)).toBe(true);
  });

  it('ignores surrounding whitespace, as the evaluator does', () => {
    expect(isAlertExpressionParseable('  app.main.cpu > 80  ')).toBe(true);
  });
});

describe('expressions it cannot', () => {
  it.each([
    // Plausible, and none of them work — which is the whole problem: each
    // reads like something an operator would write after seeing the others.
    'disk.usage > 90',
    'app.main.restarts > 3',
    'app.main.cpu > 80%',
    'app.main.status != online AND app.main.cpu > 80',
    'log.error.count > 100',
    '',
  ])('rejects %s', (expression) => {
    expect(isAlertExpressionParseable(expression)).toBe(false);
  });

  it('rejects a form that is close but not exact', () => {
    // `status` takes `!=` or `==`, not `<`; a rule written this way would
    // have been accepted by nothing and reported by nothing.
    expect(isAlertExpressionParseable('app.main.status < online')).toBe(false);
    // Metrics take a number, not a quoted one.
    expect(isAlertExpressionParseable("app.main.cpu > '80'")).toBe(false);
  });
});
