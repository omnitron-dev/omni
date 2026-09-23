/**
 * A password that had to pass through a command line.
 *
 * Rotating the test node's Bitcoin Core RPC password meant `omnitron secret
 * set <key> <value>`: the value in the shell history and, for as long as the
 * command ran, in the process table. And the `rpcauth` value bitcoind keeps
 * in its place had no producer at all. `rpcauth` is Bitcoin Core's own
 * `share/rpcauth/rpcauth.py`, checked here against Python's `hmac`, and
 * `secret rotate-rpcauth` is the one writer of the pair.
 */

import { describe, it, expect } from 'vitest';

import { rpcauth, rpcauthAccepts } from '../../src/shared/rpcauth.js';

/** `hmac.new(salt.encode(), password.encode(), 'SHA256').hexdigest()`, run in Python 3. */
const FROM_PYTHON =
  'daos:0123456789abcdef0123456789abcdef$90ff3ce205bece1c447b777562931b92721a1956552484506bf368ee0278bcd3';

describe('the rpcauth value', () => {
  it("is Bitcoin Core's own", () => {
    expect(rpcauth('daos', 'correct horse battery staple', '0123456789abcdef0123456789abcdef')).toBe(FROM_PYTHON);
  });

  it('carries a fresh salt each time', () => {
    expect(rpcauth('daos', 'pw')).not.toBe(rpcauth('daos', 'pw'));
  });

  it('lets in the user and password it was made from, and nobody else', () => {
    expect(rpcauthAccepts(FROM_PYTHON, 'daos', 'correct horse battery staple')).toBe(true);
    expect(rpcauthAccepts(FROM_PYTHON, 'daos', 'correct horse battery stapl')).toBe(false);
    expect(rpcauthAccepts(FROM_PYTHON, 'satoshi', 'correct horse battery staple')).toBe(false);
    expect(rpcauthAccepts('daos:nothex$zz', 'daos', 'pw')).toBe(false);
  });
});
