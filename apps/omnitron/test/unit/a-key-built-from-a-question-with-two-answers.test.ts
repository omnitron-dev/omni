/**
 * The vault's key depended on whether a shell command answered in time.
 *
 * `SecretsService` binds its AES key to the machine: `scrypt(passphrase +
 * ':' + machineId)`. `machineId` came from a chain of fallbacks — Linux's
 * `/etc/machine-id`, then macOS's `IOPlatformUUID` via a five-second
 * `execSync`, then the hostname, then a constant. Which link answers depends
 * on the host's load at the instant it is asked.
 *
 * `save()` re-encrypts the ENTIRE map. So a single write taken while the
 * probe was slow re-keyed every secret the daemon held, under an identity
 * nothing would derive again once the host was idle. Nothing detected it:
 * the write succeeds, the in-process cache keeps answering, and the failure
 * appears at the next restart as "Failed to decrypt secrets. Wrong
 * passphrase?" — pointing at the one thing that had not changed.
 *
 * Measured 2026-09-14 on the development daemon. The envelope in `state_kv`
 * held both of the fleet's SSH secrets and opened under `hostname`, while the
 * daemon derived under `IOPlatformUUID`. Both remote nodes' health checks had
 * been failing since the restart with "Either privateKey or password must be
 * provided" and "no passphrase given" — an authentication error that was
 * really a key-derivation one. Nothing was lost; it was sealed under the
 * other answer to the same question.
 */

import { describe, it, expect, vi } from 'vitest';
import { hostname } from 'node:os';

import { SecretsService } from '../../src/services/secrets.service.js';
import { DEFAULT_SECRETS_PASSPHRASE } from '../../src/config/defaults.js';

/** A DaemonStateStore stand-in: one in-memory KV map. */
function store(seed: Record<string, unknown> = {}) {
  const rows = new Map<string, unknown>(Object.entries(seed));
  return {
    rows,
    kvGet: async (key: string) => rows.get(key) ?? null,
    kvSet: async (key: string, value: unknown) => void rows.set(key, value),
  } as never;
}

/**
 * A service whose machine probe is under the test's control.
 * Returns the probe spy so a test can count how often the OS was asked.
 */
function service(kv: ReturnType<typeof store>, answers: string[], passphrase = DEFAULT_SECRETS_PASSPHRASE) {
  const svc = new SecretsService(kv, passphrase, null);
  let i = 0;
  const probe = vi.fn(async () => answers[Math.min(i++, answers.length - 1)]!);
  (svc as unknown as { probeMachineId: () => Promise<string> }).probeMachineId = probe;
  return { svc, probe };
}

describe('the machine binding is resolved once and remembered', () => {
  it('persists the probe answer on first use', async () => {
    const kv = store();
    const { svc } = service(kv, ['UUID-A']);

    await svc.set('k', 'v');

    expect(kv.rows.get('secrets:machine-id')).toBe('UUID-A');
  });

  it('asks the OS once, not once per operation', async () => {
    // The probe shells out. It used to run on every derivation — every get,
    // every set, every list — blocking the event loop each time.
    const kv = store();
    const { svc, probe } = service(kv, ['UUID-A']);

    await svc.set('a', '1');
    await svc.set('b', '2');
    await svc.get('a');
    await svc.list();

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it('does not ask the OS at all once the binding is stored', async () => {
    const kv = store({ 'secrets:machine-id': 'UUID-A' });
    const { svc, probe } = service(kv, ['SOMETHING-ELSE']);

    await svc.set('k', 'v');

    expect(probe).not.toHaveBeenCalled();
    expect(await svc.get('k')).toBe('v');
  });

  it('keeps the stored binding when the probe changes its mind', async () => {
    // The whole defect, in one test: seal, then have the OS answer
    // differently, then read. Before the binding was persisted this is the
    // point at which the secrets became unreachable.
    const kv = store();
    const first = service(kv, ['UUID-A']);
    await first.svc.set('ssh-password', 'hunter2');

    const second = service(kv, ['HOSTNAME-FALLBACK']);

    expect(await second.svc.get('ssh-password')).toBe('hunter2');
  });
});

describe('an envelope sealed under a retired binding is recovered', () => {
  /**
   * Seal a store the pre-fix way: no persisted binding, sealed under `id`.
   *
   * `id` is the host's real hostname on purpose. Recovery can only try
   * identities this machine is able to produce — that is the point of the
   * binding — so a fixture sealed under an invented string would assert a
   * capability the design deliberately does not have.
   */
  async function sealedUnder(id: string, secrets: Record<string, string>) {
    const kv = store();
    const { svc } = service(kv, [id]);
    for (const [k, v] of Object.entries(secrets)) await svc.set(k, v);
    kv.rows.delete('secrets:machine-id'); // as a pre-fix daemon left it
    return kv;
  }

  it('opens a store sealed under the hostname while the probe says UUID', async () => {
    // The live case, exactly: written when `ioreg` did not answer in time and
    // the chain fell through to the hostname, read when `ioreg` answered.
    const kv = await sealedUnder(hostname(), { 'node:n1:password': 'p' });
    const { svc } = service(kv, ['IOPLATFORM-UUID']);

    expect(await svc.get('node:n1:password')).toBe('p');
  });

  it('adopts the binding that worked, so the next read is direct', async () => {
    const kv = await sealedUnder(hostname(), { 'node:n1:password': 'p' });
    const { svc, probe } = service(kv, ['IOPLATFORM-UUID']);

    await svc.get('node:n1:password');

    expect(kv.rows.get('secrets:machine-id')).toBe(hostname());

    // And a fresh service reads it without recovering anything.
    const next = service(kv, ['IOPLATFORM-UUID']);
    expect(await next.svc.get('node:n1:password')).toBe('p');
    expect(next.probe).not.toHaveBeenCalled();
    void probe;
  });

  it('recovers every secret in the envelope, not just the one asked for', async () => {
    // `save()` writes the whole map, so a re-key strands all of it at once
    // and recovery has to return all of it.
    const kv = await sealedUnder(hostname(), { a: '1', b: '2', c: '3' });
    const { svc } = service(kv, ['IOPLATFORM-UUID']);

    expect((await svc.list()).sort()).toEqual(['a', 'b', 'c']);
  });

  it('still refuses a genuinely wrong passphrase', async () => {
    // Recovery must not turn the vault into something that opens for anyone
    // who can read the machine's own public identifiers.
    const kv = await sealedUnder(hostname(), { a: '1' });
    const { svc } = service(kv, ['IOPLATFORM-UUID'], 'a-passphrase-an-operator-chose');

    await expect(svc.get('a')).rejects.toThrow(/Failed to decrypt secrets/);
  });
});
