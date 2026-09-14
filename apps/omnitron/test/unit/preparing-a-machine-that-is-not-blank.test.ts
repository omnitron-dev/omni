/**
 * Preparing a machine to run omnitron, whatever machine it is.
 *
 * This was one line: if `which node` came back empty, pipe
 * `https://deb.nodesource.com/setup_22.x` into `bash` as root and
 * `apt-get install -y nodejs`, with `yum` and `apk` as `||` fallbacks.
 *
 * It only works on Linux, and only on three of its families — a macOS node
 * falls through every branch and fails on the last one. It adds a vendor
 * package repository and its signing key to the host permanently, as a side
 * effect of asking for a slave. And the `||` chain reports the LAST failure,
 * so on a Debian host where the apt install fails, the error an operator
 * reads comes from `apk` — a package manager that host has never had.
 *
 * The plan is a value now, so what a host will have done to it can be read
 * before anything runs, and tested without a host.
 */

import { describe, it, expect } from 'vitest';

import {
  parsePlatformProbe,
  planProvisioning,
  describePlan,
  PLATFORM_PROBE,
  DEFAULT_NODE_VERSION,
  type PlatformFacts,
} from '../../src/services/remote-provisioner.js';

/** A blank Linux host: root, apt, curl and tar, nothing installed. */
const blankUbuntu: PlatformFacts = {
  os: 'linux', arch: 'x64', distro: 'ubuntu', packageManager: 'apt',
  isRoot: true, passwordlessSudo: false,
  node: null, bun: null, npm: null, omnitron: null,
  hasCurl: true, hasTar: true,
};

const facts = (over: Partial<PlatformFacts>): PlatformFacts => ({ ...blankUbuntu, ...over });
const commands = (f: PlatformFacts) => planProvisioning(f).steps.map((s) => s.command).join('\n');

describe('reading what a host is', () => {
  it('parses the probe', () => {
    const parsed = parsePlatformProbe(
      [
        'os=linux', 'machine=aarch64', 'distro=debian', 'uid=0', 'pm=apt-get',
        'node=v22.14.0', 'npm=10.9.2', 'curl=yes', 'tar=yes',
      ].join('\n'),
    );

    expect(parsed).toMatchObject({
      os: 'linux', arch: 'arm64', distro: 'debian', packageManager: 'apt',
      isRoot: true, node: 'v22.14.0', npm: '10.9.2', hasCurl: true, hasTar: true,
    });
    // Absent means absent, not empty string: the plan branches on truthiness.
    expect(parsed.bun).toBeNull();
    expect(parsed.omnitron).toBeNull();
  });

  it('reads a machine that answered nothing as unknown, not as Linux', () => {
    // A probe whose host never replied must not produce a plan that installs
    // Linux packages onto it.
    const parsed = parsePlatformProbe('');

    expect(parsed.os).toBe('unknown');
    expect(planProvisioning(parsed).refusal).toMatch(/operating system/);
  });

  it('maps the architectures Node publishes builds for', () => {
    for (const [machine, arch] of [['x86_64', 'x64'], ['amd64', 'x64'], ['aarch64', 'arm64'], ['arm64', 'arm64']]) {
      expect(parsePlatformProbe(`os=linux\nmachine=${machine}`).arch, machine).toBe(arch);
    }
    // A machine we have no build for is null, and the plan refuses rather
    // than downloading a tarball that does not exist.
    const exotic = parsePlatformProbe('os=linux\nmachine=riscv64');
    expect(exotic.arch).toBeNull();
    expect(planProvisioning(exotic).refusal).toMatch(/architecture/);
  });

  it('asks everything in one round trip', () => {
    // Each question is sub-second; an SSH round trip to another continent is
    // not. The old code paid one per probe.
    expect(PLATFORM_PROBE.split(';').length).toBeGreaterThan(8);
    expect(PLATFORM_PROBE.split('\n')).toHaveLength(1);
  });
});

describe('deciding what to do about it', () => {
  it('does nothing to a host that already has what it needs', () => {
    const plan = planProvisioning(facts({ node: 'v22.14.0', npm: '10.9.2', omnitron: '0.2.0' }));

    expect(plan.nothingToDo).toBe(true);
    expect(plan.steps).toEqual([]);
    expect(describePlan(plan)).toMatch(/already has/);
  });

  it('installs a runtime from nodejs.org rather than adding a vendor repository', () => {
    const cmds = commands(blankUbuntu);

    expect(cmds).toContain(`https://nodejs.org/dist/v${DEFAULT_NODE_VERSION}/node-v${DEFAULT_NODE_VERSION}-linux-x64.tar.gz`);
    // The thing this replaced.
    expect(cmds).not.toContain('nodesource');
    expect(cmds).not.toContain('apt-get install -y nodejs');
  });

  it('puts the runtime under the omnitron prefix, where removing it undoes this', () => {
    const cmds = commands(blankUbuntu);

    expect(cmds).toContain('/opt/omnitron/runtime');
  });

  it('does not delete a file somebody else put on the path', () => {
    // `ln -sf` replaces whatever is at the destination. A host reaches this
    // step only when `node --version` answered nothing, which usually means
    // the path is empty — but a broken install leaves a real binary that does
    // not run, and `-f` would delete it. Deleting things on a machine that is
    // already doing something else is not what "prepare this node" means.
    const cmds = commands(blankUbuntu);

    for (const name of ['node', 'npm', 'npx']) {
      expect(cmds, name).toContain(`[ ! -e /usr/local/bin/${name} ] || [ -L /usr/local/bin/${name} ]`);
    }
    // No unguarded replacement anywhere: every `ln` into /usr/local/bin sits
    // behind the guard above.
    for (const line of cmds.split('&&')) {
      if (!line.includes('/usr/local/bin')) continue;
      expect(line, line.trim()).toContain('[ ! -e /usr/local/bin/');
    }
  });

  it('prepares macOS with the same two steps', () => {
    // The whole point of cross-platform: a darwin host is not a special case
    // that falls off the end of a `||` chain.
    const plan = planProvisioning(facts({ os: 'darwin', arch: 'arm64', packageManager: 'brew', isRoot: false, passwordlessSudo: true }));

    expect(plan.refusal).toBeUndefined();
    expect(plan.steps.map((s) => s.command).join('\n')).toContain('node-v22.14.0-darwin-arm64.tar.gz');
  });

  it('makes the CLI runnable by name, whoever installed the runtime', () => {
    // The condition that was wrong twice. A re-run against a host we
    // prepared earlier sees a runtime that is ours and looks like the host's
    // own — so the decision cannot be made from the plan. It is made on the
    // host, after the install, by asking whether `omnitron` resolves.
    for (const f of [blankUbuntu, facts({ node: 'v22.14.0', npm: '10.9.2' })]) {
      const cli = planProvisioning(f).steps.find((s) => s.what.includes('CLI'));
      expect(cli, JSON.stringify({ node: f.node })).toBeTruthy();
      expect(cli!.command).toContain('command -v omnitron');
      expect(cli!.command).toContain('npm prefix -g');
      // And still never over a file somebody else put there.
      expect(cli!.command).toContain('[ ! -e /usr/local/bin/omnitron ] || [ -L /usr/local/bin/omnitron ]');
    }
  });

  it('leaves a host that already has bun alone about runtimes', () => {
    const plan = planProvisioning(facts({ bun: '1.1.38' }));

    expect(plan.steps.map((s) => s.what)).toEqual(['install the omnitron CLI']);
  });

  it('installs curl and tar only when they are missing, and says it is doing it', () => {
    const plan = planProvisioning(facts({ hasCurl: false, hasTar: true }));

    const first = plan.steps[0]!;
    expect(first.what).toContain('curl');
    expect(first.what).not.toContain('tar');
    // The one kind of step that changes how the machine gets its software,
    // marked so a caller can report it differently.
    expect(first.touchesPackageManager).toBe(true);
    expect(plan.steps.slice(1).some((s) => s.touchesPackageManager)).toBe(false);
  });

  it('uses the package manager the host actually has', () => {
    for (const [pm, expected] of [
      ['apt', 'apt-get install'], ['dnf', 'dnf install'], ['apk', 'apk add'],
      ['pacman', 'pacman -Sy'], ['zypper', 'zypper --non-interactive'], ['brew', 'brew install'],
    ] as const) {
      const plan = planProvisioning(facts({ packageManager: pm, hasCurl: false }));
      expect(plan.steps[0]!.command, pm).toContain(expected);
    }
  });

  it('refuses when a tool is missing and no package manager can supply it', () => {
    // Better than the old behaviour, which was to run `apk add` on a host
    // with no apk and report apk's error.
    const plan = planProvisioning(facts({ hasCurl: false, packageManager: null }));

    expect(plan.refusal).toMatch(/no package manager/);
    expect(plan.steps).toEqual([]);
  });

  it('refuses to install packages as a user who cannot become root', () => {
    // A step that stops at a password prompt hangs the provisioning run; a
    // refusal names the problem in one line.
    const plan = planProvisioning(facts({ isRoot: false, passwordlessSudo: false, hasCurl: false }));

    expect(plan.refusal).toMatch(/root|sudo/);
  });

  it('uses sudo when it has it and is not root', () => {
    const cmds = commands(facts({ isRoot: false, passwordlessSudo: true }));

    expect(cmds).toContain('sudo ');
  });

  it('does not sprinkle sudo when it is already root', () => {
    expect(commands(blankUbuntu)).not.toContain('sudo ');
  });

  it('quotes what it interpolates', () => {
    // Paths and URLs are built from a version string and a prefix. They are
    // ours today; the quoting is what keeps that from mattering.
    const plan = planProvisioning(blankUbuntu, { prefix: "/opt/omni'tron" });

    expect(plan.steps.some((s) => s.command.includes("'\\''"))).toBe(true);
  });

  it('gives every step a deadline long enough for what it does', () => {
    for (const step of planProvisioning(facts({ hasCurl: false })).steps) {
      // A package index refresh on a slow mirror is minutes, not seconds.
      expect(step.timeoutMs, step.what).toBeGreaterThanOrEqual(300_000);
    }
  });
});
