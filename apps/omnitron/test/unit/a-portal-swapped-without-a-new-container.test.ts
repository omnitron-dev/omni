/**
 * Pointing the gateway at a new build without giving it a new container.
 *
 * The deployment used to change the static volume's SOURCE, which is the only
 * field of the gateway's spec that moves between releases, so the container
 * was recreated — **1 s of 000** inside release 4's 81 s deployment, measured
 * by the outage watcher at 2026-09-30 20:43:04. The maintenance lock cannot
 * cover that second: the container that would serve the lock's page is the one
 * being replaced.
 *
 * The mount is the static ROOT now, and what moves is
 * `current-<project>-<stack>` inside it. These cases run the real shell the
 * deployment sends, on a real directory, because a symlink swap is one of
 * those things whose failure modes are all in the syscall and none in the
 * prose.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { RemoteDeployer } from '../../src/services/remote-deployer.service.js';
import { carryForwardScript, gatewayStaticLinkName, GATEWAY_MOUNTS_COMMAND, readGatewayMounts } from '../../src/services/static-carry-forward.js';

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function root(): string {
  const r = mkdtempSync(join(tmpdir(), 'gw-link-'));
  roots.push(r);
  return r;
}

const hex = (n: number) => n.toString(16).padStart(16, '0');

function build(r: string, n: number, assets: string[] = ['app.js']): string {
  const dir = join(r, hex(n));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const a of assets) writeFileSync(join(dir, 'assets', a), a);
  writeFileSync(join(dir, 'index.html'), '<!doctype html>');
  return dir;
}

const run = (script: string) => execFileSync('bash', ['-c', script], { encoding: 'utf8' }).trim();

/**
 * The same, with GNU coreutils in front — the node is Ubuntu and its `mv` IS
 * GNU, so this runs what the node runs.
 *
 * `mv -T` is a coreutils option and BSD `mv` has no equivalent: over a symlink
 * that points AT A DIRECTORY, BSD follows it and moves the source INSIDE,
 * which is the exact accident `-T` exists to prevent. That difference is
 * silent, and it is the second of its kind in this change — `sed -i` takes an
 * argument on a mac and none in the gateway's alpine. Production is Linux;
 * the court says so rather than testing a shape it cannot run.
 */
const GNU = ['/opt/homebrew/opt/coreutils/libexec/gnubin', '/usr/local/opt/coreutils/libexec/gnubin'].find((d) =>
  existsSync(join(d, 'mv')),
);
const runGnu = (script: string) =>
  execFileSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: GNU ? { ...process.env, PATH: `${GNU}:${process.env['PATH'] ?? ''}` } : process.env,
  }).trim();
const onGnu = GNU || /GNU coreutils/.test(String(execFileSync('bash', ['-c', 'mv --version 2>&1 | head -1'], { encoding: 'utf8' })));

/** The command the deployment actually sends, captured from the real method. */
function swapCommand(r: string, link: string, digest: string): string {
  let sent = '';
  const deployer = Object.create(RemoteDeployer.prototype) as Record<string, unknown>;
  Object.assign(deployer, {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    sshExec: async (_t: unknown, cmd: string) => {
      sent = cmd;
      return '';
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (deployer as any).pointStaticLinkAt({ host: 'node' }, r, link, digest);
  return sent;
}

describe.skipIf(!onGnu)('the swap the deployment sends', () => {
  const LINK = gatewayStaticLinkName('daos', 'test');

  it('points the link at the build, relatively', () => {
    const r = root();
    build(r, 1);

    runGnu(swapCommand(r, LINK, hex(1)));

    const link = join(r, LINK);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    // RELATIVE: the link is resolved inside the container as well as on the
    // host, and the host path is not the container path.
    expect(readlinkSync(link)).toBe(hex(1));
    expect(existsSync(join(link, 'index.html'))).toBe(true);
  });

  it('replaces a link that is already there, and leaves no temporary behind', () => {
    const r = root();
    build(r, 1);
    build(r, 2);

    runGnu(swapCommand(r, LINK, hex(1)));
    runGnu(swapCommand(r, LINK, hex(2)));

    expect(readlinkSync(join(r, LINK))).toBe(hex(2));
    expect(readdirSync(r).filter((n) => n.includes('.tmp')), 'a temporary name was left in the web root').toEqual([]);
  });

  it('uses rename, never an unlink-then-symlink', () => {
    const cmd = swapCommand(root(), LINK, hex(1));

    // `ln -sfn` removes the old name before it makes the new one, and a
    // request arriving in that window is served from a web root that does not
    // exist. `mv -T` on a symlink is `rename(2)`: there is no window.
    expect(cmd).toContain('mv -T');
    expect(cmd, 'the unlink-then-symlink form is back').not.toMatch(/ln\s+-s[a-z]*f/);
  });

  it('gives the temporary a name two deployments cannot collide on', () => {
    const r = root();
    const a = swapCommand(r, LINK, hex(1));
    const b = swapCommand(r, LINK, hex(2));

    const tmpOf = (cmd: string) => /(\S*\.tmp)/.exec(cmd)?.[1];
    expect(tmpOf(a)).toBeDefined();
    expect(tmpOf(a)).not.toBe(tmpOf(b));
  });
});

describe('what the node is asked about its gateways', () => {
  /**
   * A `docker` that answers from fixtures, so the real command runs.
   *
   * The first version of this case asserted that the command CONTAINED
   * `readlink -f` — and a plant that deleted the answer and echoed the mount
   * source again left it green, because the string was still further up. An
   * assertion about the text of a script is not an assertion about what the
   * script says.
   */
  function fakeDocker(containers: Array<{ id: string; running: boolean; src: string; project: string; stack: string }>) {
    const dir = root();
    const bin = join(dir, 'docker');
    const cases = containers
      .map(
        (c) => `      ${c.id}) case "$FMT" in
        *Mounts*) echo ${JSON.stringify(c.src)} ;;
        *State.Running*) echo ${c.running ? 'true' : 'false'} ;;
        *omnitron.project*) echo ${JSON.stringify(c.project)} ;;
        *omnitron.stack*) echo ${JSON.stringify(c.stack)} ;;
      esac ;;`,
      )
      .join('\n');
    writeFileSync(
      bin,
      `#!/bin/bash
if [ "$1" = "ps" ]; then ${containers.map((c) => `echo ${c.id}`).join('; ')}; exit 0; fi
if [ "$1" = "inspect" ]; then
  FMT="$3"; ID="$4"
  case "$ID" in
${cases}
  esac
  exit 0
fi
`,
      { mode: 0o755 },
    );
    return dir;
  }

  const ask = (dir: string, cwd: string) =>
    execFileSync('bash', ['-c', GATEWAY_MOUNTS_COMMAND], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, PATH: `${dir}:${process.env['PATH'] ?? ''}` },
    });

  it('answers with each gateway’s own link target, not the mount they share', () => {
    const r = root();
    build(r, 1);
    build(r, 2);
    runGnu(swapCommand(r, gatewayStaticLinkName('daos', 'test'), hex(1)));
    runGnu(swapCommand(r, gatewayStaticLinkName('daos', 'prod'), hex(2)));

    const docker = fakeDocker([
      { id: 'c1', running: true, src: r, project: 'daos', stack: 'test' },
      { id: 'c2', running: false, src: r, project: 'daos', stack: 'prod' },
    ]);
    const { serving, mounted } = readGatewayMounts(ask(docker, r));

    // The mount `r` is the same for both; only the links tell them apart.
    expect(serving).toEqual([join(r, hex(1))]);
    expect(mounted.sort()).toEqual([join(r, hex(1)), join(r, hex(2))].sort());
    expect(mounted, 'it answered with the shared root').not.toContain(r);
  });

  it('falls back to the mount for a gateway that has no link yet', () => {
    const r = root();
    const only = build(r, 1);
    const docker = fakeDocker([{ id: 'c1', running: true, src: only, project: 'daos', stack: 'test' }]);

    const { serving } = readGatewayMounts(ask(docker, r));

    // The first deployment, and every gateway still mounting a build
    // directory: the source IS the build, and the answer is unchanged.
    expect(serving).toEqual([only]);
  });

  it('spells the link with the one function that spells it anywhere', () => {
    expect(GATEWAY_MOUNTS_COMMAND).toContain(gatewayStaticLinkName('$proj', '$stk'));
  });

  it('falls back to the source for a gateway that has no link yet', () => {
    // The first deployment, and every gateway still mounting a build
    // directory. `readGatewayMounts` reads absolute paths either way.
    const { serving, mounted } = readGatewayMounts('true /opt/omnitron/stack-static/gateway/0000000000000001');
    expect(serving).toEqual(['/opt/omnitron/stack-static/gateway/0000000000000001']);
    expect(mounted).toEqual(serving);
  });
});

describe('the carry-forward and the prune, once the answer is a link target', () => {
  it('carries the assets of the build the link points at', () => {
    const r = root();
    const served = build(r, 1, ['old-chunk.js']);
    const fresh = build(r, 2, ['new-chunk.js']);

    run(carryForwardScript({ root: r, fresh, serving: [served], mounted: [served], keep: 5 }));

    // A tab opened before the deployment asks for `old-chunk.js` and gets it.
    expect(existsSync(join(fresh, 'assets', 'old-chunk.js'))).toBe(true);
  });

  it('carries NOTHING when it is handed the root instead — the failure this had to avoid', () => {
    const r = root();
    build(r, 1, ['old-chunk.js']);
    const fresh = build(r, 2, ['new-chunk.js']);

    // What a command reading the mount SOURCE would now produce.
    const said = run(carryForwardScript({ root: r, fresh, serving: [r], mounted: [r], keep: 5 }));

    expect(said).toContain('carried 0 from 0 build(s)');
    expect(existsSync(join(fresh, 'assets', 'old-chunk.js')), 'it found something under a root').toBe(false);
  });

  it('keeps the build the link points at even when it is not among the newest', () => {
    const r = root();
    // Six older builds and a fresh one: the link points at the OLDEST, which
    // is what a rollback looks like — `ls -1dt` sorts by mtime, so the wanted
    // build is exactly the one «newest 5» would drop.
    const rolledBackTo = build(r, 1);
    for (let n = 2; n <= 7; n++) build(r, n);
    const fresh = build(r, 8);

    run(carryForwardScript({ root: r, fresh, serving: [rolledBackTo], mounted: [rolledBackTo], keep: 5 }));

    expect(existsSync(rolledBackTo), 'the rollback target was pruned out from under the link').toBe(true);
  });

  it('holds both stacks’ targets when two share a node', () => {
    const r = root();
    const testBuild = build(r, 1);
    const prodBuild = build(r, 2);
    for (let n = 3; n <= 9; n++) build(r, n);
    const fresh = build(r, 10);

    run(carryForwardScript({ root: r, fresh, serving: [testBuild], mounted: [testBuild, prodBuild], keep: 5 }));

    expect(existsSync(testBuild)).toBe(true);
    expect(existsSync(prodBuild), 'the other stack’s build was removed by this stack’s deployment').toBe(true);
  });

  it('leaves the other stack’s link alone', () => {
    const r = root();
    build(r, 1);
    build(r, 2);
    const testLink = gatewayStaticLinkName('daos', 'test');
    const prodLink = gatewayStaticLinkName('daos', 'prod');

    runGnu(swapCommand(r, testLink, hex(1)));
    runGnu(swapCommand(r, prodLink, hex(2)));
    // The deployment of `test` moves only its own name.
    runGnu(swapCommand(r, testLink, hex(2)));

    expect(readlinkSync(join(r, prodLink))).toBe(hex(2));
    expect(readlinkSync(join(r, testLink))).toBe(hex(2));
  });

  it('never prunes a link — only build directories', () => {
    const r = root();
    for (let n = 1; n <= 8; n++) build(r, n);
    const fresh = build(r, 9);
    runGnu(swapCommand(r, gatewayStaticLinkName('daos', 'test'), hex(9)));

    run(carryForwardScript({ root: r, fresh, serving: [], mounted: [], keep: 1 }));

    expect(existsSync(join(r, gatewayStaticLinkName('daos', 'test'))), 'the link itself was removed').toBe(true);
  });
});
