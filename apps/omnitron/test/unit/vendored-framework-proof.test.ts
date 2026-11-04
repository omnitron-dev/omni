import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { normalizePackedWorkspace } from '../../src/release/portable-archive.js';
import { reproduceVendoredFramework, requireFrameworkCommit, vendoredFrameworkSource, verifyCommittedArchive } from '../../src/release/vendored-framework.js';

const exec = promisify(execFile);
const name = '@omnitron-dev/omnitron', version = '1.0.0', file = 'vendor/omni.tgz';
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-vendored-proof-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

const command = async (cwd: string, tool: string, ...args: string[]) =>
  (await exec(tool, args, { cwd })).stdout.trim();
async function commit(dir: string) {
  await command(dir, 'git', 'add', '.');
  await command(dir, 'git', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture');
  return command(dir, 'git', 'rev-parse', 'HEAD');
}

it('reads a regular Git blob under the registered directory and rejects symlinks and dirty replacements', async () => {
  const dir = path.join(root, 'project'), sub = path.join(dir, 'portal');
  await fs.mkdir(path.join(sub, 'vendor'), { recursive: true });
  await command(dir, 'git', 'init', '-q', '-b', 'main');
  const bytes = Buffer.from('committed archive');
  const pin = { name, version, file, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') };
  await fs.writeFile(path.join(sub, file), bytes);
  await fs.symlink('omni.tgz', path.join(sub, 'vendor/link.tgz'));
  const sha = await commit(dir);
  await fs.writeFile(path.join(sub, file), 'dirty replacement');
  await verifyCommittedArchive(sub, sha, pin);
  await expect(verifyCommittedArchive(sub, sha, { ...pin, file: 'vendor/link.tgz' })).rejects.toThrow(/committed regular file/);
  await expect(verifyCommittedArchive(sub, sha, { ...pin, integrity: 'wrong' })).rejects.toThrow(/lockfile SHA-512/);
  expect(() => requireFrameworkCommit('main')).toThrow(/full upstream Git commit/);
});

// Git checkout, the source's multi-step build, pnpm pack, canonicalization and
// Git blob/SRI verification are real; only dependency installation is unnecessary.
it('refuses a forged archive and matching consumer lock even when its clean build stamp names the upstream commit', async () => {
  const upstream = path.join(root, 'origin'), pkg = path.join(upstream, 'apps/omnitron');
  await fs.mkdir(pkg, { recursive: true });
  await command(upstream, 'git', 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(upstream, '.gitignore'), 'dist/\n');
  await fs.writeFile(path.join(upstream, 'pnpm-workspace.yaml'), "packages: ['apps/*']\n");
  await fs.writeFile(path.join(upstream, 'package.json'), JSON.stringify({ name: 'fixture', private: true,
    scripts: { build: 'node compile.cjs && node declarations.cjs' } }));
  await fs.writeFile(path.join(upstream, 'compile.cjs'), `
    const fs = require('node:fs'), cp = require('node:child_process');
    const base = 'apps/omnitron/';
    fs.mkdirSync(base + 'dist', { recursive: true });
    fs.copyFileSync(base + 'code.txt', base + 'dist/index.js');
    const commit = cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    fs.writeFileSync(base + 'dist/BUILD.json', JSON.stringify({ commit, dirty: false, builtAt: '2026-01-01T00:00:00Z', timeBasis: 'source' }));
  `);
  await fs.writeFile(path.join(upstream, 'declarations.cjs'), `
    require('node:fs').writeFileSync('apps/omnitron/dist/index.d.ts', 'declare const value: 1; export default value;');
  `);
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({ name, version, files: ['dist'], repository: { type: 'git', url: upstream } }));
  await fs.writeFile(path.join(pkg, 'code.txt'), 'export default 1;\n');
  const sha = await commit(upstream);
  const tree = await command(upstream, 'git', 'rev-parse', 'HEAD^{tree}');
  await command(upstream, 'pnpm', 'run', 'build');
  const project = path.join(root, 'project'), archive = path.join(project, file);
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await command(project, 'git', 'init', '-q', '-b', 'main');
  const run = async (tool: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => {
    if (tool === 'pnpm' && args[0] === 'run') {
      expect(args).toEqual(['run', 'build']);
      expect(env).toMatchObject({ TURBO_FORCE: 'true', TURBO_CONCURRENCY: '3' });
    }
    if (tool !== 'pnpm' || args[0] !== 'install') await command(cwd, tool, ...args);
  };
  const check = async (stage: string) => {
    await command(pkg, 'pnpm', 'pack', '--out', archive);
    await normalizePackedWorkspace(archive);
    const integrity = 'sha512-' + createHash('sha512').update(await fs.readFile(archive)).digest('base64');
    const pin = { name, version, file, integrity };
    const projectCommit = await commit(project);
    const frameworkSource = await vendoredFrameworkSource([pin], { projectDir: project, projectCommit, frameworkCommit: sha });
    expect(frameworkSource).toEqual({ repository: upstream });
    return reproduceVendoredFramework([pin], { projectDir: project, projectCommit, frameworkCommit: sha,
      frameworkSource: { ...frameworkSource, ref: 'refs/heads/main' }, sourceBase: project,
      scratch: path.join(root, stage), run, env: {} });
  };
  const result = await check('clean');
  expect(result.source).toMatchObject({ repo: upstream, ref: 'refs/heads/main', commit: sha, onRemote: false,
    reproduced: { tree, packages: [{ file, name, version }] } });
  expect(result.source.registry).toBeUndefined();
  // The package remains otherwise identical and the clean BUILD.json is preserved.
  await fs.writeFile(path.join(pkg, 'dist/index.js'), 'export default 2;\n');
  await expect(check('forged')).rejects.toThrow(/archive differs from the committed SHA-512/);
}, 60_000);
