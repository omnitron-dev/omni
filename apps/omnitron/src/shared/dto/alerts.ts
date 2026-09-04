/**
 * Alert DTOs — the wire shapes of the OmnitronAlerts service.
 *
 * Declared away from `services/alert.service.ts` for the reason set out in
 * `./auth.ts`: a DTO that imports from an implementation drags decorators
 * and the server's dependency graph into the console's build.
 */

export type AlertSeverity = 'critical' | 'warning' | 'info';
export type AlertRuleType = 'metric' | 'log' | 'health';
export type AlertEventStatus = 'firing' | 'resolved' | 'silenced' | 'acknowledged';

export interface AlertRule {
  id: string;
  name: string;
  expression: string;
  type: AlertRuleType;
  severity: AlertSeverity;
  forDuration: number | null;
  annotations: Record<string, unknown> | null;
  labels: Record<string, unknown> | null;
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
  firing: number;
  resolved: number;
  silenced: number;
  total: number;
  bySeverity: Record<string, number>;
}

export interface CreateAlertRuleInput {
  name: string;
  expression: string;
  type: string;
  severity: string;
  forDuration?: number;
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
}
