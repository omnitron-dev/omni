/**
 * Six artifacts failed to build and the deployment reported success.
 *
 * The daemon is started by launchd, whose PATH is
 *
 *     …/node/v24.13.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
 *
 * and pnpm's installer puts its binary in `~/Library/pnpm`, which is on none
 * of those. So `exec('pnpm', …)` failed with ENOENT for every app.
 *
 * That alone would have been a loud failure. Two more things made it silent:
 * `buildAll` caught each error into `console.error` — which in a daemon
 * reaches nobody — and returned the apps that worked, which was none; and the
 * caller logged `Artifacts built for deployment` with `artifacts: []`.
 *
 * Measured in the daemon's log: `artifacts= []` twice, followed by a
 * deployment that shipped nothing and a node with nothing to run.
 *
 * Works from a terminal, fails from the daemon: the difference is the
 * environment, and nothing about the code says so.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('a daemon does not inherit a shell PATH', () => {
  const realHome = process.env['HOME'];
  const realPnpmHome = process.env['PNPM_HOME'];

  beforeEach(() => vi.resetModules());
  afterEach(() => {
    if (realHome === undefined) delete process.env['HOME']; else process.env['HOME'] = realHome;
    if (realPnpmHome === undefined) delete process.env['PNPM_HOME']; else process.env['PNPM_HOME'] = realPnpmHome;
  });

  it('finds the pnpm this machine actually has', async () => {
    // Not a fixture: the installation on this machine is the thing the daemon
    // has to find, and a test that mocks the filesystem here would pass on a
    // machine where the daemon cannot build anything.
    const { resolvePnpmForTests } = await import('../../src/project/artifact-builder.js');
    const resolved = resolvePnpmForTests();

    const { execFileSync } = await import('node:child_process');
    const version = execFileSync(resolved, ['--version'], { encoding: 'utf8' }).trim();

    expect(version, `'${resolved}' did not answer --version`).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('prefers PNPM_HOME when the environment names one', async () => {
    process.env['PNPM_HOME'] = '/nonexistent-for-this-test';
    const { resolvePnpmForTests } = await import('../../src/project/artifact-builder.js');

    // The named directory has no pnpm in it, so the search moves on rather
    // than returning a path that does not exist — a resolver that trusts an
    // env var it did not check produces ENOENT on a path nobody typed.
    expect(resolvePnpmForTests()).not.toBe('/nonexistent-for-this-test/pnpm');
  });

  it('falls back to the bare name rather than inventing a path', async () => {
    // With nowhere to look, the failure should be an ENOENT naming `pnpm` —
    // which sends the reader to the installation — not one naming a directory
    // this resolver made up.
    process.env['HOME'] = '/nonexistent-for-this-test';
    process.env['PNPM_HOME'] = '/nonexistent-for-this-test';
    const { resolvePnpmForTests } = await import('../../src/project/artifact-builder.js');

    const resolved = resolvePnpmForTests();
    expect(resolved === 'pnpm' || resolved.endsWith('/pnpm')).toBe(true);
    expect(resolved).not.toContain('/nonexistent-for-this-test');
  });
});

describe('a build that failed is not a build that produced nothing', () => {
  it('returns the failures beside the successes', async () => {
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const { ArtifactBuilder } = await import('../../src/project/artifact-builder.js');

    // A real directory with no such app in it: the builder's constructor
    // creates its output directory, so an unwritable root fails before the
    // thing under test runs.
    const root = await fsp.mkdtemp(`${os.tmpdir()}/omnitron-build-test-`);
    const outcome = await new ArtifactBuilder(root).buildAll(
      [{ name: 'nope', bootstrap: './apps/nope/src/bootstrap.ts' }] as never,
    );
    await fsp.rm(root, { recursive: true, force: true });

    // The shape is the whole point: a caller cannot log "built" without
    // having looked at what did not.
    expect(outcome.built).toEqual([]);
    expect(outcome.failed).toHaveLength(1);
    expect(outcome.failed[0]!.app).toBe('nope');
    expect(outcome.failed[0]!.error).toBeTruthy();
  });

  it('does not report failures to console.error', async () => {
    // Where they used to go, and where a daemon's stderr reaches nobody.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const os = await import('node:os');
    const fsp = await import('node:fs/promises');
    const { ArtifactBuilder } = await import('../../src/project/artifact-builder.js');

    const root = await fsp.mkdtemp(`${os.tmpdir()}/omnitron-build-test-`);
    await new ArtifactBuilder(root).buildAll([{ name: 'nope', bootstrap: './apps/nope/src/bootstrap.ts' }] as never);
    await fsp.rm(root, { recursive: true, force: true });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
