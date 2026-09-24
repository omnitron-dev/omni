/**
 * Migration 011: alerts nobody had to write.
 *
 * A fresh master evaluated every rule in `alert_rules`, and there were none:
 * nothing watched anything until an operator knew the grammar and wrote a
 * rule. These are the ones a platform wants from its first hour — an app
 * that crashed or is erroring, a container that is unhealthy, an app that
 * holds nine tenths of a core or two gibibytes of resident memory for five
 * minutes.
 *
 * Seeded ONCE, here, rather than at every start: a default an operator
 * deletes stays deleted, and one they edit stays edited. `ON CONFLICT (name)`
 * leaves alone a rule an operator already made under the same name.
 * `down` removes only rules still exactly as seeded.
 */

import { sql, type Kysely } from 'kysely';

/** Exported for the court that checks each is one the evaluator reads. */
export const DEFAULT_ALERT_RULES = [
  {
    name: 'App crashed',
    expression: 'app.*.status == crashed',
    type: 'health',
    severity: 'critical',
    forDuration: null,
    summary: 'An app crashed',
  },
  {
    name: 'App erroring',
    expression: 'app.*.status == errored',
    type: 'health',
    severity: 'critical',
    forDuration: 60,
    summary: 'An app has been in the errored state for a minute',
  },
  {
    name: 'Container unhealthy',
    expression: 'infra.*.health == unhealthy',
    type: 'health',
    severity: 'critical',
    forDuration: 60,
    summary: 'A container has been unhealthy for a minute',
  },
  {
    name: 'CPU above 90%',
    expression: 'app.*.cpu > 90',
    type: 'metric',
    severity: 'warning',
    forDuration: 300,
    // `ps %cpu`: a share of one core, summed over the app's processes.
    summary: 'An app has used more than 90% of a CPU core for five minutes',
  },
  {
    name: 'Memory above 2 GiB',
    expression: 'app.*.memory > 2147483648',
    type: 'metric',
    severity: 'warning',
    forDuration: 300,
    summary: 'An app has held more than 2 GiB of memory for five minutes',
  },
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const rule of DEFAULT_ALERT_RULES) {
    await sql`
      INSERT INTO alert_rules (name, expression, type, severity, "forDuration", annotations, enabled)
      VALUES (${rule.name}, ${rule.expression}, ${rule.type}, ${rule.severity}, ${rule.forDuration},
              ${JSON.stringify({ summary: rule.summary })}::jsonb, true)
      ON CONFLICT (name) DO NOTHING
    `.execute(db);
  }
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const rule of DEFAULT_ALERT_RULES) {
    await sql`
      DELETE FROM alert_rules
      WHERE name = ${rule.name} AND expression = ${rule.expression} AND severity = ${rule.severity}
    `.execute(db);
  }
}
