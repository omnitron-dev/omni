import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { expect, it } from 'vitest';
import { releaseArtifactOrigins } from '../../src/release/origin.js';
import { targetRuntime } from '../../src/release/target-runtime.js';

const run = promisify(execFile);
const sha256 = (input: string) => createHash('sha256').update(input).digest('hex');

it('executes the generated read-only command using the installed Node and ordinary SDK metadata readers', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'installed-archive-command-')));
  try {
    const control = path.join(root, 'control'), dist = path.join(control, 'dist/release');
    const files = ['canonical-archive', 'load', 'store', 'origin', 'owner-executable'];
    await build({ entryPoints: files.map(name => path.resolve(import.meta.dirname, '../../src/release', name + '.ts')),
      outdir: dist, format: 'esm', platform: 'node', target: 'node22', bundle: true });
    await fs.writeFile(path.join(control, 'package.json'), '{"type":"module"}');
    const store = path.join(root, 'store'), archives = path.join(store, 'fixture', 'artifacts');
    await fs.mkdir(archives, { recursive: true, mode: 0o700 });
    const artifact = { app: 'worker', version: '1', bytes: 7, sha256: sha256('archive'),
      launch: { mode: 'script' as const, file: 'main.js', closureSha256: 'a'.repeat(64) } };
    const target = await targetRuntime(), commit = 'c'.repeat(40);
    const manifest = { id: 'fixture', project: { repo: 'source', commit }, omni: { repo: 'framework', commit },
      builtWith: { omnitron: '1', packages: [], target }, builtBy: 'fixture', builtAt: '2026-01-01T00:00:00Z',
      gates: [{ name: 'test', status: 'passed' as const }], artifacts: [artifact] };
    const raw = JSON.stringify(manifest, null, 2), file = path.join(archives, 'worker-1.tar.gz');
    await fs.writeFile(path.join(store, 'fixture', 'manifest.json'), raw);
    await fs.writeFile(file, 'archive');
    const [mapped] = releaseArtifactOrigins(manifest, sha256(raw));
    const checked = { ...artifact, release: mapped!.origin, size: artifact.bytes, tarballSha256: artifact.sha256 };
    const owner = { root: control, executable: await fs.realpath(process.execPath), commit, target,
      execution: { mode: 'resident', protocol: 1, ownerId: 'fixture', epoch: 1, pid: process.pid } };
    const generator = pathToFileURL(path.join(dist, 'canonical-archive.js')).href;
    const makeCommand = (binding: typeof owner) => run(owner.executable, ['--input-type=module', '-e',
      `import {checkCanonicalArchivesCommand} from ${JSON.stringify(generator)};
       process.stdout.write(checkCanonicalArchivesCommand(...JSON.parse(process.argv[1])));`, JSON.stringify([[checked], binding, control])]);
    const generated = await makeCommand(owner);
    expect(generated.stdout).not.toContain('await fs.link(');
    const env = { HOME: root, PATH: '/usr/bin:/bin', OMNITRON_RELEASES_DIR: store };
    const status = JSON.parse((await run('/bin/sh', ['-c', generated.stdout], { env })).stdout);
    expect(status).toEqual({ state: 'present', files: [{ app: 'worker', file, bytes: 7, sha256: artifact.sha256 }] });
    const differentOwnerImage = await makeCommand({ ...owner, target: { ...target, executableSha256: 'b'.repeat(64) } });
    await expect(run('/bin/sh', ['-c', differentOwnerImage.stdout], { env })).rejects.toMatchObject({
      stderr: expect.stringContaining('not running the Node executable selected'),
    });
    expect(await fs.readdir(archives)).toEqual(['worker-1.tar.gz']);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
