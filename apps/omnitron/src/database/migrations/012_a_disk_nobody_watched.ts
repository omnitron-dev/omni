/**
 * A disk nobody watched.
 *
 * The master's disk reached 99% and stopped the container engine three times
 * — 2026-07-01, 09-14, 09-29 — and nobody was warned before any of them. The
 * only check was `omnitron doctor`'s, which runs when somebody runs it and
 * warns below 10 GiB; the engine stopped on its own at 21 GiB free of 1.8 TiB
 * on 09-29, with 112 GB of dead test-runner copies in ~/.tmp.
 *
 * One rule, seeded like the five of migration 011: `host.disk.free` below
 * 50 GiB for a minute, critical. ON CONFLICT (name) DO NOTHING, so a rule an
 * operator deleted stays deleted and one they edited stays theirs; `down`
 * takes back only the row still exactly as seeded.
 */
import { sql, type Kysely } from 'kysely';

export const DISK_ALERT_RULE = {
  name: 'Disk space below 50 GiB',
  expression: `host.disk.free < ${50 * 1024 ** 3}`,
  type: 'metric',
  severity: 'critical',
  forDuration: 60,
  summary: "Less than 50 GiB free on this host's disk for a minute — the container engine stops near full",
} as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  const rule = DISK_ALERT_RULE;
  await sql`
    INSERT INTO alert_rules (name, expression, type, severity, "forDuration", annotations, enabled)
    VALUES (${rule.name}, ${rule.expression}, ${rule.type}, ${rule.severity}, ${rule.forDuration},
            ${JSON.stringify({ summary: rule.summary })}::jsonb, true)
    ON CONFLICT (name) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  const rule = DISK_ALERT_RULE;
  await sql`
    DELETE FROM alert_rules
    WHERE name = ${rule.name} AND expression = ${rule.expression} AND severity = ${rule.severity}
  `.execute(db);
}
