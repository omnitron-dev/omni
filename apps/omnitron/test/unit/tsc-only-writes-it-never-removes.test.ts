/**
 * A deleted migration kept being applied.
 *
 * `tsc` only writes. It never removes, so a source file that is deleted
 * leaves its compiled output in `dist` forever — and anything that reads
 * that directory as a SET rather than by name keeps reading it.
 *
 * Measured on `@daos/paysys` while its deployment failed:
 *
 *     src/database/migrations   34 files
 *     dist/database/migrations  40 files
 *
 * The extra six included `002_add_financial_indexes.js`, whose source had
 * been replaced by `002_deposit_worker_columns.ts`, and the migration runner
 * still executed it:
 *
 *     ✗ 002_add_financial_indexes: column "sender_asset_id" does not exist
 *
 * — naming a column that migration 001 does create, in a migration nobody
 * has been able to read for however long, against a schema that was
 * otherwise correct. It stopped the app from starting, and it was the last
 * app of six.
 *
 * Five of thirteen packages had more compiled files than sources: paysys
 * +24, priceverse +33, storage +25, main +4.
 *
 * The builds were fixed in that repository, and an artifact build clears its
 * own output here too, for the reason the build record is cleared here: an
 * artifact build is a from-scratch build by definition, nothing about the
 * last one is evidence about this one, and fixing it per app means fixing it
 * again for every app added later.
 *
 * The two halves have to be done together. `rm -rf dist` alone leaves tsc
 * believing the output it just deleted is current, so it emits nothing and
 * exits zero — which is the other half of this same trap, and the reason
 * `clearBuildInfo` exists.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const builder = stripComments(
  fs.readFileSync(path.join(here, '../../src/project/artifact-builder.ts'), 'utf8'),
);

/** `runBuild`, the only place an app is compiled for an artifact. */
function runBuildBody(): string {
  const at = builder.indexOf('private async runBuild(');
  expect(at, 'runBuild is where this test thinks it is').toBeGreaterThan(-1);
  return builder.slice(at, builder.indexOf('\n  }', at));
}

describe('an artifact build starts from nothing', () => {
  it('removes the output before compiling', () => {
    expect(runBuildBody()).toMatch(/rmSync\(path\.join\(appDir, 'dist'\)/);
  });

  it('removes the build record too, and first', () => {
    // Order is the whole thing: `rm -rf dist` with the record left behind
    // makes tsc emit nothing and exit zero, so the artifact ships an empty
    // `dist` and the failure lands at the app's first import.
    const body = runBuildBody();
    const record = body.indexOf('clearBuildInfo(appDir)');
    const output = body.indexOf("rmSync(path.join(appDir, 'dist')");

    expect(record).toBeGreaterThan(-1);
    expect(output).toBeGreaterThan(record);
  });

  it('does both before the compiler runs', () => {
    const body = runBuildBody();
    const output = body.indexOf("rmSync(path.join(appDir, 'dist')");
    const compile = body.indexOf("exec(resolvePnpm(), ['build']");

    expect(compile).toBeGreaterThan(output);
  });

  it('does not fail the build because the output was not there', () => {
    // A first build has no `dist`, and a `dist` somebody else owns is the
    // build's problem to report, not this step's.
    const body = runBuildBody();
    const at = body.indexOf("rmSync(path.join(appDir, 'dist')");
    const around = body.slice(Math.max(0, at - 200), at + 200);

    expect(around).toMatch(/force: true/);
    expect(around).toMatch(/try \{|catch/);
  });
});

describe('every place a build record can hide', () => {
  const clearBody = (() => {
    const src = stripComments(
      fs.readFileSync(path.join(here, '../../src/services/bundle-builder.ts'), 'utf8'),
    );
    const at = src.indexOf('export function clearBuildInfo(');
    return src.slice(at, src.indexOf('\n}', at));
  })();

  it('covers the four spellings this workspace uses', () => {
    for (const name of [
      'tsconfig.tsbuildinfo',
      'tsconfig.build.tsbuildinfo',
      'dist/tsconfig.tsbuildinfo',
      'node_modules',
    ]) {
      expect(clearBody, name).toContain(name);
    }
  });

  it('sweeps the directory a tsconfig.build.json points at', () => {
    // `node_modules/.tmp` holds one record per tsconfig, and naming them
    // individually is how the next one gets missed.
    expect(clearBody).toMatch(/\.tmp/);
    expect(clearBody).toMatch(/endsWith\('\.tsbuildinfo'\)/);
  });
});
