/**
 * Bitcoin Core's `rpcauth` value, as its own `share/rpcauth/rpcauth.py`
 * writes it: `<user>:<salt>$<hmac>`, the salt 16 random bytes in hex and the
 * HMAC-SHA256 keyed with that salt's text over the password.
 *
 * It is the form bitcoind keeps on disk in place of the password, which is
 * why a node's bitcoin.conf can carry it while the password itself stays in
 * the vault and in the applications' environment.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export function rpcauth(user: string, password: string, salt = randomBytes(16).toString('hex')): string {
  return `${user}:${salt}$${createHmac('sha256', salt).update(password).digest('hex')}`;
}

/** Whether an `rpcauth` value lets this user in with this password — the check bitcoind makes. */
export function rpcauthAccepts(value: string, user: string, password: string): boolean {
  const match = /^([^:]+):([0-9a-f]+)\$([0-9a-f]{64})$/.exec(value);
  if (!match || match[1] !== user) return false;
  const expected = Buffer.from(createHmac('sha256', match[2]!).update(password).digest('hex'));
  const given = Buffer.from(match[3]!);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
