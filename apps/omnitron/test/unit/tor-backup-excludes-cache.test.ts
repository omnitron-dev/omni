/**
 * A backup named "tor-keys" was 99.97% Tor's public directory cache.
 *
 * `createTorKeysBackup` archived `-C /var/lib/tor .` — the whole data
 * directory. What dominates that directory is not key material: measured on
 * the dev host, `cached-microdescs` is 42.5 MiB uncompressed,
 * `cached-microdescs.new` 16 MiB and `cached-microdesc-consensus` 3.5 MiB,
 * against `hs_ed25519_secret_key` files of 96 bytes each. Forty archives held
 * 400 MiB, essentially all of it a consensus any Tor client re-downloads in
 * minutes — on a machine whose disk has filled before and taken the database
 * and the onion with it.
 *
 * Measured against the running container: 19,421,543 bytes becomes 5,897, and
 * both hidden services keep their secret key, public key and hostname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../../src/services/backup.service.ts', import.meta.url),
  'utf8',
);

describe('the tor-keys backup command', () => {
  it('excludes the directory cache', () => {
    expect(source).toMatch(/--exclude='\$\{?/);
    for (const glob of ['./cached-*', './diff-cache', './unverified-*']) {
      expect(source, `${glob} must be excluded`).toContain(`'${glob}'`);
    }
  });

  it('excludes by name rather than listing what to keep', () => {
    // A hidden-service directory added later must still be captured without
    // anyone remembering to update a list, which an allowlist would not do.
    expect(source).toContain('-C /var/lib/tor .');
  });

  it('does not exclude the hidden-service material', () => {
    const excluded = source.slice(
      source.indexOf('TOR_REGENERABLE_STATE = ['),
      source.indexOf('] as const;', source.indexOf('TOR_REGENERABLE_STATE = [')),
    );
    for (const kept of ['hs_ed25519', 'hostname', 'authorized_clients']) {
      expect(excluded, `${kept} must not be excluded`).not.toContain(kept);
    }
  });
});
