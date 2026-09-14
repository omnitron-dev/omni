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
 *
 * Rewritten 2026-09-14 when the deployer stopped shelling out to `ssh(1)`.
 * This file mocked `node:child_process`, and after the transport changed two
 * of its three cases still passed — not because the probes were right, but
 * because every command now failed for an unrelated reason. A test that
 * survives the removal of the thing it exercises is testing nothing; the
 * doubles here are the execution service the deployer actually calls.
 *
 * The behaviour also moved from "the probe throws" to "the probe exits
 * non-zero", because that is how `ExecutionService.ssh` reports failure. The
 * distinction the file exists for is unchanged: a command that FAILED is not
 * a command that answered "no".
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

beforeEach(() => {
  commands.length = 0;
});

describe('provisionSlaveNode when a probe cannot reach the host', () => {
  it('does not install a runtime because the host stopped answering', async () => {
    const d = new RemoteDeployer(logger, execution((command) => {
      if (command === 'echo ok') return { stdout: 'ok' };
      if (command.includes('which node')) return unreachable;
      return { stdout: '' };
    }));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    // The line that used to run: `curl … | bash - && apt-get install -y nodejs`.
    expect(commands.some((c) => c.includes('nodesource') || c.includes('apt-get install'))).toBe(false);
  });

  it('does not reinstall omnitron because the second probe failed', async () => {
    const d = new RemoteDeployer(logger, execution((command) => {
      if (command === 'echo ok') return { stdout: 'ok' };
      if (command.includes('which node')) return { stdout: '/usr/bin/node' };
      if (command.includes('which omnitron')) return { exitCode: 255, stderr: 'ssh: broken pipe' };
      return { stdout: '' };
    }));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    expect(commands.some((c) => c.includes('npm install -g @omnitron-dev/omnitron'))).toBe(false);
  });

  it('still installs when the host answers and the runtime really is absent', async () => {
    // The empty string has to keep meaning "absent" — the fix must not turn
    // a real answer into a failure.
    const d = new RemoteDeployer(logger, execution((command) => {
      if (command.includes('which node')) return { stdout: '' };
      return { stdout: 'ok' };
    }));

    await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(commands.some((c) => c.includes('nodesource'))).toBe(true);
  });

  it('asks the host before it decides anything', async () => {
    // `verifySSH` first: the probes below it are only meaningful once the
    // connection itself is known to work, and a run that starts by installing
    // things on an unreachable host has already lost.
    const d = new RemoteDeployer(logger, execution(() => unreachable));

    const ok = await d.provisionSlaveNode(target, 'master.local', 9700, 'proj');

    expect(ok).toBe(false);
    expect(commands).toEqual(['echo ok']);
  });
});
