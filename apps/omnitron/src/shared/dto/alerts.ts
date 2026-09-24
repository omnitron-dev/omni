/**
 * Alert DTOs — the wire shapes of the OmnitronAlerts service.
 *
 * Declared away from `services/alert.service.ts` for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators
 * and the server's dependency graph into the console's build.
 */

import type { AlertSeverity } from '../alert-expression.js';

export type { AlertSeverity };
/** Read off the expression (`alertRuleTypeOf`), never chosen: a state or a figure. */
export type AlertRuleType = 'metric' | 'health';
/**
 * Two states. `acknowledged` and `silenced` were in this union and nothing
 * ever wrote them — an acknowledgement is who and when on a firing alert
 * (`acknowledgedAt`), not a third state it leaves for.
 */
export type AlertEventStatus = 'firing' | 'resolved';

export interface AlertRule {
  id: string;
  name: string;
  expression: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  /** Seconds the condition must hold before the alert fires; null fires at once. */
  forDuration: number | null;
  /** The sentence the alert is listed with; null lists the expression and its value. */
  summary: string | null;
  enabled: boolean;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  status: AlertEventStatus;
  value: string | null;
  annotations: Record<string, unknown> | null;
  firedAt: string;
  resolvedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
}

export interface AlertSummary {
  /** Firing now, acknowledged or not. */
  firing: number;
  /** Of those, acknowledged by someone. */
  acknowledged: number;
  resolved: number;
  total: number;
  /** Firing now, by severity. */
  bySeverity: Record<AlertSeverity, number>;
}

/** A new rule — checked by `readAlertRuleFields`, in the form and again in the daemon. */
export interface CreateAlertRuleInput {
  name: string;
  expression: string;
  severity: AlertSeverity;
  forDuration?: number | null;
  summary?: string | null;
  enabled?: boolean;
}

/** A change to a rule: whatever is present, checked the same way. */
export interface UpdateAlertRuleInput {
  id: string;
  name?: string;
  expression?: string;
  severity?: AlertSeverity;
  forDuration?: number | null;
  summary?: string | null;
  enabled?: boolean;
}

/**
 * An alert event joined with the rule that produced it.
 *
 * The console renders a severity chip and a rule name next to every firing
 * alert, but `AlertEvent` carries neither — severity and name live on the
 * rule. It was calling a `listActiveAlerts()` that had never been
 * implemented, so the page 404'd on load and rendered nothing. Doing the
 * join on the server keeps it one query instead of a fetch-rules-then-match
 * round trip in the browser.
 */
export interface ActiveAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  severity: AlertSeverity;
  message: string;
  firedAt: string;
  resolvedAt: string | null;
  acknowledged: boolean;
  /**
   * The node that raised it, or null when this master raised it itself.
   *
   * A replicated alert carries it in `annotations.node` — `alert_events` has
   * no column for a node, and an alert that says "disk above 90%" without
   * saying whose disk is one nobody can act on.
   */
  node: string | null;
}
