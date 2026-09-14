/**
 * `deploy` restarted, and `rollback` restarted the same thing.
 *
 * `omnitron deploy app <app> --target <alias>` connected to the remote daemon,
 * called `restartApp({ name: app })`, and printed
 * `Deployed '<app>' to <alias>`. No artifact was built, nothing was
 * transferred, nothing was installed. `--strategy rolling|blue-green|canary`
 * and `--version` were accepted and read by nothing.
 *
 * `rollback` was the SAME call — byte for byte — and printed `Rolled back`.
 * A rollback is the control you reach for when something is already wrong;
 * learning at that moment that it restarts the version you are trying to get
 * away from is the most expensive time to learn it.
 *
 * Both now refuse and say where the real operation lives. The behaviour they
 * did have — restart an app on a registered remote daemon — was the only way
 * to do that from the CLI (`fleet` only reads, `remote` only managed the
 * registry), so it moved to `omnitron remote restart` rather than being
 * deleted with the lie.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const logged: Array<{ level: string; text: string }> = [];

vi.mock('@xec-sh/kit', () => ({
  log: {
    error: (t: string) => logged.push({ level: 'error', text: t }),
    info: (t: string) => logged.push({ level: 'info', text: t }),
    success: (t: string) => logged.push({ level: 'success', text: t }),
    warn: (t: string) => logged.push({ level: 'warn', text: t }),
  },
  table: () => {},
}));

/** Any attempt to reach a daemon is a failure of the refusal. */
const createRemoteDaemonClient = vi.fn(() => {
  throw new Error('a refusal must not open a connection');
});
vi.mock('../../src/daemon/daemon-client.js', () => ({
  createRemoteDaemonClient,
  createDaemonClient: vi.fn(),
  LONG_REQUEST_TIMEOUT: 600_000,
  isRequestTimeout: () => false,
}));

const { deployCommand, rollbackCommand } = await import('../../src/commands/deploy.js');

const said = () => logged.map((l) => l.text).join('\n');

beforeEach(() => {
  logged.length = 0;
  createRemoteDaemonClient.mockClear();
});

describe('omnitron deploy', () => {
  it('refuses, and does not reach for a daemon', async () => {
    await deployCommand('payments', { target: 'prod-1' });

    expect(createRemoteDaemonClient).not.toHaveBeenCalled();
    expect(logged.some((l) => l.level === 'error')).toBe(true);
    // It must never again report the operation it did not perform.
    expect(said()).not.toMatch(/^Deployed /m);
  });

  it('names the command that actually deploys', async () => {
    await deployCommand('payments', { target: 'prod-1' });

    // A refusal that does not say where to go is a dead end. Deployment is a
    // stack operation: provision the node, ship the artifact, install, verify.
    expect(said()).toContain('omnitron stack start');
  });

  it('names the new home of the behaviour it used to have', async () => {
    await deployCommand('payments', { target: 'prod-1' });

    // The restart was legitimate and had no other home in the CLI.
    expect(said()).toContain('omnitron remote restart prod-1 payments');
  });
});

describe('omnitron rollback', () => {
  it('refuses, and does not reach for a daemon', async () => {
    await rollbackCommand('payments', { target: 'prod-1' });

    expect(createRemoteDaemonClient).not.toHaveBeenCalled();
    expect(logged.some((l) => l.level === 'error')).toBe(true);
    expect(said()).not.toMatch(/^Rolled back /m);
  });

  it('says that no previous version was ever selected', async () => {
    await rollbackCommand('payments', { target: 'prod-1' });

    // The distinction that matters: not "rollback failed" but "this never
    // restored anything". Artifacts ARE kept per version on the node, so the
    // operation is implementable — which is why the message says where they
    // are rather than calling the idea impossible.
    expect(said()).toContain('/opt/omnitron/artifacts/');
  });

  it('is no longer the same operation as deploy', async () => {
    await deployCommand('payments', { target: 'prod-1' });
    const fromDeploy = said();
    logged.length = 0;
    await rollbackCommand('payments', { target: 'prod-1' });
    const fromRollback = said();

    // They were byte-for-byte the same call. Two commands with two names must
    // not be one operation.
    expect(fromRollback).not.toBe(fromDeploy);
  });
});
