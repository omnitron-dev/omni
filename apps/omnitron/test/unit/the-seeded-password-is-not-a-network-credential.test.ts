/**
 * Migration 001 seeds `admin` / `admin` and its comment says the password
 * "MUST be changed on first login". Nothing enforced that — no flag, no gate,
 * no check anywhere in the daemon. A comment is not a control.
 *
 * It matters only where an operator has deliberately published a surface:
 * the daemon binds loopback by default and so does the console, and both
 * defaults are argued for in their own comments. But `daemon.host` and
 * `daemon.consoleBindHost` exist precisely so a fleet operator can publish
 * them — and the whole control plane is behind that password. Start, stop,
 * restart, logs, config, every managed app.
 *
 * Console publication falls back to loopback. Public master ingress is refused
 * until the credential check confirms the seed is no longer accepted. The
 * startup-policy tests also cover an unavailable check and hostname spoofing.
 */
import { describe, it, expect } from 'vitest';
import { randomBytes, scryptSync } from 'node:crypto';

import { isLoopbackHost, resolveBindHost } from '../../src/daemon/daemon.js';
import { AuthService } from '../../src/services/auth.service.js';

/** The hash shape migration 001 writes: `scrypt:salt:derived`. */
function hashOf(password: string): string {
  const salt = randomBytes(32);
  return `scrypt:${salt.toString('hex')}:${scryptSync(password, salt, 64).toString('hex')}`;
}

/** An AuthService over a stub that answers one `omnitron_users` row. */
function authWith(row: { passwordHash: string } | undefined) {
  const query = {
    select: () => query, where: () => query, orderBy: () => query, limit: () => query,
    execute: async () => row ? [{id: 'renamed-or-demoted-account', ...row}] : [],
  };
  const db = { selectFrom: () => query };
  return new AuthService(db as never, 'test-secret');
}

describe('isLoopbackHost', () => {
  it('knows the addresses that reach only this host', () => {
    for (const h of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]', '127.0.0.53']) {
      expect(isLoopbackHost(h), h).toBe(true);
    }
  });

  it('knows the ones that do not', () => {
    for (const h of ['0.0.0.0', '::', '10.0.0.5', '192.168.1.7', 'daemon.internal']) {
      expect(isLoopbackHost(h), h).toBe(false);
    }
  });

  it('treats an absent host as the loopback default', () => {
    // `resolveBindHost(undefined)` is '127.0.0.1', so absence must read the
    // same way here or the check fires on a daemon that never published.
    expect(isLoopbackHost(undefined)).toBe(true);
    expect(isLoopbackHost(resolveBindHost(undefined))).toBe(true);
  });
});

describe('AuthService.isUsingSeededAdminPassword', () => {
  it('recognises the shipped password independently of the account name or role', async () => {
    const auth = authWith({ passwordHash: hashOf('admin') });

    await expect(auth.isUsingSeededAdminPassword()).resolves.toBe(true);
  });

  it('answers false once it has been changed', async () => {
    const auth = authWith({ passwordHash: hashOf('something the operator chose') });

    await expect(auth.isUsingSeededAdminPassword()).resolves.toBe(false);
  });

  it('answers false when there is no such account', async () => {
    const auth = authWith(undefined);

    await expect(auth.isUsingSeededAdminPassword()).resolves.toBe(false);
  });

  it('does not mistake a malformed hash for a match', async () => {
    const auth = authWith({ passwordHash: 'admin' });

    await expect(auth.isUsingSeededAdminPassword()).resolves.toBe(false);
  });
});
