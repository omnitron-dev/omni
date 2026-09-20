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
  it('is built the way the daemon\'s own bundle is', () => {
    // `pnpm deploy --prod --legacy` was what this asserted, and it was the
    // wrong instrument for one class of dependency: a `link:` range names a
    // directory outside the workspace, `pnpm deploy` reproduces it as a
    // symlink, and twenty-three of those per artifact pointed into a home
    // directory the node does not have. `--legacy` was the warning — without
    // it pnpm 10 refuses and asks for the setting that makes a deploy
    // self-contained.
    //
    // `buildBundle` packs each such dependency instead, which is what the
    // daemon's own bundle has always done, so there is one mechanism and not
    // two opinions about it.
    expect(builder).toContain('buildBundle');
    expect(builder).toContain('linkedWorkspaceRoots');
    expect(builder).not.toContain("'--legacy'");
  });

  it('refuses an artifact that only runs where it was built', () => {
    // The guard the old shape lacked entirely. `existsSync(node_modules)` was
    // true for the whole time nothing worked.
    expect(builder).toContain('assertNothingEscapes');
  });

  it('refuses to call a dependency-less tree an artifact', () => {
    // The fallback still packs something — a caller may want the bytes — but
    // it throws, so nothing downstream can report the deployment as done.
    expect(builder).toContain('ArtifactWithoutDependencies');
    expect(builder).toMatch(/throw new ArtifactWithoutDependencies/);
  });

  it('names the reason in a way the reader can act on', () => {
    // "Build failed" sends someone to the compiler. The two spellings that
    // cannot travel are the actual obstacle, and the message names both —
    // `link:` was the one it left out while it was the one that mattered.
    expect(builderProse).toMatch(/workspace protocol/i);
    expect(builderProse).toMatch(/link:/);
    expect(builderProse).toMatch(/packed here or they do not travel/i);
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

  it('installs them on the node, where the platform is known', () => {
    // The install has to happen somewhere, and the node is the only machine
    // that knows it is Linux — which is what decides between
    // `@esbuild/darwin-arm64` and `@esbuild/linux-x64`.
    expect(deployer).toMatch(/npm install --omit=dev/);
  });

  it('fails the deployment when the installed tree does not resolve', () => {
    // `test -d node_modules` was the old check and it could not fail: a
    // directory of dangling symlinks is a directory. Asking node to resolve
    // the package the app imports first is a question with a real answer.
    expect(deployer).not.toMatch(/test -d.*node_modules.*present/);
    expect(deployer).toMatch(/createRequire/);
    expect(deployer).toMatch(/cannot resolve @omnitron-dev\/omnitron/);
  });

  it('asks for the package, not for a file inside it', () => {
    // A package with an `exports` map publishes what it lists. Resolving
    // `@omnitron-dev/omnitron/package.json` answers
    // `ERR_PACKAGE_PATH_NOT_EXPORTED` on a perfectly good install — a probe
    // that fails for the one reason that is not a fault.
    expect(deployer).not.toMatch(/resolve\('@omnitron-dev\/omnitron\/package\.json'\)/);
  });
});
