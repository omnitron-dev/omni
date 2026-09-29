/**
 * A temp dir the gates left behind.
 *
 * 2026-09-29: the master's disk at 99 %, the Docker engine stopped with every
 * database of the dev stack in it. 112 GB of it was `~/.tmp/<nanoid>/ssr` —
 * 16 443 directories vitest 5.0.0 leaves on every run — from every suite and
 * every release gate since 2026-09-11. `~/.tmp` is the master's TMPDIR, and
 * nothing clears it. vitest is patched in both repositories; a gate killed at
 * its timeout still cleans nothing, and neither does any other tool that
 * forgets.
 *
 * Held here: a build gives its steps a temporary directory of its own —
 *   - under the system's own temporary directory, which the system clears,
 *     so a build killed outright does not leave it for good;
 *   - short enough that a test's unix socket under it fits in 104 bytes;
 *   - removed when the build ends, however it ends, `--keep-source` or not;
 * and a build request cannot point the steps somewhere else.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { checkedEnv, makeBuildTempDir, systemTempRoot, withBuildRootGoneOnFailure } from '../../src/release/build-run.js';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'gates-temp-court-'));
afterAll(() => fs.rmSync(HOME, { recursive: true, force: true }));

/** A build root with clones in `src/`, and a temp dir with something a gate left in it. */
function aBuild(): { root: string; tmp: string } {
  const root = fs.mkdtempSync(path.join(HOME, 'root-'));
  fs.mkdirSync(path.join(root, 'src', 'daos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'daos', 'package.json'), '{}');
  const tmp = makeBuildTempDir(HOME);
  fs.mkdirSync(path.join(tmp, 'hqLP_2YcZs8cypI1cXdwO', 'ssr'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'hqLP_2YcZs8cypI1cXdwO', 'ssr', 'f1d98c3c'), 'module copy');
  return { root, tmp };
}

describe('where a build keeps its steps’ temporary files', () => {
  it('is the system’s own temporary directory, not TMPDIR', () => {
    expect(systemTempRoot('darwin')).toBe('/private/tmp');
    expect(systemTempRoot('linux')).toBe('/tmp');
  });

  it('is a fresh directory there, short enough for a test’s unix socket', () => {
    const dir = makeBuildTempDir();
    try {
      expect(fs.statSync(dir).isDirectory()).toBe(true);
      expect(dir.startsWith(path.join(systemTempRoot(), 'omnitron-build-'))).toBe(true);
      // What a socket test makes: mkdtemp under TMPDIR, a socket inside.
      const socket = path.join(dir, 'netron-unix-test-a1B2c3', 'server.sock');
      expect(Buffer.byteLength(socket)).toBeLessThan(104);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the temporary directory goes however the build ends', () => {
  it('after a build that passed — its clones are removed by the build itself, the temp dir here', async () => {
    const { root, tmp } = aBuild();
    expect(await withBuildRootGoneOnFailure(undefined, async (where) => ((where.root = root), (where.tmp = tmp), 'built'))).toBe('built');
    expect(fs.existsSync(tmp)).toBe(false);
    expect(fs.existsSync(path.join(root, 'src'))).toBe(true);
  });

  it('after a build that threw — with its clones', async () => {
    const { root, tmp } = aBuild();
    await expect(
      withBuildRootGoneOnFailure(undefined, async (where) => {
        where.root = root;
        where.tmp = tmp;
        throw new Error('gates timed out');
      }),
    ).rejects.toThrow(/gates timed out/);
    expect(fs.existsSync(tmp)).toBe(false);
    expect(fs.existsSync(path.join(root, 'src'))).toBe(false);
  });

  it('after a build that threw with --keep-source — the clones stay, what the tools left does not', async () => {
    const { root, tmp } = aBuild();
    await expect(
      withBuildRootGoneOnFailure(true, async (where) => {
        where.root = root;
        where.tmp = tmp;
        throw new Error('The build was stopped');
      }),
    ).rejects.toThrow(/stopped/);
    expect(fs.existsSync(tmp)).toBe(false);
    expect(fs.existsSync(path.join(root, 'src', 'daos', 'package.json'))).toBe(true);
  });
});

describe('a build request cannot choose it', () => {
  it('refuses TMPDIR, and still takes what the gates need', () => {
    expect(() => checkedEnv({ TMPDIR: '/Users/someone/.tmp' })).toThrow(/may not set TMPDIR/);
    expect(checkedEnv({ TEST_DATABASE__PORT: '5433' })).toEqual({ TEST_DATABASE__PORT: '5433' });
  });
});
