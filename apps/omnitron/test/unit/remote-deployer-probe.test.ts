/**
 * Provisioning a remote node when the host stops answering.
 *
 * The original defect: `which node … || echo ""` already answers "absent"
 * with an empty string, so a `.catch(() => '')` around it turned "could not
 * ask the host" into "the host has no runtime" — and the next line acted on
 * that by piping a vendor script into `bash` and running a package-manager
 * install, against a host the daemon had just failed to reach.
 *
 * Rewritten twice in one day, and the second rewrite is the interesting one.
 *
 * First, when the deployer stopped shelling out to `ssh(1)`: this file mocked
 * `node:child_process`, and after the transport changed two of its three
 * cases still passed — not because the probes were right but because every
 * command failed for an unrelated reason.
 *
 * Then, when host preparation became automatic and cross-platform. The
 * defect this file was written for is now structurally impossible: there is
 * one probe rather than several, it ends in `true` so it cannot report
 * failure as an empty answer, and nothing catches around it — an unreachable
 * host raises, which is what it is. What survives from the original is the
 * property, and these test that: **a host that did not answer must not be
 * treated as a host that answered "nothing installed".**
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RemoteDeployer, type DeployTarget } from '../../src/services/remote-deployer.service.js';

/** Every remote command this run was asked to execute. */
const commands: string[] = [];

type Reply = { stdout?: string; stderr?: string; exitCode?: number };

/** An execution service whose SSH answers are scripted per command. */
function execution(impl: (command: string) => Reply) {
  return {
    ssh: vi.fn(async (_target: unknown, command: string) => {
      commands.push(command);
      const reply = impl(command);
      return {
        stdout: reply.stdout ?? '',
        stderr: reply.stderr ?? '',
        exitCode: reply.exitCode ?? 0,
        duration: 1,
      };
    }),
    uploadFile: vi.fn(async () => undefined),
  } as never;
}

const target: DeployTarget = { host: '10.0.0.7', daemonPort: 9700, username: 'root' };

const logger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  child: () => logger,
} as never;

/** How an unreachable host answers: the command never ran. */
const unreachable: Reply = { exitCode: 255, stderr: 'ssh: connect to host 10.0.0.7 port 22: Connection timed out' };

/** A blank Ubuntu box, as the platform probe reports one. */
const BLANK_UBUNTU = [
  'os=linux', 'machine=x86_64', 'distro=ubuntu', 'uid=0', 'pm=apt-get', 'curl=yes', 'tar=yes',
].join('\n');

/** The same box with a runtime and omnitron already on it. */
const READY_UBUNTU = [BLANK_UBUNTU, 'node=v22.14.0', 'npm=10.9.2', 'omnitron=0.2.0'].join('\n');

const isProbe = (c: string) => c.includes('uname -s');

/**
 * Run a case whose daemon never answers.
 *
 * Such a daemon is waited for the whole start window — two minutes of real
 * time per case, which made this file four of a suite's idle minutes: a
 * worker at 0% CPU and no output, indistinguishable from a hang. The clock is
 * faked instead. The loop still polls, the fake clock passes the deadline,
 * and the verdict is the one the real window gives.
 */
async function pastTheStartWindow<T>(run: () => Promise<T>): Promise<T> {
  vi.useFakeTimers();
  try {
    const result = run();
    await vi.runAllTimersAsync();
    return await result;
  } finally {
    vi.useRealTimers();
  }
}

/**
 * What a healthy daemon answers `omnitron ping` with.
 *
 * Returning a bare `'ok'` here used to pass, because the verification trusted
 * the exit code. It reads the ANSWER now — a node runs whatever version it
 * has, and an older one exits 0 while printing that the daemon is not
 * running. A fixture that says `ok` is a daemon saying nothing.
 */
const PING_OK = 'Daemon is running (PID: 4242, uptime: 2s, v0.2.0)';

/**
 * Commands other than the probe itself.
 *
 * The probe asks which package managers exist, so its own text contains
 * `apt-get` — an assertion that "no apt-get command ran" matches the
 * question as well as the answer. Asking about a package manager is not
 * using one.
 */
const actions = () => commands.filter((c) => !isProbe(c));

beforeEach(() => {
  commands.length = 0;
});

describe('provisionSlaveNode when the host cannot be reached', () => {
  it('installs nothing, because it never learned anything', async () => {
    const d = new RemoteDeployer(logger, execution(() => unreachable));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    // Not one package-manager command, and not one download.
    expect(commands.some((c) => c.includes('apt-get') || c.includes('nodejs.org'))).toBe(false);
  });

  it('stops at the door rather than after it', async () => {
    // `verifySSH` runs first: the probe below it is only meaningful once the
    // connection is known to work.
    const d = new RemoteDeployer(logger, execution(() => unreachable));

    await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(commands).toEqual(['echo ok']);
  });

  it('does not read a failed probe as an empty host', async () => {
    // The original defect, in the shape it could still take: connection up,
    // probe itself refused.
    const d = new RemoteDeployer(logger, execution((c) => (isProbe(c) ? unreachable : { stdout: 'ok' })));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    expect(commands.some((c) => c.includes('nodejs.org') || c.includes('npm install -g'))).toBe(false);
  });
});

describe('provisionSlaveNode on a host that answered', () => {
  it('prepares a blank machine without being asked twice', async () => {
    // Preparing a node is meant to be automatic. What that now means is a
    // runtime tarball under omnitron's own prefix — not a vendor repository
    // added to the machine.
    const d = new RemoteDeployer(logger, execution((c) => ({
      stdout: isProbe(c) ? BLANK_UBUNTU : c === 'omnitron ping' ? PING_OK : 'ok',
    })));

    await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    const all = commands.join('\n');
    expect(all).toContain('nodejs.org/dist/v');
    expect(all).toContain('npm install -g');
    expect(all).not.toContain('nodesource');
  });

  it('touches nothing on a machine that already has everything', async () => {
    const d = new RemoteDeployer(logger, execution((c) => ({
      stdout: isProbe(c) ? READY_UBUNTU : c === 'omnitron ping' ? PING_OK : 'ok',
    })));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(true);
    expect(commands.some((c) => c.includes('nodejs.org') || c.includes('npm install -g'))).toBe(false);
    // It still configures and starts the slave — preparation being a no-op
    // is not the same as provisioning being one.
    expect(commands.some((c) => c.includes('omnitron up --slave'))).toBe(true);
  });

  it('names the step that failed, not the last one it tried', async () => {
    // The `||` chain this replaced reported `apk`'s error on a Debian host.
    const d = new RemoteDeployer(logger, execution((c) => {
      if (isProbe(c)) return { stdout: BLANK_UBUNTU };
      if (c.includes('nodejs.org')) return { exitCode: 1, stderr: 'curl: (22) 404' };
      return { stdout: 'ok' };
    }));
    const progress: string[] = [];
    d.onProgress((p) => progress.push(`${p.status}:${p.message}`));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    const failure = progress.find((p) => p.startsWith('failed:'));
    expect(failure).toContain('Node.js');
    expect(failure).toContain('404');
    // And it stopped: no point installing a CLI onto a host with no runtime.
    expect(commands.some((c) => c.includes('npm install -g'))).toBe(false);
  });

  it('does not call a daemon healthy because something was printed', async () => {
    // What made this file's own fixtures wrong for a while. `omnitron ping`
    // on an older node exits 0 and prints "Daemon is not running" — so a
    // verification that trusts the exit code, or merely that output arrived,
    // reports a node upgraded and serving while it is neither. A node runs
    // whatever version it has, and this code upgrades nodes from older ones.
    const d = new RemoteDeployer(logger, execution((c) => ({
      stdout: isProbe(c) ? READY_UBUNTU : c === 'omnitron ping' ? 'Daemon is not running' : 'ok',
    })));

    const ok = await pastTheStartWindow(() => d.provisionSlaveNode(target, 'master.local', 9700, 'proj'));

    expect(ok).toBe(false);
  });

  it('refuses a host it cannot identify instead of guessing Linux', async () => {
    const d = new RemoteDeployer(logger, execution((c) => ({ stdout: isProbe(c) ? '' : 'ok' })));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    expect(actions().some((c) => c.includes('apt-get') || c.includes('nodejs.org'))).toBe(false);
  });
});

// =============================================================================
// "Provisioned" has to mean the daemon is there
// =============================================================================

describe('the run reports what actually happened', () => {
  it('fails when the daemon never answers', async () => {
    // Measured on the first real run against a host: the start command failed
    // with `omnitron: command not found`, the single ping found nothing, the
    // code logged "may still be starting" — and returned true. A caller that
    // trusts that ships artifacts to a node with no daemon.
    const d = new RemoteDeployer(logger, execution((c) => {
      if (isProbe(c)) return { stdout: READY_UBUNTU };
      if (c === 'omnitron ping') return { exitCode: 127, stderr: 'bash: omnitron: command not found' };
      return { stdout: 'ok' };
    }));
    const progress: string[] = [];
    d.onProgress((p) => progress.push(`${p.status}:${p.message}`));

    const ok = await pastTheStartWindow(() => d.provisionSlaveNode(target, 'master.local', 9700, 'proj'));

    expect(ok).toBe(false);
    const failure = progress.find((p) => p.startsWith('failed:'));
    expect(failure).toContain('command not found');
  });

  it('succeeds on a daemon that answers, and says what it answered', async () => {
    const d = new RemoteDeployer(logger, execution((c) => {
      if (isProbe(c)) return { stdout: READY_UBUNTU };
      if (c === 'omnitron ping') return { stdout: PING_OK };
      return { stdout: 'ok' };
    }));
    const progress: string[] = [];
    d.onProgress((p) => progress.push(`${p.status}:${p.message}`));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(true);
    // The evidence, not just the verdict.
    expect(progress.find((p) => p.startsWith('success:'))).toContain('PID: 4242');
  });

  it('waits for a daemon that is still booting rather than failing at three seconds', async () => {
    // A daemon start is an application boot — a DI container, a module graph,
    // a SQLite open. The old code slept three seconds and asked once.
    let attempts = 0;
    const d = new RemoteDeployer(logger, execution((c) => {
      if (isProbe(c)) return { stdout: READY_UBUNTU };
      if (c === 'omnitron ping') {
        attempts += 1;
        return attempts < 3 ? { exitCode: 1, stderr: 'connection refused' } : { stdout: PING_OK };
      }
      return { stdout: 'ok' };
    }));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(true);
    expect(attempts).toBe(3);
  }, 60_000);
});
