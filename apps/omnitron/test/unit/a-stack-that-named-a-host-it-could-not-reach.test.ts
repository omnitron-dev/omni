/**
 * Deploying to a machine the console had already registered failed to connect.
 *
 * A stack says WHICH host an app runs on. The node registry says HOW to
 * reach it — the user, the port, and the key or password, held encrypted in
 * the daemon's vault because they are credentials and a config file in a
 * repository is not where those go.
 *
 * Nothing joined the two. `stackNodeToDeployTarget` read the stack's own
 * `ssh` block and nothing else, so a stack naming a registered, provisioned
 * node failed at its first connection:
 *
 *     Invalid SSH options: Either privateKey or password must be provided
 *
 * — for a node the same daemon was holding an SSH tunnel to as it said so.
 */

import { describe, it, expect } from 'vitest';

import { withNodeCredentials, stackNodeToDeployTarget } from '../../src/services/remote-deployer.service.js';

const stackNode = { host: '37.27.130.185', port: 9700, role: 'app' as const, label: 'test' };
const registered = { host: '37.27.130.185', port: 22, username: 'root', password: 'from-the-vault' };

describe('a stack node and the registry entry for the same machine', () => {
  it('takes the credential from the registry', () => {
    const target = withNodeCredentials(stackNodeToDeployTarget(stackNode), registered);

    expect(target.username).toBe('root');
    expect(target.password).toBe('from-the-vault');
    // And keeps what the stack said: the daemon port is the stack's business.
    expect(target.daemonPort).toBe(9700);
  });

  it('lets the stack override what it states explicitly', () => {
    const declared = stackNodeToDeployTarget({ ...stackNode, ssh: { user: 'deploy', port: 2222 } });

    const target = withNodeCredentials(declared, registered);

    // An operator who wrote `ssh.user` in the stack meant it; a registry
    // entry is the default, not an override.
    expect(target.username).toBe('deploy');
    expect(target.sshPort).toBe(2222);
    // What the stack left out still comes from the registry.
    expect(target.password).toBe('from-the-vault');
  });

  it('changes nothing for a host the registry does not know', () => {
    const declared = stackNodeToDeployTarget({ ...stackNode, ssh: { user: 'deploy' } });

    expect(withNodeCredentials(declared, null)).toEqual(declared);
  });

  it('prefers a key the stack declared over a password in the vault', () => {
    const declared = stackNodeToDeployTarget({ ...stackNode, ssh: { privateKey: '/home/me/.ssh/id_ed25519' } });

    const target = withNodeCredentials(declared, registered);

    // Both are now present, and ssh2 tries the key first. The point is that
    // neither is dropped: a stack that names a key for a node whose vault
    // entry is a password must still connect.
    expect(target.privateKey).toBe('/home/me/.ssh/id_ed25519');
    expect(target.password).toBe('from-the-vault');
  });

  it('carries a passphrase, which a stack config cannot express', () => {
    // `ISSHConfig` has no passphrase field, so an encrypted key declared in
    // a stack can only work if the registry supplies the passphrase.
    const target = withNodeCredentials(stackNodeToDeployTarget(stackNode), {
      host: stackNode.host, username: 'root', privateKey: 'KEY', passphrase: 'PASS',
    });

    expect(target.passphrase).toBe('PASS');
  });
});
