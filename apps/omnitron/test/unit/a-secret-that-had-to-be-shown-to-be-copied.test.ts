/**
 * A secret that had to be shown to be copied.
 *
 * paysys used one Monero password for the RPC login and for the wallet file,
 * and daos split them (caa977b1, 56b55b18): the file's own password is a key
 * of its own, which must start as a copy of today's value so that the
 * deployment that begins reading it changes nothing (2026-09-25). The vault
 * had no way to make that copy: `secret get` prints the value, and `secret
 * set <key> <value>` takes it as an argument — the shell history and the
 * process table, the path `rotate-rpcauth` and `generate` exist to avoid.
 *
 * Held here: `copy` is made where the vault is kept, answers with the two key
 * names, records itself as the read it is, refuses to replace a key, and the
 * command prints names only.
 */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SECRETS_PASSPHRASE } from '../../src/config/defaults.js';
import { SecretsRpcService } from '../../src/services/secrets.rpc-service.js';
import { SecretsService } from '../../src/services/secrets.service.js';

const VALUE = 'the-wallet-password-nobody-should-see-9f3c';

/** A DaemonStateStore stand-in: one in-memory KV map. */
function vault() {
  const rows = new Map<string, unknown>();
  const store = { kvGet: async (key: string) => rows.get(key) ?? null, kvSet: async (key: string, value: unknown) => void rows.set(key, value) };
  const svc = new SecretsService(store as never, DEFAULT_SECRETS_PASSPHRASE, null);
  (svc as unknown as { probeMachineId: () => Promise<string> }).probeMachineId = async () => 'machine-a';
  return svc;
}

describe('a copy made where the vault is kept', () => {
  it('holds the same secret under the new key, and gives the value to nobody', async () => {
    const secrets = vault();
    await secrets.set('monero.mainnet.rpc_password', VALUE);

    const answer = await secrets.copy('monero.mainnet.rpc_password', 'monero.mainnet.wallet_file_password');

    expect(answer).toBeUndefined();
    expect(await secrets.get('monero.mainnet.wallet_file_password')).toBe(VALUE);
    expect(await secrets.get('monero.mainnet.rpc_password')).toBe(VALUE);
  });

  it('refuses to replace a key, to copy what is not there, and to copy a key onto itself', async () => {
    const secrets = vault();
    await secrets.set('a', VALUE);
    await secrets.set('b', 'somebody-elses');

    await expect(secrets.copy('a', 'b')).rejects.toThrow(/already holds 'b' — nothing was copied/);
    expect(await secrets.get('b')).toBe('somebody-elses');
    await expect(secrets.copy('missing', 'c')).rejects.toThrow(/has no 'missing'/);
    expect(await secrets.get('c')).toBeNull();
    await expect(secrets.copy('a', 'a')).rejects.toThrow(/onto itself/);
    await expect(secrets.copy('', 'c')).rejects.toThrow(/needs the key to copy/);
  });
});

describe('over the daemon\'s RPC', () => {
  it('answers with the two names and records a read of the one and a write of the other — no value in either', async () => {
    const secrets = vault();
    await secrets.set('monero.mainnet.rpc_password', VALUE);
    const record = vi.fn(async () => undefined);
    const rpc = new SecretsRpcService(secrets, { record } as never);

    const answer = await rpc.copy({ from: ' monero.mainnet.rpc_password ', to: 'monero.mainnet.wallet_file_password' });

    expect(answer).toEqual({ from: 'monero.mainnet.rpc_password', to: 'monero.mainnet.wallet_file_password' });
    expect(record).toHaveBeenCalledWith({
      action: 'secret.copy',
      resourceType: 'secret',
      resourceId: 'monero.mainnet.wallet_file_password',
      details: { from: 'monero.mainnet.rpc_password' },
    });
    expect(JSON.stringify([answer, record.mock.calls])).not.toContain(VALUE);
  });
});

describe('the command', () => {
  it('prints the key names and not the value', async () => {
    const said: string[] = [];
    const copy = vi.fn(async (data: { from: string; to: string }) => data);
    vi.resetModules();
    vi.doMock('../../src/daemon/daemon-client.js', () => ({
      createDaemonClient: () => ({
        isReachable: async () => true,
        service: async () => ({ copy }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('@xec-sh/kit', async (original) => ({
      ...(await original<Record<string, unknown>>()),
      log: {
        success: (m: string) => said.push(m),
        error: (m: string) => said.push(m),
        warn: (m: string) => said.push(m),
        info: (m: string) => said.push(m),
      },
    }));
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    // Read before `mockRestore`, which forgets the calls it saw.
    let wrote: string[] = [];
    try {
      const { secretCopyCommand } = await import('../../src/commands/secret.js');
      await secretCopyCommand('monero.mainnet.rpc_password', 'monero.mainnet.wallet_file_password');
      wrote = write.mock.calls.map((c) => String(c[0]));
    } finally {
      write.mockRestore();
      vi.doUnmock('../../src/daemon/daemon-client.js');
      vi.doUnmock('@xec-sh/kit');
    }

    expect(copy).toHaveBeenCalledWith({ from: 'monero.mainnet.rpc_password', to: 'monero.mainnet.wallet_file_password' });
    expect(said).toEqual(["Copied 'monero.mainnet.rpc_password' to 'monero.mainnet.wallet_file_password' — kept in the vault, not shown"]);
    expect(wrote).toEqual([]);
  });
});
