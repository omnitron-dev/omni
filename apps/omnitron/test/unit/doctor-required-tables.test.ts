/**
 * Keeping a hand-written list honest by deriving the truth from source.
 *
 * `omnitron doctor` checks that the tables the daemon queries are actually
 * present — the fourteen-day outage it was written for had an empty database
 * and a daemon answering RPCs perfectly well throughout. The list of tables
 * to look for was maintained by hand, and it named five of fifteen.
 *
 * A third of the schema is enough to look like a check and not enough to be
 * one: `omnitron_users` was absent, so a database that had lost the table
 * nobody can sign in without would have been reported healthy.
 *
 * The list stays a literal — deriving it from the live database would make
 * the comparison vacuous, since the question is which tables are GONE. This
 * test closes the other side, reading the schema declaration itself.
 */

import { describe, it, expect, expectTypeOf } from 'vitest';

import { REQUIRED_TABLES } from '../../src/commands/doctor.js';
import type { OmnitronDatabase } from '../../src/database/schema.js';

describe('doctor REQUIRED_TABLES', () => {
  it('covers every declared and inherited table, checked by the normal test typecheck', () => {
    expectTypeOf<(typeof REQUIRED_TABLES)[number]>().toEqualTypeOf<keyof OmnitronDatabase>();
    expect(REQUIRED_TABLES.length).toBeGreaterThan(10);
    expect(REQUIRED_TABLES).toContain('logs');
    expect(REQUIRED_TABLES).toContain('metrics_samples');
  });

  it('names each table once', () => {
    expect(new Set(REQUIRED_TABLES).size).toBe(REQUIRED_TABLES.length);
  });

  it('includes the tables whose loss is silent', () => {
    // Stated separately from the equality above so the reason survives a
    // future rewrite of that assertion. Losing any of these produces a
    // symptom that reads as something else entirely: nobody can sign in,
    // sessions vanish, alerts never fire.
    expect(REQUIRED_TABLES).toContain('omnitron_users');
    expect(REQUIRED_TABLES).toContain('omnitron_sessions');
    expect(REQUIRED_TABLES).toContain('alert_rules');
  });
});
