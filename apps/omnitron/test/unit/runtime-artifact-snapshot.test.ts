import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { inspectRuntimeArtifact, runtimeArtifactDigest, verifyRuntimeArtifact } from '../../src/shared/runtime-artifact.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

async function sealed() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-snapshot-')); roots.push(root);
  await fs.mkdir(path.join(root, 'files'));
  await fs.writeFile(path.join(root, 'files/a'), 'first');
  await fs.writeFile(path.join(root, 'files/b'), 'other');
  await fs.symlink('files/a', path.join(root, 'linked'));
  const sha256 = await runtimeArtifactDigest(root);
  const manifest = { protocol: 1, sha256, platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 };
  await fs.writeFile(path.join(root, 'RUNTIME.json'), JSON.stringify(manifest));
  return { root, sha256, manifest, entry: path.join(root, 'files/a') };
}

it('preserves protocol 1 bytes and reuses a proof without reading file contents again', async () => {
  const fixture = await sealed();
  expect(await runtimeArtifactDigest(fixture.root)).toBe(fixture.sha256);
  const proof = await inspectRuntimeArtifact(fixture.root, fixture.sha256);
  expect(proof.manifest).toEqual(fixture.manifest);
  const open = vi.spyOn(fs, 'open'), read = vi.spyOn(fs, 'readFile');
  await proof.assertUnchanged(); await proof.assertUnchanged();
  expect(open).not.toHaveBeenCalled(); expect(read).not.toHaveBeenCalled();
});

it('preserves the protocol byte order across directories, executable files, links and streamed files', async () => {
  const { root } = await sealed();
  await fs.mkdir(path.join(root, 'files/nested'));
  await fs.writeFile(path.join(root, 'files/nested/z'), 'nested');
  await fs.writeFile(path.join(root, 'files-last'), 'executable', { mode: 0o700 });
  const large = Buffer.alloc(256 * 1024 + 1, 0x5a);
  await fs.writeFile(path.join(root, 'stream'), large);
  // A complete-path sort would put files-last before files/a. Protocol 1 visits the directory first.
  const expected = createHash('sha256');
  const file = (relative: string, executable: number, contents: string | Buffer) => {
    expected.update(['file', relative, String(executable), ''].join('\0'));
    expected.update(contents); expected.update('\0');
  };
  file('files/a', 0, 'first'); file('files/b', 0, 'other'); file('files/nested/z', 0, 'nested');
  file('files-last', 0o100, 'executable');
  expected.update(['link', 'linked', 'files/a', ''].join('\0'));
  file('stream', 0, large);
  expect(await runtimeArtifactDigest(root)).toBe(expected.digest('hex'));
});

it('overlaps small-file reads with a bounded number of open descriptors', async () => {
  const { root } = await sealed();
  for (let index = 0; index < 24; index++) await fs.writeFile(path.join(root, 'files', `extra-${index}`), Buffer.alloc(32 * 1024));
  const original = fs.open.bind(fs);
  let active = 0, maximum = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args), close = handle.close.bind(handle);
    active++; maximum = Math.max(maximum, active);
    vi.spyOn(handle, 'close').mockImplementation(async () => { try { await close(); } finally { active--; } });
    return handle;
  });
  await runtimeArtifactDigest(root);
  expect(maximum).toBeGreaterThan(1);
  expect(maximum).toBeLessThanOrEqual(16);
  expect(active).toBe(0);
});

it('settles all prefetched reads and closes their descriptors before rejecting an audit', async () => {
  const { root, entry } = await sealed(), original = fs.open.bind(fs);
  for (let index = 0; index < 16; index++) await fs.writeFile(path.join(root, 'files', `extra-${index}`), 'other');
  let active = 0;
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args), close = handle.close.bind(handle);
    active++;
    vi.spyOn(handle, 'close').mockImplementation(async () => { try { await close(); } finally { active--; } });
    if (args[0] === entry) vi.spyOn(handle, 'read').mockRejectedValue(new Error('injected read failure'));
    return handle;
  });
  await expect(runtimeArtifactDigest(root)).rejects.toThrow('injected read failure');
  expect(active).toBe(0);
});

const changes: Record<string, (root: string) => Promise<unknown>> = {
  addition: root => fs.writeFile(path.join(root, 'files/new'), 'added'),
  deletion: root => fs.unlink(path.join(root, 'files/b')),
  'same-size write with restored mtime': async root => {
    const file = path.join(root, 'files/a'), before = await fs.stat(file);
    await fs.writeFile(file, 'wrong'); await fs.utimes(file, before.atime, before.mtime);
  },
  'restored original bytes': async root => {
    const file = path.join(root, 'files/a');
    await fs.writeFile(file, 'wrong'); await fs.writeFile(file, 'first');
  },
  'internal symlink replacement': async root => {
    const file = path.join(root, 'linked');
    await fs.unlink(file); await fs.symlink('files/b', file);
  },
  'external symlink replacement': async root => {
    const file = path.join(root, 'linked');
    await fs.unlink(file); await fs.symlink(os.tmpdir(), file);
  },
  'executable permission change': root => fs.chmod(path.join(root, 'files/a'), 0o700),
  'world-writable permission': root => fs.chmod(path.join(root, 'files/a'), 0o666),
  'directory permission': root => fs.chmod(path.join(root, 'files'), 0o777),
  'manifest rewrite': root => fs.appendFile(path.join(root, 'RUNTIME.json'), ' '),
};
for (const [name, change] of Object.entries(changes)) {
  it('invalidates the operation after ' + name, async () => {
    const { root } = await sealed(), proof = await inspectRuntimeArtifact(root);
    await change(root);
    await expect(proof.assertUnchanged()).rejects.toThrow(/Runtime/);
    await expect(proof.assertUnchanged()).rejects.toThrow('invalidated');
  });
}

it('checks real ownership at every reuse', async () => {
  const { root } = await sealed(), proof = await inspectRuntimeArtifact(root);
  vi.spyOn(process, 'getuid').mockReturnValue(process.getuid!() + 1);
  await expect(proof.assertUnchanged()).rejects.toThrow('belongs to another user');
});

it('pins physical root identity even when the replacement contains identical bytes', async () => {
  const { root } = await sealed(), proof = await inspectRuntimeArtifact(root);
  const original = root + '-original'; roots.push(original);
  await fs.rename(root, original); await fs.cp(original, root, { recursive: true, verbatimSymlinks: true });
  await expect(proof.assertUnchanged()).rejects.toThrow('changed after verification');
});

it('preserves the process-birth boundary and rejects a later rewrite', async () => {
  const { root, entry, sha256 } = await sealed(), birth = Date.now() + 10;
  const proof = await inspectRuntimeArtifact(root, sha256, birth);
  await proof.assertUnchanged();
  await new Promise(resolve => setTimeout(resolve, 15));
  await fs.writeFile(entry, 'first');
  await expect(proof.assertUnchanged()).rejects.toThrow('changed after process startup');
  await expect(verifyRuntimeArtifact(root, sha256, birth)).rejects.toThrow('changed after process startup');
});


it('rejects a change to an earlier file while hashing later entries', async () => {
  const { root, entry } = await sealed(), open = fs.open.bind(fs);
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (args[0] === path.join(root, 'files/b')) await fs.writeFile(entry, 'wrong');
    return handle;
  });
  // Concurrent reads can detect the mutation while reading, before the final snapshot check.
  await expect(inspectRuntimeArtifact(root)).rejects.toThrow(/Runtime entry changed (after|during|while)/);
});
