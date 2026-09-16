/**
 * Every artifact this fleet has ever shipped was missing its dependencies.
 *
 * `ArtifactBuilder`'s own header says the artifact contains
 * `node_modules/ (production deps only)`. It never did — `createTarball`
 * packed `dist`, `package.json` and `config` — and the deploy step was meant
 * to make up the difference on the node:
 *
 *     npm install --production --ignore-scripts 2>/dev/null || true
 *
 * That install cannot succeed. Run by hand on the test node, in a real
 * artifact directory:
 *
 *     npm error code EUNSUPPORTEDPROTOCOL
 *     npm error Unsupported URL Type "workspace:": workspace:*
 *
 * The app names 31 dependencies and several use pnpm's workspace protocol,
 * which npm does not implement. So the dependencies could not be installed on
 * any node, by that command, ever — and `2>/dev/null || true` discarded both
 * the error and the exit code. Measured on the node:
 * `/opt/omnitron/artifacts/daos/main/0.0.1` has `dist/` and no
 * `node_modules/`.
 *
 * Three things had to hold for this to stay invisible: the doc claimed a
 * content the code did not pack, the install that was supposed to compensate
 * could not run, and its failure was silenced. Fixing the last alone would
 * have produced a loud deployment that still fails.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// @ts-expect-error — a plain .mjs helper shared with the repository's scanners
import { stripComments } from '../../../../scripts/lib/strip-comments.mjs';

const here = dirname(fileURLToPath(import.meta.url));
/**
 * Read through the shared comment stripper.
 *
 * Both files now EXPLAIN the commands they no longer run, so a plain read of
 * the source finds `npm install --production` and `2>/dev/null || true` in the
 * prose that documents why they are gone. A check that matches its subject's
 * description instead of its subject is a check about the wrong thing — which
 * is how the first run of this test failed against a correct fix.
 */
const source = (rel: string) => stripComments(readFileSync(join(here, rel), 'utf8'));

const builder = source('../../src/project/artifact-builder.ts');
const deployer = source('../../src/services/remote-deployer.service.ts');
/** With comments, for the assertions that are ABOUT the explanation. */
const builderProse = readFileSync(join(here, '../../src/project/artifact-builder.ts'), 'utf8');

describe('the artifact carries what the app needs to run', () => {
  it('is built by pnpm deploy, which resolves workspace dependencies', () => {
    // `pnpm deploy` is the built-in answer to exactly this question, and
    // using it means no bundling decisions of our own to get wrong.
    // `resolvePnpm()`, not the literal `'pnpm'`: the daemon's PATH does not
    // contain pnpm's install directory, and the bare name resolved to ENOENT
    // for every app. Asserting the literal here would pin the defect.
    expect(builder).toMatch(/resolvePnpm\(\),\s*\n?\s*\[['"]deploy['"]/);
    expect(builder).toContain("'--prod'");
    // pnpm 10 otherwise demands `inject-workspace-packages`, which is a
    // workspace-wide setting and not this command's to change.
    expect(builder).toContain("'--legacy'");
  });

  it('refuses to call a dependency-less tree an artifact', () => {
    // The fallback still packs something — a caller may want the bytes — but
    // it throws, so nothing downstream can report the deployment as done.
    expect(builder).toContain('ArtifactWithoutDependencies');
    expect(builder).toMatch(/throw new ArtifactWithoutDependencies/);
  });

  it('names the reason in a way the reader can act on', () => {
    // "Build failed" sends someone to the compiler. The workspace protocol is
    // the actual obstacle and installing on the far side is not a workaround,
    // so the message says both.
    expect(builderProse).toMatch(/workspace protocol/i);
    expect(builderProse).toMatch(/npm cannot resolve/i);
  });
});

describe('the deploy step no longer pretends to install them', () => {
  it('does not run the install that cannot succeed', () => {
    expect(deployer).not.toMatch(/npm install --production/);
  });

  it('does not discard a failure with `|| true`', () => {
    // The specific shape that hid this. A command whose failure is discarded
    // is a command whose result nobody can use.
    expect(deployer).not.toMatch(/2>\/dev\/null \|\| true/);
  });

  it('fails the deployment when the dependencies are not there', () => {
    // Checked on the node rather than assumed from the build: an artifact
    // built elsewhere, or an older one already on disk, is exactly the case
    // where the assumption is wrong.
    expect(deployer).toMatch(/node_modules.*present.*missing|test -d.*node_modules/s);
    expect(deployer).toMatch(/carries no node_modules/);
  });
});
