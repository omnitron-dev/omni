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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { REQUIRED_TABLES } from '../../src/commands/doctor.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The members of `interface OmnitronDatabase` — the schema's own statement. */
function declaredTables(): string[] {
  const source = readFileSync(path.resolve(here, '../../src/database/schema.ts'), 'utf8');
  const start = source.indexOf('export interface OmnitronDatabase {');
  expect(start, 'OmnitronDatabase moved or was renamed').toBeGreaterThan(-1);

  const body = source.slice(start, source.indexOf('\n}', start));
  return [...body.matchAll(/^\s{2}(\w+):\s/gm)].map((m) => m[1]!);
}

describe('doctor REQUIRED_TABLES', () => {
  it('covers every table the schema declares', () => {
    const declared = declaredTables();

    // Sanity on the extraction itself: a regex that matched nothing would
    // make every assertion below pass for the wrong reason.
    expect(declared.length).toBeGreaterThan(10);
    expect(declared).toContain('logs');

    expect([...REQUIRED_TABLES].sort()).toEqual([...declared].sort());
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
