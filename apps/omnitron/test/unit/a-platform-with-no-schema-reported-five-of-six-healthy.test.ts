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

describe('the schema arrives before the apps that read it', () => {
  it('runs the migrations on the node', () => {
    expect(deployer).toContain('migrateNodeApps');
    expect(deployer).toMatch(/dist\/database\/migrate\.js/);
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
    const at = deployer.indexOf('private async migrateNodeApps(');
    const body = deployer.slice(at, at + 2200);

    expect(body).toMatch(/appEnv\?\.\[entry\.app\]\?\.\['DATABASE_URL'\]/);
  });

  it('skips an app that ships no migrator rather than failing it', () => {
    const at = deployer.indexOf('private async migrateNodeApps(');
    const body = deployer.slice(at, at + 2200);

    expect(body).toMatch(/test -f/);
    expect(body).toMatch(/continue/);
  });

  it('keeps the URL out of the process listing', () => {
    // A password on a command line is readable by every process on the host.
    // It goes in the environment of that one command.
    const at = deployer.indexOf('private async migrateNodeApps(');
    const body = deployer.slice(at, at + 2200);

    expect(body).toMatch(/DATABASE_URL=\$\{shellEscape\(databaseUrl\)\}/);
  });

  it('reports a failure and lets the deployment continue', () => {
    // The app's own start will fail with the name of the table it wanted,
    // which is more specific than anything this step could say. Stopping the
    // whole deployment would hide the other five.
    const at = deployer.indexOf('private async migrateNodeApps(');
    const body = deployer.slice(at, at + 2400);

    expect(body).toMatch(/catch \(err\)/);
    expect(body).toMatch(/Database migrations failed on the node/);
  });

  it('builds the remote path through the segment guard', () => {
    const at = deployer.indexOf('private async migrateNodeApps(');
    const body = deployer.slice(at, at + 2200);

    expect(body).toMatch(/assertRemotePathSegment\('project name', project\)/);
    expect(body).toMatch(/assertRemotePathSegment\('app name', entry\.app\)/);
    expect(body).toMatch(/assertRemotePathSegment\('version', entry\.version\)/);
  });
});
