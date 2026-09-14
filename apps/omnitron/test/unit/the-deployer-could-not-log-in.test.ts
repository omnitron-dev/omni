/**
 * The deployer could not authenticate as the operator had arranged.
 *
 * "Why can a machine added in the console not be deployed to?" has two
 * answers, and this file pins both.
 *
 * The first is that there are two registries and nothing joined them: an
 * operator registers machines in the console, deployment reads `stacks.nodes`
 * out of a project config. That is a design question, and the bridge is
 * `NodeManagerService.nodeToDeployTarget`.
 *
 * The second is smaller and decides the matter on its own. Every command the
 * deployer ran went through `ssh -o BatchMode=yes`, with an optional
 * `-i <keyfile>`, and transfers went through `scp` with the same. `BatchMode`
 * disables every interactive method — password and key passphrase both. The
 * console's Add Node dialog collects exactly those and keeps them encrypted
 * in the daemon's vault; the health monitor presents them through
 * `ExecutionService.ssh()` on every check round.
 *
 * So the product had two SSH implementations, and the one on the deployment
 * path could not express what the operator had given it. Measured against the
 * test host, whose SSH answers a password in 311 ms:
 *
 *     ssh -o BatchMode=yes root@<host> 'echo ok'
 *     → root@<host>: Permission denied (publickey,password).
 */

import { describe, it, expect, vi } from 'vitest';

import {
  RemoteDeployer,
  stackNodeToDeployTarget,
  type DeployTarget,
} from '../../src/services/remote-deployer.service.js';
import type { IStackNode } from '../../src/config/types.js';

const silentLogger: any = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, trace: () => {}, fatal: () => {},
  child: () => silentLogger,
};

/** An execution service that records what it was asked to do. */
function recordingExecution(opts: { fail?: (cmd: string) => boolean } = {}) {
  const ssh = vi.fn(async (target: any, command: string) => ({
    stdout: opts.fail?.(command) ? '' : 'ok',
    stderr: opts.fail?.(command) ? 'boom' : '',
    exitCode: opts.fail?.(command) ? 1 : 0,
    duration: 1,
  }));
  const uploadFile = vi.fn(async () => undefined);
  return { ssh, uploadFile } as never as {
    ssh: ReturnType<typeof vi.fn>;
    uploadFile: ReturnType<typeof vi.fn>;
  };
}

const target: DeployTarget = {
  host: '203.0.113.7',
  sshPort: 2222,
  username: 'deploy',
  password: 'the password the operator typed into the console',
  daemonPort: 9700,
};

describe('every remote command carries the credentials', () => {
  it('presents the password to the SSH engine', async () => {
    const exec = recordingExecution();
    const deployer = new RemoteDeployer(silentLogger, exec as never);

    await deployer.provisionSlaveNode(target, '192.0.2.1', 9700, 'acme');

    expect(exec.ssh).toHaveBeenCalled();
    for (const call of exec.ssh.mock.calls) {
      // Every single one: a provisioning run that authenticates for the first
      // command and not the rest is worse than one that fails at the door.
      expect(call[0]).toMatchObject({ password: target.password, username: 'deploy' });
    }
  });

  it('dials the SSH port, not the daemon port', async () => {
    const exec = recordingExecution();
    const deployer = new RemoteDeployer(silentLogger, exec as never);

    await deployer.provisionSlaveNode(target, '192.0.2.1', 9700, 'acme');

    for (const call of exec.ssh.mock.calls) {
      expect(call[0].port).toBe(2222);
    }
  });

  it('transfers the artifact over the same authenticated connection', async () => {
    const exec = recordingExecution();
    const deployer = new RemoteDeployer(silentLogger, exec as never);

    await deployer.deployToNode(
      target,
      { app: 'payments', version: '1.2.3', path: '/tmp/payments-1.2.3.tar.gz' } as never,
      'acme',
    );

    // `scp` had the same BatchMode problem as `ssh` and needed the same fix;
    // a deployment that can run commands and cannot copy a file is not a
    // deployment.
    expect(exec.uploadFile).toHaveBeenCalledTimes(1);
    expect(exec.uploadFile.mock.calls[0]![0]).toMatchObject({ password: target.password });
  });

  it('treats a failed command as a failure, not as an empty answer', async () => {
    // `ExecutionService.ssh` reports failure in `exitCode` rather than
    // raising. Every `if (!result.trim())` in the deployer would otherwise
    // read a failed command as "the host does not have this" — and the two
    // probes in `provisionSlaveNode` act on that by installing a runtime and
    // a package onto a host that already has both.
    const exec = recordingExecution({ fail: (cmd) => cmd.includes('echo ok') });
    const deployer = new RemoteDeployer(silentLogger, exec as never);

    const ok = await deployer.provisionSlaveNode(target, '192.0.2.1', 9700, 'acme');

    expect(ok).toBe(false);
    // It stopped at the door rather than going on to install things.
    expect(exec.ssh).toHaveBeenCalledTimes(1);
  });
});

describe('a node from a project config becomes the same kind of target', () => {
  const node: IStackNode = {
    host: '198.51.100.4',
    port: 9800,
    role: 'app',
    apps: ['payments'],
    label: 'edge-1',
    ssh: { user: 'root', port: 2200, privateKey: '/keys/id_ed25519' },
  };

  it('keeps the daemon port and the SSH port apart', () => {
    // They are both numbers on the source type and they mean different
    // machines' worth of different things. `IStackNode.port` is the daemon's;
    // `ssh.port` is SSH's.
    const t = stackNodeToDeployTarget(node);

    expect(t.daemonPort).toBe(9800);
    expect(t.sshPort).toBe(2200);
  });

  it('carries the key, the user and the app restriction', () => {
    const t = stackNodeToDeployTarget(node);

    expect(t).toMatchObject({
      host: '198.51.100.4',
      username: 'root',
      privateKey: '/keys/id_ed25519',
      apps: ['payments'],
      label: 'edge-1',
    });
  });

  it('leaves absent fields absent rather than inventing defaults', () => {
    // The defaults belong to the layer that uses them (22 for SSH, 9700 for
    // the daemon), and writing them in here would make a target that says
    // the operator chose them.
    const t = stackNodeToDeployTarget({ host: '198.51.100.4', role: 'app' });

    expect(t).toEqual({ host: '198.51.100.4' });
  });
});
