/**
 * The alert expressions this platform can evaluate.
 *
 * Shared between the daemon and the console on purpose. The evaluator
 * answers anything it cannot parse with `firing: false` — the same answer a
 * healthy platform gives — so a rule outside this grammar is created
 * successfully, shows enabled and green, and catches nothing. There is no
 * later moment at which anybody finds out.
 *
 * The console's own placeholder used to read `cpu_percent > 90`, which is
 * not one of these forms: the interface was suggesting an expression that
 * could never fire. Keeping the grammar in one dependency-free module is
 * what lets the form reject it before the rule exists, the evaluator report
 * it if one slips through, and `omnitron doctor` find the ones already
 * stored — all from the same list.
 */

/** Every expression form `evaluateExpression` recognises. */
export const ALERT_EXPRESSION_FORMS = [
  /^app\.(\*|[\w-]+)\.status\s*(!=|==)\s*(\w+)$/,
  /^app\.(\*|[\w-]+)\.(cpu|memory)\s*(>|<|>=|<=)\s*(\d+)$/,
  /^infra\.(\*|[\w-]+)\.health\s*(!=|==)\s*(\w+)$/,
] as const;

/** Human-readable grammar, for a message that has to tell someone what to type. */
export const ALERT_EXPRESSION_HELP =
  'app.<name|*>.status != <status> · app.<name|*>.<cpu|memory> <op> <number> · infra.<name|*>.health != <status>';

/** Whether the evaluator can read this expression at all. */
export function isAlertExpressionParseable(expression: string): boolean {
  const trimmed = expression.trim();
  return ALERT_EXPRESSION_FORMS.some((form) => form.test(trimmed));
}

// =============================================================================
// Rules — what a rule is made of, checked the same way in the form and the daemon
// =============================================================================

/** Ascending: a threshold of `warning` notifies for `warning` and `critical`. */
export const ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export function severityRank(severity: string): number {
  return ALERT_SEVERITIES.indexOf(severity as AlertSeverity);
}

/**
 * What a rule watches, read off its expression — a state (`health`) or a
 * figure (`metric`). It used to be chosen in the form, beside the expression
 * that already said it, and nothing read the choice: a rule could be filed
 * as `log`, a kind the grammar has no form for.
 */
export function alertRuleTypeOf(expression: string): 'metric' | 'health' | null {
  const trimmed = expression.trim();
  if (ALERT_EXPRESSION_FORMS[1].test(trimmed)) return 'metric';
  if (ALERT_EXPRESSION_FORMS[0].test(trimmed) || ALERT_EXPRESSION_FORMS[2].test(trimmed)) return 'health';
  return null;
}

export const ALERT_RULE_LIMITS = { name: 100, expression: 200, summary: 500, forDuration: 86_400 } as const;

export interface AlertRuleFields {
  name: string;
  expression: string;
  severity: AlertSeverity;
  /** Seconds the condition must hold before the alert fires; null fires at once. */
  forDuration: number | null;
  /** The sentence the alert is listed with; null lists the expression and its value. */
  summary: string | null;
  enabled: boolean;
}

/**
 * The fields of a rule as a client sends them, checked and normalised — one
 * function for the console's form and for the daemon, so the two cannot
 * drift. `partial` reads an update: absent fields stay absent. Every problem
 * is named, one per field.
 */
export function readAlertRuleFields(
  input: unknown,
  partial: boolean,
): { fields: Partial<AlertRuleFields>; problems: string[] } {
  const raw = (input !== null && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const fields: Partial<AlertRuleFields> = {};
  const problems: string[] = [];
  const present = (key: string) => raw[key] !== undefined;

  if (present('name') || !partial) {
    const name = typeof raw['name'] === 'string' ? raw['name'].trim() : '';
    if (name.length === 0 || name.length > ALERT_RULE_LIMITS.name) {
      problems.push(`name: 1 to ${ALERT_RULE_LIMITS.name} characters`);
    } else fields.name = name;
  }
  if (present('expression') || !partial) {
    const expression = typeof raw['expression'] === 'string' ? raw['expression'].trim() : '';
    if (expression.length > ALERT_RULE_LIMITS.expression || !isAlertExpressionParseable(expression)) {
      problems.push(`expression: not one the evaluator reads — ${ALERT_EXPRESSION_HELP}`);
    } else fields.expression = expression;
  }
  if (present('severity') || !partial) {
    const severity = raw['severity'];
    if (typeof severity !== 'string' || severityRank(severity) < 0) {
      problems.push(`severity: one of ${ALERT_SEVERITIES.join(', ')}`);
    } else fields.severity = severity as AlertSeverity;
  }
  if (present('forDuration')) {
    const seconds = raw['forDuration'];
    if (seconds === null) fields.forDuration = null;
    else if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 0 || seconds > ALERT_RULE_LIMITS.forDuration) {
      problems.push(`forDuration: whole seconds from 0 to ${ALERT_RULE_LIMITS.forDuration}, or null`);
    } else fields.forDuration = seconds === 0 ? null : seconds;
  } else if (!partial) fields.forDuration = null;
  if (present('summary')) {
    const summary = raw['summary'];
    if (summary === null || (typeof summary === 'string' && summary.trim() === '')) fields.summary = null;
    else if (typeof summary !== 'string' || summary.trim().length > ALERT_RULE_LIMITS.summary) {
      problems.push(`summary: at most ${ALERT_RULE_LIMITS.summary} characters`);
    } else fields.summary = summary.trim();
  } else if (!partial) fields.summary = null;
  if (present('enabled')) {
    if (typeof raw['enabled'] !== 'boolean') problems.push('enabled: true or false');
    else fields.enabled = raw['enabled'];
  } else if (!partial) fields.enabled = true;

  return { fields, problems };
}
