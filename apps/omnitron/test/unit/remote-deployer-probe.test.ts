/**
 * Provisioning a remote node when the host stops answering.
 *
 * `which node … || echo ""` already answers "absent" with an empty string —
 * that is what the `|| echo ""` is for. So a `.catch(() => '')` around it
 * turned "could not ask the host" into "the host has no runtime", and the
 * very next line acts on that by piping a vendor script into `bash` and
 * running a package-manager install. Against a host that almost certainly
 * has Node already, and that the daemon has just failed to reach.
 *
 * The asymmetry is what made it visible: `verifySSH` treats an SSH failure
 * as a failure, and so does the install step's own handler. The two probes
 * were the only places that did not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const execFile = vi.fn();

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('node:child_process');
  return {
    ...actual,
    // `promisify` reads this symbol; giving it a custom implementation keeps
    // the production code path (`promisify(execFile)`) intact.
    execFile: Object.assign((...args: unknown[]) => execFile(...args), {
      [Symbol.for('nodejs.util.promisify.custom')]: (...args: unknown[]) => execFile(...args),
    }),
  };
});

/** Every remote command this run was asked to execute. */
const commands: string[] = [];

function respond(impl: (command: string) => Promise<{ stdout: string }>) {
  execFile.mockImplementation((_bin: string, args: string[]) => {
    const command = args[args.length - 1] ?? '';
    commands.push(command);
    return impl(command);
  });
}

const node = { host: '10.0.0.7', port: 9700, ssh: { user: 'root' } } as never;

beforeEach(() => {
  commands.length = 0;
  execFile.mockReset();
});

const logger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
  child: () => logger,
} as never;

async function deployer() {
  vi.resetModules();
  const { RemoteDeployer } = await import('../../src/services/remote-deployer.service.js');
  return new RemoteDeployer(logger);
}

describe('provisionSlaveNode when a probe cannot reach the host', () => {
  it('does not install a runtime because the host stopped answering', async () => {
    const d = await deployer();

    respond(async (command) => {
      if (command === 'echo ok') return { stdout: 'ok' };
      if (command.includes('which node')) throw new Error('ssh: connect to host 10.0.0.7 port 22: Connection timed out');
      return { stdout: '' };
    });

    const ok = await d.provisionSlaveNode(node, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    // The line that used to run: `curl … | bash - && apt-get install -y nodejs`.
    expect(commands.some((c) => c.includes('nodesource') || c.includes('apt-get install'))).toBe(false);
  });

  it('does not reinstall omnitron because the second probe failed', async () => {
    const d = await deployer();

    respond(async (command) => {
      if (command === 'echo ok') return { stdout: 'ok' };
      if (command.includes('which node')) return { stdout: '/usr/bin/node' };
      if (command.includes('which omnitron')) throw new Error('ssh: broken pipe');
      return { stdout: '' };
    });

    const ok = await d.provisionSlaveNode(node, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    expect(commands.some((c) => c.includes('npm install -g @omnitron-dev/omnitron'))).toBe(false);
  });

  it('still installs when the host answers and the runtime really is absent', async () => {
    // The empty string has to keep meaning "absent" — the fix must not turn
    // a real answer into a failure.
    const d = await deployer();

    respond(async (command) => {
      if (command.includes('which node')) return { stdout: '' };
      return { stdout: 'ok' };
    });

    await d.provisionSlaveNode(node, 'master.local', 9700, 'proj');

    expect(commands.some((c) => c.includes('nodesource'))).toBe(true);
  });
});
