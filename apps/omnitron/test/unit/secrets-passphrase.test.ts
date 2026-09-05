/**
 * One encrypted store, two ways in — they must derive the same key.
 *
 * Secrets live in the daemon's KV store, reachable two ways: the
 * `OmnitronSecrets` RPC, and `commands/secret.ts` reading the file directly
 * when the daemon is down. Each had its own fallback passphrase —
 * `omnitron-dev-passphrase` in daemon.module.ts, `omnitron-default-passphrase`
 * in commands/secret.ts — so a secret written through one could not be read
 * through the other.
 *
 * The failure was live on the development host: `omnitron secret list`
 * printed a key, while the same call over RPC answered "Failed to decrypt
 * secrets. Wrong passphrase?" — with no passphrase configured anywhere,
 * which is what made it baffling. The console and the MCP tools see only the
 * daemon's answer.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SECRETS_PASSPHRASE } from '../../src/config/defaults.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => fs.readFileSync(path.resolve(here, '../..', rel), 'utf8');

describe('the default secrets passphrase', () => {
  it('is defined once', () => {
    expect(DEFAULT_SECRETS_PASSPHRASE).toBeTruthy();
  });

  it('is what both entry points fall back to', () => {
    // Pinned as source text rather than by calling them: the daemon's copy
    // sits inside a DI provider factory that needs a whole module graph, and
    // the CLI's inside a command that touches the real store. What matters
    // is that neither carries a literal of its own.
    for (const file of ['src/daemon/daemon.module.ts', 'src/commands/secret.ts']) {
      expect(read(file), file).toContain('DEFAULT_SECRETS_PASSPHRASE');
    }
  });

  it('is the only default either side names', () => {
    // The specific literals that disagreed, pinned by name so a later
    // "simplification" that reintroduces one trips here.
    for (const file of ['src/daemon/daemon.module.ts', 'src/commands/secret.ts']) {
      const src = read(file);
      expect(src, file).not.toContain("'omnitron-default-passphrase'");
      expect(src, file).not.toMatch(/\?\?\s*'omnitron-[a-z-]*passphrase'/);
    }
  });

  it('production still refuses to run on it', () => {
    // Sharing a development default is only acceptable because production
    // cannot reach it.
    expect(read('src/daemon/daemon.module.ts')).toContain(
      'secrets.passphrase must be configured in production mode'
    );
  });
});

describe('the CLI fallback', () => {
  it('says something when the daemon was reachable and its RPC still failed', () => {
    // A daemon that is down is the case the fallback exists for. A daemon
    // that is up and failing is a different event, and printing the file's
    // contents as though nothing happened is how the passphrase split stayed
    // invisible: the operator saw a successful listing.
    const src = read('src/commands/secret.ts');

    expect(src).toContain('warnIfHidingAFailure');
    expect(src).not.toMatch(/catch \{\s*\/\/ Fall through/);
  });

  it('stays silent when the daemon is simply not running', () => {
    const src = read('src/commands/secret.ts');
    const fn = src.slice(src.indexOf('function warnIfHidingAFailure'));

    expect(fn.slice(0, 200)).toMatch(/if \(!reachable\) return;/);
  });
});
