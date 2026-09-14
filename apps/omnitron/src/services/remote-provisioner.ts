/**
 * Preparing a machine to run omnitron, whatever machine it is.
 *
 * Provisioning used to be one line for this: if `which node` came back empty,
 * pipe `https://deb.nodesource.com/setup_22.x` into `bash` as root and run
 * `apt-get install -y nodejs`, with `yum` and `apk` as `||` fallbacks. Three
 * things wrong with that, in rising order of importance.
 *
 * It only works on Linux, and only on three of its families. A macOS node
 * falls through every branch and fails on the last one.
 *
 * It adds a vendor package repository and its signing key to the host,
 * permanently, as a side effect of asking for a slave. The machines this
 * reaches are not blank — the host this path was first run against is
 * running a Monero node, a Tor daemon and two VPN containers, with an uptime
 * of 599 days.
 *
 * And the `||` chain reports the last failure, not the first. On a Debian
 * host where the apt install fails, the error an operator reads is from
 * `apk`, a package manager that host has never had.
 *
 * What replaces it: ask the host what it is, decide what is missing, and do
 * the smallest set of things that fixes it — reporting each one. The runtime
 * comes from nodejs.org as a tarball unpacked under the omnitron prefix,
 * which works identically on every Linux and macOS, needs no repository, and
 * is undone by deleting one directory. The package manager is used only for
 * the two tools that fetch and unpack it, and only when they are missing.
 *
 * Built on `@xec-sh/core`: its SSH adapter carries the credentials, and
 * `quoteForShell`/`dialectFor` do the quoting for the dialect the target
 * actually speaks rather than assuming a POSIX shell.
 */

import { quoteForShell, type ShellDialect } from '@xec-sh/core';

/** The default runtime a prepared node gets when it has none. */
export const DEFAULT_NODE_VERSION = '22.14.0';

/** Where omnitron puts things it installed itself. */
export const OMNITRON_PREFIX = '/opt/omnitron';

// =============================================================================
// What a host is
// =============================================================================

export type PackageManager = 'apt' | 'dnf' | 'yum' | 'apk' | 'pacman' | 'zypper' | 'brew';

/** Node's own naming for the platforms it publishes builds for. */
export type NodePlatform = 'linux' | 'darwin';
export type NodeArch = 'x64' | 'arm64' | 'armv7l' | 'ppc64le' | 's390x';

export interface PlatformFacts {
  /** `uname -s`, lowercased. `unknown` when the host did not answer. */
  readonly os: NodePlatform | 'unknown';
  /** Node's name for the machine architecture, or null when unrecognised. */
  readonly arch: NodeArch | null;
  /** `ID` from /etc/os-release — `ubuntu`, `alpine`, `fedora`… */
  readonly distro: string | null;
  /** The first package manager found on PATH, in the order this host prefers. */
  readonly packageManager: PackageManager | null;
  /** True when the SSH user is root. */
  readonly isRoot: boolean;
  /** True when `sudo` exists and can be used without a password. */
  readonly passwordlessSudo: boolean;
  /** Versions of what is already installed, absent when it is not. */
  readonly node: string | null;
  readonly bun: string | null;
  readonly npm: string | null;
  readonly omnitron: string | null;
  /** Tools the install path itself needs. */
  readonly hasCurl: boolean;
  readonly hasTar: boolean;
}

/**
 * One command that answers every question above.
 *
 * A single round trip on purpose: each of these is a sub-second question and
 * an SSH round trip to a host on another continent is not. The old code paid
 * one per probe.
 *
 * Every line is `key=value`, and a missing value means "not present" rather
 * than "the question failed" — the command cannot fail as a whole, so the
 * caller's own error handling stays the thing that reports unreachable hosts.
 */
export const PLATFORM_PROBE = [
  'echo "os=$(uname -s 2>/dev/null | tr "[:upper:]" "[:lower:]")"',
  'echo "machine=$(uname -m 2>/dev/null)"',
  'echo "distro=$(. /etc/os-release 2>/dev/null && echo "$ID")"',
  'echo "uid=$(id -u 2>/dev/null)"',
  'echo "sudo=$(command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null && echo yes)"',
  'for p in apt-get dnf yum apk pacman zypper brew; do command -v $p >/dev/null 2>&1 && echo "pm=$p" && break; done',
  'echo "node=$(node --version 2>/dev/null)"',
  'echo "bun=$(bun --version 2>/dev/null)"',
  'echo "npm=$(npm --version 2>/dev/null)"',
  'echo "omnitron=$(omnitron --version 2>/dev/null | head -1)"',
  'command -v curl >/dev/null 2>&1 && echo "curl=yes"',
  'command -v tar >/dev/null 2>&1 && echo "tar=yes"',
  'true',
].join('; ');

/** `uname -m` spellings → the architecture name Node publishes under. */
const ARCH_BY_MACHINE: Record<string, NodeArch> = {
  x86_64: 'x64', amd64: 'x64',
  aarch64: 'arm64', arm64: 'arm64',
  armv7l: 'armv7l',
  ppc64le: 'ppc64le',
  s390x: 's390x',
};

const PACKAGE_MANAGERS: Record<string, PackageManager> = {
  'apt-get': 'apt', dnf: 'dnf', yum: 'yum', apk: 'apk', pacman: 'pacman', zypper: 'zypper', brew: 'brew',
};

/** Parse the probe's output. Anything unanswered stays absent. */
export function parsePlatformProbe(stdout: string): PlatformFacts {
  const values = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const value = line.slice(at + 1).trim();
    if (value) values.set(line.slice(0, at).trim(), value);
  }

  const os = values.get('os');
  const machine = values.get('machine');
  const uid = values.get('uid');

  return {
    os: os === 'linux' || os === 'darwin' ? os : 'unknown',
    arch: (machine ? ARCH_BY_MACHINE[machine] : undefined) ?? null,
    distro: values.get('distro') ?? null,
    packageManager: PACKAGE_MANAGERS[values.get('pm') ?? ''] ?? null,
    isRoot: uid === '0',
    passwordlessSudo: values.get('sudo') === 'yes',
    node: values.get('node') ?? null,
    bun: values.get('bun') ?? null,
    npm: values.get('npm') ?? null,
    omnitron: values.get('omnitron') ?? null,
    hasCurl: values.get('curl') === 'yes',
    hasTar: values.get('tar') === 'yes',
  };
}

// =============================================================================
// What to do about it
// =============================================================================

export interface ProvisionStep {
  /** What this step achieves, in the operator's terms. */
  readonly what: string;
  /** The command, ready for the remote shell. */
  readonly command: string;
  /** How long it may take. Package installs and downloads are not instant. */
  readonly timeoutMs: number;
  /**
   * Changes the host's package configuration — an apt/dnf/brew install.
   * Reported separately because it is the part an operator may want to
   * know about on a machine that is already doing something else.
   */
  readonly touchesPackageManager?: boolean;
}

export interface ProvisionPlan {
  readonly steps: readonly ProvisionStep[];
  /** Empty when nothing is needed, which is the common case on a re-run. */
  readonly nothingToDo: boolean;
  /** Set when the host cannot be prepared at all, and why. */
  readonly refusal?: string;
}

export interface ProvisionRequirements {
  /** Node version to install when the host has no runtime. */
  readonly nodeVersion?: string;
  /** Install prefix for what omnitron puts on the machine. */
  readonly prefix?: string;
  /** Allow using the host's package manager for missing tools. Default true. */
  readonly usePackageManager?: boolean;
}

/** How each package manager installs a package non-interactively. */
const INSTALL_COMMAND: Record<PackageManager, (pkgs: string) => string> = {
  apt: (p) => `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${p}`,
  dnf: (p) => `dnf install -y -q ${p}`,
  yum: (p) => `yum install -y -q ${p}`,
  apk: (p) => `apk add --no-cache ${p}`,
  pacman: (p) => `pacman -Sy --noconfirm ${p}`,
  zypper: (p) => `zypper --non-interactive install ${p}`,
  // Homebrew refuses to run as root, and the SSH user owns its own prefix.
  brew: (p) => `brew install ${p}`,
};

/**
 * Decide what a host needs.
 *
 * Pure, so the decision can be read and tested without a machine: given the
 * same facts it produces the same plan, and the plan is a list of commands a
 * person can look at before anything runs.
 */
export function planProvisioning(
  facts: PlatformFacts,
  requirements: ProvisionRequirements = {},
): ProvisionPlan {
  const nodeVersion = requirements.nodeVersion ?? DEFAULT_NODE_VERSION;
  const prefix = requirements.prefix ?? OMNITRON_PREFIX;
  const usePackageManager = requirements.usePackageManager ?? true;
  const dialect: ShellDialect = 'posix';
  const q = (v: string) => quoteForShell(v, dialect);

  if (facts.os === 'unknown') {
    return {
      steps: [],
      nothingToDo: false,
      refusal:
        'Could not tell what operating system this host runs — `uname -s` answered nothing. ' +
        'Omnitron prepares Linux and macOS hosts.',
    };
  }
  if (!facts.arch) {
    return {
      steps: [],
      nothingToDo: false,
      refusal: 'This host reports a machine architecture omnitron has no runtime build for.',
    };
  }

  // Root, or sudo that does not stop to ask. A provisioning run cannot answer
  // a password prompt, and a step that hangs on one is worse than a refusal.
  const elevated = facts.isRoot || facts.passwordlessSudo;
  const sudo = facts.isRoot ? '' : 'sudo ';

  const steps: ProvisionStep[] = [];
  const hasRuntime = Boolean(facts.node ?? facts.bun);

  if (!hasRuntime) {
    const missingTools = [!facts.hasCurl ? 'curl' : null, !facts.hasTar ? 'tar' : null].filter(
      (t): t is string => t !== null,
    );

    if (missingTools.length > 0) {
      if (!usePackageManager) {
        return {
          steps: [],
          nothingToDo: false,
          refusal:
            `This host needs ${missingTools.join(' and ')} to fetch a runtime, and installing packages was not allowed.`,
        };
      }
      if (!facts.packageManager) {
        return {
          steps: [],
          nothingToDo: false,
          refusal:
            `This host has no ${missingTools.join(' or ')}, and no package manager omnitron recognises to install ` +
            `them with. Install ${missingTools.join(' and ')} and try again.`,
        };
      }
      if (!elevated && facts.packageManager !== 'brew') {
        return {
          steps: [],
          nothingToDo: false,
          refusal:
            `Installing ${missingTools.join(' and ')} needs root, and this session is neither root nor able to ` +
            `use sudo without a password.`,
        };
      }
      const install = INSTALL_COMMAND[facts.packageManager](missingTools.join(' '));
      steps.push({
        what: `install ${missingTools.join(' and ')} with ${facts.packageManager}`,
        command: facts.packageManager === 'brew' ? install : `${sudo}sh -c ${q(install)}`,
        timeoutMs: 300_000,
        touchesPackageManager: true,
      });
    }

    // The runtime itself: an official build, unpacked where omnitron keeps
    // what it installed. No repository, no package database, and removing
    // the prefix removes it.
    const dir = `node-v${nodeVersion}-${facts.os}-${facts.arch}`;
    const url = `https://nodejs.org/dist/v${nodeVersion}/${dir}.tar.gz`;
    const runtimeRoot = `${prefix}/runtime`;
    // Put the runtime on PATH without deleting anything.
    //
    // `ln -sf` replaces whatever is at the destination, and on a machine that
    // is already doing something else that is a file somebody else put there.
    // A host reaches this step only when `node --version` answered nothing,
    // which usually means the path is empty — but "usually" is not the same
    // as "always": a broken install leaves a real binary that does not run,
    // and `-f` would delete it.
    //
    // So each link is made only where there is nothing, or where what is
    // there is a symlink we can point elsewhere. A host that has a real file
    // in the way keeps it, and the runtime is still installed and usable by
    // its absolute path.
    const link = (name: string) =>
      `if [ ! -e /usr/local/bin/${name} ] || [ -L /usr/local/bin/${name} ]; then ` +
      `${sudo}ln -sfn ${q(`${runtimeRoot}/bin/${name}`)} /usr/local/bin/${name}; fi`;

    steps.push({
      what: `install Node.js v${nodeVersion} into ${runtimeRoot}`,
      command:
        `${sudo}mkdir -p ${q(runtimeRoot)} && ` +
        `curl -fsSL ${q(url)} | ${sudo}tar -xz -C ${q(runtimeRoot)} --strip-components=1 && ` +
        `${link('node')} && ${link('npm')} && ${link('npx')}`,
      timeoutMs: 600_000,
    });
  }

  if (!facts.omnitron) {
    // `npm install -g` puts the CLI in its own prefix's `bin`, and that is
    // not always on PATH. For the runtime installed above it is
    // `/opt/omnitron/runtime/bin`, which is on nobody's.
    //
    // Measured twice on the test host, and the second time is the instructive
    // one. First run: node, npm and npx linked and working, `omnitron
    // --version` answering 0.2.0 by absolute path, and `omnitron up` failing
    // with `command not found`. So a link was added — conditioned on "we
    // installed the runtime", on the reasoning that a host with its own Node
    // has its own global prefix already on PATH. Second run: the runtime WAS
    // ours, from the first run, so the host now looked like one that had
    // always had Node, the condition was false, and the same
    // `command not found` came back.
    //
    // The condition was the wrong question. What matters is not where the
    // runtime came from but whether the CLI can be run by name — so that is
    // what is asked, after the install, on the host. `npm prefix -g` answers
    // where it actually went, whoever's npm it is; the link is made only if
    // the name is still unreachable, and only over nothing or a symlink.
    const linkCli =
      ` && if ! command -v omnitron >/dev/null 2>&1; then ` +
      `OMNI_BIN="$(npm prefix -g)/bin/omnitron"; ` +
      `if [ -x "$OMNI_BIN" ] && { [ ! -e /usr/local/bin/omnitron ] || [ -L /usr/local/bin/omnitron ]; }; then ` +
      `${sudo}ln -sfn "$OMNI_BIN" /usr/local/bin/omnitron; fi; fi`;

    steps.push({
      what: 'install the omnitron CLI',
      command: `${sudo}npm install -g --no-fund --no-audit @omnitron-dev/omnitron${linkCli}`,
      timeoutMs: 600_000,
    });
  }

  return { steps, nothingToDo: steps.length === 0 };
}

/**
 * A one-line summary of what a plan will change, for a log or a console.
 *
 * Exists because "provisioning failed" and "provisioning did nothing" and
 * "provisioning replaced this machine's Node" all used to look the same from
 * outside.
 */
export function describePlan(plan: ProvisionPlan): string {
  if (plan.refusal) return plan.refusal;
  if (plan.nothingToDo) return 'nothing to install — the host already has what omnitron needs';
  return plan.steps.map((s) => s.what).join('; ');
}
