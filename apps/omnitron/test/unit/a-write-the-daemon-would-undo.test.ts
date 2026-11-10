/**
 * A write the daemon would undo.
 *
 * `omnitron secret set` and `secret delete` asked the daemon, and when the
 * daemon was running and its RPC failed they warned and wrote the store
 * directly. The daemon holds the decrypted vault in memory and writes the
 * whole map back on every change: the CLI's key was invisible to it, and its
 * next write of any key put back the map it had. The command had printed
 * «set (direct mode)» (found 2026-09-25, beside `secret copy`).
 *
 * Held here: the premise, with two real vault services over one store; and
 * that a write refused by a running daemon ends there, while a daemon that is
 * not running still gets direct mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { vaultStore } from '../helpers/vault-store.js';
import { DEFAULT_SECRETS_PASSPHRASE } from '../../src/config/defaults.js';
import { SecretsService } from '../../src/services/secrets.service.js';

function vaultOver(kv: ReturnType<typeof vaultStore>) {
  const svc = new SecretsService(kv as never, DEFAULT_SECRETS_PASSPHRASE, null);
  (svc as unknown as { probeMachineId: () => Promise<string> }).probeMachineId = async () => 'machine-a';
  return svc;
}

describe('two writers sharing the same encrypted vault', () => {
  it('preserves acknowledged concurrent updates and refreshes readers after another writer commits', async () => {
    const kv = vaultStore();
    const daemon = vaultOver(kv), other = vaultOver(kv);
    await daemon.set('a', '1');
    await other.set('b', '2');
    expect(await daemon.get('b')).toBe('2');
    await Promise.all([daemon.set('c', '3'), other.set('d', '4'), daemon.set('e', '5')]);
    expect((await vaultOver(kv).list()).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    await other.delete('a');
    expect(await daemon.get('a')).toBeNull();
  });

  it('keeps the rotated credential when a legacy import races another writer', async () => {
    const kv = vaultStore();
    const daemon = vaultOver(kv), other = vaultOver(kv);
    await Promise.all([daemon.setIfAbsent('a', 'legacy'), other.set('a', 'current')]);
    expect(await vaultOver(kv).get('a')).toBe('current');
  });

  it('keeps the last committed value when SQLite rejects a write', async () => {
    const kv = vaultStore();
    const vault = vaultOver(kv);
    await vault.set('a', 'committed');
    vi.spyOn(kv, 'kvUpdateSync').mockImplementationOnce(() => { throw new Error('write failed'); });
    await expect(vault.set('a', 'pending')).rejects.toThrow('write failed');
    expect(await vault.get('a')).toBe('committed');
    expect(await vaultOver(kv).get('a')).toBe('committed');
  });
});

describe('the commands', () => {
  const said: string[] = [];
  const direct: string[] = [];

  afterEach(() => {
    said.length = 0;
    direct.length = 0;
    process.exitCode = 0;
    vi.doUnmock('../../src/daemon/daemon-client.js');
    vi.doUnmock('../../src/services/secrets.service.js');
    vi.doUnmock('../../src/daemon/daemon-state-store.service.js');
    vi.doUnmock('@xec-sh/kit');
  });

  async function commands(reachable: boolean) {
    vi.resetModules();
    const refuse = async () => {
      throw new Error('token expired');
    };
    vi.doMock('../../src/daemon/daemon-client.js', () => ({
      createDaemonClient: () => ({
        isReachable: async () => reachable,
        service: async () => ({ set: refuse, delete: refuse }),
        disconnect: async () => undefined,
      }),
    }));
    vi.doMock('../../src/services/secrets.service.js', () => ({
      SecretsService: class {
        async set(key: string) {
          direct.push(`set ${key}`);
        }
        async delete(key: string) {
          direct.push(`delete ${key}`);
          return true;
        }
      },
    }));
    vi.doMock('../../src/daemon/daemon-state-store.service.js', () => ({ DaemonStateStore: class {} }));
    vi.doMock('@xec-sh/kit', async (original) => ({
      ...(await original<Record<string, unknown>>()),
      log: {
        success: (m: string) => said.push(m),
        error: (m: string) => said.push(m),
        warn: (m: string) => said.push(m),
        info: (m: string) => said.push(m),
      },
    }));
    return import('../../src/commands/secret.js');
  }

  it('a set or delete refused by a running daemon writes nothing, says why, and fails', async () => {
    const { secretSetCommand, secretDeleteCommand } = await commands(true);

    await secretSetCommand('sample.test.jwt_secret', 'x');
    expect(direct).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(said.join('\n')).toMatch(/Could not set 'sample\.test\.jwt_secret': the daemon is running and refused it — token expired\. Nothing was written/);

    process.exitCode = 0;
    await secretDeleteCommand('sample.test.jwt_secret');
    expect(direct).toEqual([]);
    expect(process.exitCode).toBe(1);
    expect(said.join('\n')).not.toMatch(/direct mode/);
  });

  it('a daemon that is not running still gets direct mode', async () => {
    const { secretSetCommand, secretDeleteCommand } = await commands(false);

    await secretSetCommand('k', 'v');
    await secretDeleteCommand('k');

    expect(direct).toEqual(['set k', 'delete k']);
    expect(said).toEqual([
      expect.stringContaining('A positional secret can appear in shell history'),
      "Secret 'k' set (direct mode)", "Secret 'k' deleted (direct mode)",
    ]);
  });
});
