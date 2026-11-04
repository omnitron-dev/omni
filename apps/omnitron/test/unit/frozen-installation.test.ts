import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { create } from 'tar';
import { assertFrozenDirectory, extractFrozenArchive, verifyFrozenApplication } from '../../src/release/frozen-installation.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import { targetRuntime } from '../../src/release/target-runtime.js';

const roots: string[] = [];
const temp = async () => { const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frozen-install-'))); roots.push(dir); return dir; };
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

describe('one bounded extractor for local and remote frozen installations', () => {
  it.each(['.omnitron-release.json', '.artifact-sha256', 'candidate.tar.gz'])('refuses injected %s before any extraction', async name => {
    const source = await temp(), destination = await temp();
    await fs.writeFile(path.join(source, name), 'injected'); await fs.writeFile(path.join(source, 'normal.js'), 'export default 1;');
    const archive = path.join(destination, 'candidate.tar.gz');
    await create({ gzip: true, cwd: source, file: archive }, ['normal.js', name]);
    const before = await fs.readFile(archive);
    await expect(extractFrozenArchive(archive, destination)).rejects.toThrow('Invalid release archive member');
    expect(await fs.readdir(destination)).toEqual(['candidate.tar.gz']);
    expect(await fs.readFile(archive)).toEqual(before);
  });
  it('rejects an escaping symlink before writing even earlier valid members', async () => {
    const source = await temp(), destination = await temp();
    await fs.writeFile(path.join(source, 'normal.js'), 'export default 1;');
    await fs.symlink('../outside', path.join(source, 'escape'));
    const archive = path.join(destination, 'candidate.tar.gz');
    await create({ gzip: true, cwd: source, file: archive }, ['normal.js', 'escape']);
    await expect(extractFrozenArchive(archive, destination)).rejects.toThrow('link leaves its root');
    expect(await fs.readdir(destination)).toEqual(['candidate.tar.gz']);
  });
  it('refuses writes through an archive parent that was not declared as a directory', async () => {
    const source = await temp(), destination = await temp();
    await fs.mkdir(path.join(source, 'nested')); await fs.writeFile(path.join(source, 'nested/main.js'), 'export default 1;');
    const archive = path.join(destination, 'candidate.tar.gz');
    await create({ gzip: true, cwd: source, file: archive }, ['nested/main.js']);
    await expect(extractFrozenArchive(archive, destination)).rejects.toThrow('Invalid release archive parent');
    expect(await fs.readdir(destination)).toEqual(['candidate.tar.gz']);
  });
  it('refuses an aliased or public destination', async () => {
    const root = await temp(), parent = await temp(); await fs.symlink(root, path.join(parent, 'alias'));
    await expect(assertFrozenDirectory(path.join(parent, 'alias'))).rejects.toThrow('private physical directory');
    await fs.chmod(root, 0o755); await expect(assertFrozenDirectory(root)).rejects.toThrow('private physical directory');
  });
  it('keeps the admitted closure and all private dependency bytes in the verification boundary', async () => {
    const root = await temp(); await fs.writeFile(path.join(root, 'main.js'), 'export default 1;');
    await fs.mkdir(path.join(root, 'node_modules/pkg'), { recursive: true });
    await fs.writeFile(path.join(root, 'node_modules/pkg/LICENSE'), 'package content');
    const runtime = await targetRuntime();
    const closure = JSON.stringify({ protocol: 1, runtime, nodeOptions: '', payloadSha256: await releaseTreeDigest(root, true, false, ['.omnitron-closure.json']) });
    await fs.writeFile(path.join(root, '.omnitron-closure.json'), closure, { mode: 0o600 });
    const launch = { mode: 'script' as const, file: 'main.js', closureSha256: createHash('sha256').update(closure).digest('hex') };
    expect(await verifyFrozenApplication(root, launch, runtime, '')).toBe(path.join(root, 'main.js'));
    await fs.writeFile(path.join(root, 'node_modules/pkg/LICENSE'), 'changed content');
    await expect(verifyFrozenApplication(root, launch, runtime, '')).rejects.toThrow('files differ from the admitted payload');
    await fs.writeFile(path.join(root, 'node_modules/pkg/LICENSE'), 'package content');
    await fs.appendFile(path.join(root, '.omnitron-closure.json'), ' ');
    await expect(verifyFrozenApplication(root, launch, runtime, '')).rejects.toThrow('closure differs from the admitted manifest');
  });
});
