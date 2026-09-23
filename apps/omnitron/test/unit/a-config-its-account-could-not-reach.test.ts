/**
 * A config its account could not reach.
 *
 * A node writes a service's config file as root and gives it to the
 * service's account, 0640. Two things between the file and that account were
 * nobody's decision (found by omni-be, 2026-09-23): the directory it goes in
 * took whatever mode the daemon's umask left — 0755 under 022, and under 027
 * a 0750 root:root directory the account could not enter — and a `chown`
 * that failed was swallowed, leaving a root-owned file reported as written.
 * The data directory's `chmod 750` was not read either.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applyBareMetal, localHost, type HostRunner } from '../../src/infrastructure/bare-metal-runner.js';

/** The umask this file started under; set and put back, never read bare. */
const ORIGINAL = process.umask(0o022);
process.umask(ORIGINAL);

let restore: number | undefined;
afterEach(async () => {
  if (restore !== undefined) process.umask(restore);
  restore = undefined;
});

const modeOf = async (path: string) => ((await stat(path)).mode & 0o777).toString(8);

async function inTemp(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'a-config-its-account-could-not-reach-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("a config's directory", () => {
  it('is 0755 at every level this made, whatever the umask', () =>
    inTemp(async (root) => {
      restore = process.umask(0o077);
      await localHost().writeFile(join(root, 'etc/omni/bitcoin/bitcoin.conf'), 'server=1\n', { mode: '0640' });

      expect(await modeOf(join(root, 'etc'))).toBe('755');
      expect(await modeOf(join(root, 'etc/omni'))).toBe('755');
      expect(await modeOf(join(root, 'etc/omni/bitcoin'))).toBe('755');
      expect(await modeOf(join(root, 'etc/omni/bitcoin/bitcoin.conf'))).toBe('640');
    }));

  it('is left as it was when this did not make it', () =>
    inTemp(async (root) => {
      await mkdir(join(root, 'etc'), { mode: 0o700 });
      await localHost().writeFile(join(root, 'etc/bitcoin/bitcoin.conf'), 'server=1\n', { mode: '0640' });

      expect(await modeOf(join(root, 'etc'))).toBe('700');
      expect(await modeOf(join(root, 'etc/bitcoin'))).toBe('755');
    }));

  it('was measured under the umask this file started with, not under the last test’s', () => {
    const now = process.umask(0o022);
    process.umask(now);
    expect(now).toBe(ORIGINAL);
  });
});

describe("a config's owner", () => {
  it('that cannot be given is a refusal, and nothing is left behind', () =>
    inTemp(async (root) => {
      const target = join(root, 'etc/bitcoin/bitcoin.conf');

      await expect(
        localHost().writeFile(target, 'server=1\n', { mode: '0640', owner: 'no-such-account-omnitron' })
      ).rejects.toThrow(/^could not give .*bitcoin\.conf to no-such-account-omnitron: .+/);
      expect(await readdir(join(root, 'etc/bitcoin'))).toEqual([]);
    }));
});

describe("a data directory's mode", () => {
  const refusingChmod: HostRunner = {
    run: async (argv) =>
      argv[0] === 'chmod'
        ? { ok: false, stdout: '', stderr: 'chmod: changing permissions: Operation not permitted' }
        : { ok: true, stdout: '', stderr: '' },
    shell: async () => ({ ok: true, stdout: '', stderr: '' }),
    readFile: async () => null,
    writeFile: async () => undefined,
    exists: async () => true,
    rename: async () => undefined,
  };
  const logger = { info: () => undefined, error: () => undefined } as never;

  it.each([
    { type: 'create-data-dir' as const, path: '/var/lib/bitcoind', owner: 'bitcoin' },
    {
      type: 'adopt-data-dir' as const,
      from: '/root/chain',
      to: '/var/lib/bitcoind',
      owner: 'bitcoin',
      setAside: undefined,
    },
  ])('that cannot be closed stops the $type step, and says why', async (action) => {
    const result = await applyBareMetal([action], refusingChmod, logger, 'bitcoin');

    expect(result.failed?.error).toBe(
      'could not close /var/lib/bitcoind to other accounts: chmod: changing permissions: Operation not permitted'
    );
  });
});
