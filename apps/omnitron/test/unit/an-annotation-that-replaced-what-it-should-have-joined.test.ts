/**
 * An alert that said the node it came from stopped saying what was wrong.
 *
 * `getActiveAlerts` read `eventAnnotations ?? ruleAnnotations`, so an event
 * carrying ANY annotations of its own lost every annotation its rule had —
 * including `summary`, which is the sentence the alert list shows. The
 * fallback made that invisible for as long as events never carried
 * annotations of their own.
 *
 * Replicating alerts from a node changed that: the master stamps the node
 * onto every one, so `{node: …}` is now the common case, and an alert
 * annotated with only the node would have rendered as its raw expression.
 *
 * Merged now, with the event's own values winning: the rule's annotations
 * are the template and the event's are what happened.
 */

import { describe, it, expect } from 'vitest';

const { AlertService } = await import('../../src/services/alert.service.js');

const silent: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silent,
};

/** A Kysely stand-in that answers one join with the rows given. */
function dbReturning(rows: unknown[]) {
  const chain: any = new Proxy(
    {},
    { get: (_t, prop) => (prop === 'execute' ? async () => rows : () => chain) },
  );
  return { selectFrom: () => chain };
}

const loggerModule = { logger: silent } as never;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'e1', ruleId: 'r1', status: 'firing', value: '93',
  eventAnnotations: null, ruleAnnotations: { summary: 'disk above 90%' },
  firedAt: '2026-09-15T00:00:00.000Z', resolvedAt: null, acknowledgedAt: null,
  ruleName: 'disk', severity: 'warning', expression: 'disk_percent > 90',
  ...over,
});

const alerts = (rows: unknown[]) =>
  new AlertService(loggerModule, dbReturning(rows) as never, undefined as never)
    .getActiveAlerts();

describe('what an alert says', () => {
  it('keeps the rule summary when the event adds only a node', async () => {
    const [alert] = await alerts([row({ eventAnnotations: { node: 'edge-7' } })]);

    // `??` would have taken `{node}` whole and left `summary` behind, so the
    // list would show `disk_percent > 90 (value: 93)` — the expression, for
    // an alert whose rule has a sentence written for exactly this moment.
    expect(alert!.message).toBe('disk above 90%');
    expect(alert!.node).toBe('edge-7');
  });

  it('lets the event override the rule where both speak', async () => {
    const [alert] = await alerts([
      row({ eventAnnotations: { summary: 'disk above 99% on the replica' } }),
    ]);

    // The rule's annotations are the template; the event's are what happened.
    expect(alert!.message).toBe('disk above 99% on the replica');
  });

  it('says nothing about a node for an alert this master raised', async () => {
    const [alert] = await alerts([row()]);

    expect(alert!.node).toBeNull();
    expect(alert!.message).toBe('disk above 90%');
  });

  it('still falls back to the expression when nothing has a summary', async () => {
    const [alert] = await alerts([row({ ruleAnnotations: null, eventAnnotations: { node: 'edge-7' } })]);

    expect(alert!.message).toBe('disk_percent > 90 (value: 93)');
    expect(alert!.node).toBe('edge-7');
  });
});
