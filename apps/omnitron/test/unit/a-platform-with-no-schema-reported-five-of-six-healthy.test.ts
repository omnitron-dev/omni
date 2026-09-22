/**
 * Every database on the node existed and held zero tables.
 *
 * `ProjectService` migrates a stack by executing
 * `apps/<name>/src/database/migrate.ts` from the PROJECT PATH, against
 * `localhost`. Both of those name the machine the master is on: a node has no
 * project sources — it receives compiled artifacts — and a different
 * localhost. So a remote stack's databases were created and never migrated,
 * and nothing in the deployment said so.
 *
 * Measured on the test node after six apps installed and five started:
 *
 *     main        tables=0
 *     geo         tables=0
 *     storage     tables=0
 *     messaging   tables=0
 *     priceverse  tables=0
 *     paysys      tables=0
 *
 * Five came up anyway, because they touch no table at boot. `paysys` does:
 *
 *     Failed to call @PostConstruct 'bootstrap' on 'PlatformRevenueService':
 *     relation "accounts" does not exist
 *
 * — the only reason anyone found out. A platform with no schema at all that
 * reports five of six apps healthy is a worse state than one that refuses to
 * start, because the first thing anybody does with it is believe it.
 *
 * What was missing was not the migrations. The artifact already carries
 * `dist/database/migrate.js` beside `dist/database/migrations/` — 160
 * compiled files for paysys, from the same build the app runs from, so there
 * is no second copy of the schema to drift. Nothing ran it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const deployer = stripComments(
  fs.readFileSync(path.join(here, '../../src/services/remote-deployer.service.ts'), 'utf8'),
);

/**
 * `migrateNodeApps`, from its signature to the brace that closes it.
 *
 * Each case below read `deployer.slice(at, at + 2200)` — a window of
 * characters, not the method — and a guard added near the top pushed the
 * migration's own `catch` past 2400 of them: red over a method that still
 * did what the case asked. A method at class level closes on a line of two
 * spaces and a brace.
 */
const migrateNodeApps = (() => {
  const at = deployer.indexOf('private async migrateNodeApps(');
  return at === -1 ? '' : deployer.slice(at, deployer.indexOf('\n  }\n', at));
})();

describe('the schema arrives before the apps that read it', () => {
  it('runs the migrations on the node', () => {
    expect(deployer).toContain('migrateNodeApps');
    expect(deployer).toMatch(/dist\/database\/migrate\.js/);
    // The body every case below reads is the whole method and no more.
    expect(migrateNodeApps.trimEnd().endsWith('return failed;'), 'migrateNodeApps is where this test thinks it is').toBe(true);
  });

  it('runs them after the config is written and before anything starts', () => {
    // The order is the whole point: the config carries `DATABASE_URL`, the
    // migrations need it, and the apps need the tables. Any other order
    // leaves one of the three holding nothing.
    //
    // Scoped to `deployToStack`, because `signalRemoteDaemon` is also called
    // from the single-app path earlier in the file — a whole-file `indexOf`
    // answers about the wrong one, which is how this assertion first failed
    // against code that was correct.
    const from = deployer.indexOf('async deployToStack(');
    expect(from, 'deployToStack is where this test thinks it is').toBeGreaterThan(-1);
    const region = deployer.slice(from, deployer.indexOf('\n  }', deployer.indexOf('return results;', from)));

    const register = region.indexOf('await this.registerNodeApps(');
    const migrate = region.indexOf('await this.migrateNodeApps(');
    const start = region.indexOf('await this.signalRemoteDaemon(');

    expect(register).toBeGreaterThan(-1);
    expect(migrate).toBeGreaterThan(register);
    expect(start).toBeGreaterThan(migrate);
  });

  it('takes the connection from what the app was given', () => {
    // Not recomputed here. The URL the migration runs against and the URL the
    // app connects with have to be the same string, or the schema lands
    // somewhere the app will not look.
    const body = migrateNodeApps;

    expect(body).toMatch(/appEnv\?\.\[entry\.app\]\?\.\['DATABASE_URL'\]/);
  });

  it('skips an app that ships no migrator rather than failing it', () => {
    const body = migrateNodeApps;

    expect(body).toMatch(/test -f/);
    expect(body).toMatch(/continue/);
  });

  it('keeps the URL out of the process listing', () => {
    // A password on a command line is readable by every process on the host.
    // Every value goes in the environment of that one command, through one
    // assignment list that escapes each of them.
    const body = migrateNodeApps;

    expect(body).toMatch(/DATABASE_URL: databaseUrl/);
    expect(body).toMatch(/\$\{k\}=\$\{shellEscape\(v\)\}/);
    // Not interpolated into the command itself.
    expect(body).not.toMatch(/node \$\{shellEscape\(script\)\}.*databaseUrl/);
  });

  it('reports a failure and lets the deployment continue', () => {
    // A failed migration fails that app — its new code is not started, see
    // a-schema-that-did-not-arrive — and the deployment goes on for the
    // rest: stopping all of it would hide the other five.
    const body = migrateNodeApps;

    expect(body).toMatch(/catch \(err\)/);
    expect(body).toMatch(/Database migrations failed on the node/);
  });

  it('builds the remote path through the segment guard', () => {
    const body = migrateNodeApps;

    expect(body).toMatch(/assertRemotePathSegment\('project name', project\)/);
    expect(body).toMatch(/assertRemotePathSegment\('app name', entry\.app\)/);
    expect(body).toMatch(/assertRemotePathSegment\('version', entry\.version\)/);
  });
});

describe('the migrator is given the environment it actually reads', () => {
  /**
   * The step ran for all six apps and every one failed:
   *
   *     Migration failed: password authentication failed for user "postgres"
   *
   * — against a password that was correct. `apps/paysys/src/database/migrate.ts`
   * declares `envPrefix: 'PAYSYS__DATABASE'` and builds its connection from
   * `PAYSYS__DATABASE__HOST` / `__PORT` / `__USER` / `__PASSWORD` /
   * `__DATABASE`. Given only `DATABASE_URL` it never read the value it was
   * sent and fell back to its own defaults.
   *
   * `ProjectService` passes both spellings, with the comment "App-specific
   * env vars (various naming conventions)". This was the second caller, and
   * a convention nobody wrote down costs exactly this much when one appears.
   */
  it('passes the app-prefixed variables as well as the URL', () => {
    const body = migrateNodeApps;

    expect(body).toMatch(/__DATABASE__HOST/);
    expect(body).toMatch(/__DATABASE__PORT/);
    expect(body).toMatch(/__DATABASE__USER/);
    expect(body).toMatch(/__DATABASE__PASSWORD/);
    expect(body).toMatch(/__DATABASE__DATABASE/);
    expect(body).toMatch(/DATABASE_URL: databaseUrl/);
  });

  it('derives them from the one URL, so the two cannot disagree', () => {
    const body = migrateNodeApps;

    expect(body).toMatch(/parseDatabaseUrl\(databaseUrl\)/);
  });

  it('keeps every value in the environment, never on the command line', () => {
    const body = migrateNodeApps;

    // One assignment list, every value shell-escaped, nothing appended to
    // the command itself.
    expect(body).toMatch(/\$\{k\}=\$\{shellEscape\(v\)\}/);
  });
});
