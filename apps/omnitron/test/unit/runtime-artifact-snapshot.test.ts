import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
  await expect(inspectRuntimeArtifact(root)).rejects.toThrow('changed after verification');
});
