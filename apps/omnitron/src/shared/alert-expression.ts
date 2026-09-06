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
