/**
 * Three drivers declared optional, all three required to import the package.
 *
 * `package.json` says what it means:
 *
 *     "peerDependencies":     { "pg": "…", "mysql2": "…", "better-sqlite3": "…" }
 *     "peerDependenciesMeta": { "pg": {"optional": true},
 *                               "mysql2": {"optional": true},
 *                               "better-sqlite3": {"optional": true} }
 *
 * — install the driver for the database you use. `database.manager.ts` then
 * imported all three at the top of the module, and `database.health.ts`
 * imported `pg` for one `instanceof`. A static import is evaluated before any
 * line of this package runs, so `import '@omnitron-dev/titan-database'`
 * required every driver present. The optionality was a declaration nothing
 * honoured.
 *
 * It never showed, because nothing ever installed this package alone: a pnpm
 * workspace hoists a store where all three happen to be, and a developer's
 * machine has them because some sibling package does.
 *
 * It showed the first time an application was installed for real — six daos
 * backends on a node, `npm install --omit=dev`, resolving exactly what the
 * manifests declare:
 *
 *     Cannot find package 'mysql2' imported from
 *     .../node_modules/@omnitron-dev/titan-database/dist/database.manager.js
 *
 * Postgres applications, every one of them. `better-sqlite3` is a native
 * module that compiles on install and was one resolution away from being the
 * next failure.
 *
 * Two readings this pins, because the source is what node loads:
 *
 *   - no VALUE import of a driver anywhere at module scope. `import type` is
 *     erased by the compiler and costs nothing, which is why the types are
 *     unchanged.
 *   - the compiled output agrees, when there is one. A source check that the
 *     build could contradict is a check of the wrong artifact.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'src');

/** The drivers the manifest calls optional. */
const OPTIONAL_DRIVERS = ['pg', 'mysql2', 'better-sqlite3'];

describe('the manifest and the imports agree', () => {
  it('still declares all three optional', () => {
    // If this ever stops being true the rest of this file is about a rule
    // nobody holds any more, and should be deleted rather than left passing.
    const manifest = JSON.parse(fs.readFileSync(path.join(here, '..', 'package.json'), 'utf8'));
    for (const driver of OPTIONAL_DRIVERS) {
      expect(manifest.peerDependencies?.[driver], `${driver} peer range`).toBeTruthy();
      expect(manifest.peerDependenciesMeta?.[driver]?.optional, `${driver} optional`).toBe(true);
    }
  });

  it('imports none of them as a value, anywhere in src', () => {
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.ts')) continue;

        // Through `stripComments`, so a docblock quoting the old line — this
        // file's own subject — is not read as the line.
        const code = stripComments(fs.readFileSync(full, 'utf8'));
        for (const line of code.split('\n')) {
          const m = /^\s*import\s+(type\s+)?(.*?)\s*from\s*['"]([^'"]+)['"]/.exec(line);
          if (!m) continue;
          const [, isType, , spec] = m;
          if (isType) continue;
          // `import type * as mysql from 'mysql2'` puts the `type` after the
          // keyword in one spelling and before the clause in another.
          if (/^\s*import\s+type\b/.test(line)) continue;
          if (OPTIONAL_DRIVERS.includes(spec!)) {
            offenders.push(`${path.relative(src, full)}: ${line.trim()}`);
          }
        }
      }
    };
    walk(src);

    expect(offenders, 'a value import of an optional driver makes it mandatory').toEqual([]);
  });

  it('says which package to install when one is genuinely missing', async () => {
    // `ERR_MODULE_NOT_FOUND` names a file path inside a dependency of a
    // dependency. The reader needs the package name and the reason it is not
    // already there.
    const { DatabaseManager } = await import('../src/database.manager.js');
    expect(DatabaseManager).toBeTruthy();

    const manager = fs.readFileSync(path.join(src, 'database.manager.ts'), 'utf8');
    expect(manager).toMatch(/optional peer dependency/i);
    for (const driver of OPTIONAL_DRIVERS) {
      expect(manager).toContain(`'${driver}'`);
    }
  });
});

describe('the compiled output is what node actually loads', () => {
  const dist = path.join(here, '..', 'dist');

  it.skipIf(!fs.existsSync(dist))('carries no static driver import either', () => {
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
          // A static `import … from 'mysql2'` only. `await import('mysql2')`
          // is the whole point of the fix and must not be caught.
          const m = /^\s*import\s[^(]*?from\s*['"]([^'"]+)['"]/.exec(line);
          if (m && OPTIONAL_DRIVERS.includes(m[1]!)) {
            offenders.push(`${path.relative(dist, full)}: ${line.trim()}`);
          }
        }
      }
    };
    walk(dist);

    expect(offenders, 'this is the line the node reported as unresolvable').toEqual([]);
  });
});

describe('a pool is recognised by what is read off it', () => {
  it('does not depend on sharing one copy of pg', async () => {
    // `instanceof Pool` needed `pg` as a value — and is false across two
    // copies of `pg` in one tree, which npm's flat layout can produce. So the
    // check that forced the driver to be mandatory would ALSO have reported
    // no statistics for a real pool, silently, in exactly the installation
    // shape this package is now built for.
    const { DatabaseHealthIndicator } = await import('../src/database.health.js');
    const stats = (DatabaseHealthIndicator.prototype as unknown as {
      getPoolStatistics(pool: unknown): unknown;
    }).getPoolStatistics;

    const fakePgPool = { totalCount: 10, idleCount: 4, waitingCount: 2 };
    expect(stats.call({}, fakePgPool)).toEqual({ total: 10, active: 6, idle: 4, waiting: 2 });

    // And a mysql pool still takes the branch written for it.
    expect(stats.call({}, { _allConnections: [1, 2, 3] })).toEqual({
      total: 3,
      active: 0,
      idle: 0,
      waiting: 0,
    });

    expect(stats.call({}, null)).toBeUndefined();
  });
});
