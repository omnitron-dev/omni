import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { sdkCommand, inspectSdk } from '../../bin/sdk.js';

const exec = promisify(execFile), require = createRequire(import.meta.url);
const turbo = path.join(path.dirname(require.resolve('turbo/package.json')), 'bin/turbo');
let root: string, consumer: string, source: string;
const json = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const write = (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value));
const active = () => path.join(consumer, '.omnitron/dev-sdk/active.json');
const selected = () => path.join(consumer, '.omnitron/dev-sdk/install.json');
const exists = (file: string) => fs.stat(file).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

// Real pnpm/Turbo on tiny local workspaces. No registry, daemon or live SDK
// dependencies are used or modified by these tests.
async function workspace(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  await exec('git', ['init', '--quiet', directory]);
  await write(path.join(directory, 'package.json'), {
    name: path.basename(directory), private: true, packageManager: 'pnpm@12.16.1',
  });
  await fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'),
    `packages:\n  - packages/*\noffline: true\nverifyDepsBeforeRun: error\nstoreDir: ${path.join(root, 'store')}\n`);
  await fs.writeFile(path.join(directory, '.gitignore'), 'node_modules/\n.omnitron/\n.turbo/\n');
}
async function sdk(directory: string) {
  await workspace(directory);
  await write(path.join(directory, 'turbo.json'), { tasks: { build: { dependsOn: ['^build'], outputs: ['dist/**'] } } });
  for (const name of ['lumen', 'lumen-ast', 'titan']) {
    const pkg = path.join(directory, 'packages', name);
    await fs.mkdir(path.join(pkg, 'src'), { recursive: true });
    await write(path.join(pkg, 'package.json'), {
      name: '@omnitron-dev/' + name, version: '0.3.5', type: 'module', main: './dist/index.js',
      scripts: { build: 'node build.js' },
      ...(name === 'lumen' ? { dependencies: { '@omnitron-dev/lumen-ast': 'workspace:*' },
        peerDependencies: { '@omnitron-dev/titan': 'workspace:*' },
        peerDependenciesMeta: { '@omnitron-dev/titan': { optional: true } } } : {}),
    });
    const output = name === 'lumen' ? "export { value } from '@omnitron-dev/lumen-ast';\n" : 'export const value = 42;\n';
    await fs.writeFile(path.join(pkg, 'build.js'),
      `import fs from 'node:fs/promises'; await fs.mkdir('dist', {recursive:true}); await fs.writeFile('dist/index.js', ${JSON.stringify(output)});\n`);
  }
  await exec('pnpm', ['install', '--offline', '--ignore-scripts'], { cwd: directory });
  await fs.mkdir(path.join(directory, 'node_modules/.bin'), { recursive: true });
  await fs.symlink(turbo, path.join(directory, 'node_modules/.bin/turbo'));
}
beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-bootstrap-')));
  consumer = path.join(root, 'consumer');
  source = path.join(root, 'source');
  vi.stubEnv('OMNITRON_HOME', path.join(root, 'no-daemon'));
  await workspace(consumer);
  const manifest = await json(path.join(consumer, 'package.json'));
  manifest.dependencies = { '@omnitron-dev/lumen': '0.3.5' };
  manifest.scripts = { build: 'node build.js' };
  await write(path.join(consumer, 'package.json'), manifest);
  await fs.writeFile(path.join(consumer, 'build.js'), "import('@omnitron-dev/lumen').then(({value}) => console.log('Built with SDK value ' + value));\n");
  await sdk(source);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
const initialize = () => sdkCommand(['init', '--project-dir', consumer]);
const select = (checkout?: string) => sdkCommand(['dev', ...(checkout ? [checkout] : []), '--project-dir', consumer, '--no-watch']);

it.each([false, true])('bootstraps a standalone Lumen consumer with absent/stale distribution lock: %s', async stale => {
  const lock = '# The distribution predates the newly declared Lumen dependency.\nlockfileVersion: \'9.0\'\nimporters:\n  .: {}\n';
  if (stale) await fs.writeFile(path.join(consumer, 'pnpm-lock.yaml'), lock);
  await initialize();
  expect(await exists(path.join(consumer, 'node_modules'))).toBe(false);
  expect(await exists(path.join(consumer, 'pnpm-lock.yaml'))).toBe(stale);
  await select(source);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source, verifiedImports: 1,
    distributionLock: stale ? 'present' : 'manager-only', distributionLockChanged: false });
  const baseline = await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8');
  expect(parseAllDocuments(baseline).at(-1)!.toJS()).toEqual(stale ? parseAllDocuments(lock).at(-1)!.toJS() : null);
  expect(parseAllDocuments(baseline)[0]!.toJS().importers['.'].packageManagerDependencies.pnpm.version).toBe('12.16.1');
  if (stale) expect(baseline).toContain(lock);
  const profile = await json(active());
  expect(Object.keys(profile.links).sort()).toEqual(['@omnitron-dev/lumen', '@omnitron-dev/lumen-ast']);
  expect(profile.versions).toEqual({ '@omnitron-dev/lumen': '0.3.5', '@omnitron-dev/lumen-ast': '0.3.5' });
  expect(await fs.realpath(path.join(consumer, 'node_modules/@omnitron-dev/lumen'))).toBe(path.join(source, 'packages/lumen'));
  expect((await exec(process.execPath, ['--input-type=module', '-e', "import {value} from '@omnitron-dev/lumen'; console.log(value)"], { cwd: consumer })).stdout.trim()).toBe('42');
  expect(await exists(path.join(consumer, '.omnitron/dev-sdk/pnpm-lock.yaml'))).toBe(true);
  const built = await exec('pnpm', ['run', 'build'], { cwd: consumer });
  expect(built.stdout).toContain('Built with SDK value 42');
  expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(baseline);
  const before = await fs.readFile(selected(), 'utf8');
  await expect(sdkCommand(['registry', '--project-dir', consumer])).rejects.toThrow(stale ? /stale/ : /package-manager metadata only/);
  expect(await fs.readFile(selected(), 'utf8')).toBe(before);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development' });
}, 90_000);

it.each([false, true])('restores the original root lock after failed bootstrap and resumes without a fake registry rollback: %s', async stale => {
  const original = '# restore these exact bytes\nlockfileVersion: \'9.0\'\nimporters:\n  .: {}\n';
  if (stale) await fs.writeFile(path.join(consumer, 'pnpm-lock.yaml'), original);
  await initialize();
  const file = path.join(consumer, 'package.json'), manifest = await json(file);
  manifest.scripts = { preinstall: 'node -e "process.exit(23)"' };
  await write(file, manifest);
  await expect(select(source)).rejects.toThrow('No verified registry baseline');
  expect((await json(selected())).installing).toBe(true);
  expect(await exists(active())).toBe(false);
  if (stale) expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(original);
  else expect(await exists(path.join(consumer, 'pnpm-lock.yaml'))).toBe(false);
  await expect(inspectSdk(consumer)).rejects.toThrow('interrupted');
  delete manifest.scripts;
  await write(file, manifest);
  await select();
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source, distributionLock: stale ? 'present' : 'manager-only' });
}, 90_000);

it('restores the accepted SDK after a failed switch without needing registry packages', async () => {
  await initialize();
  await select(source);
  const previous = await fs.readFile(active(), 'utf8');
  const previousRootLock = await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8');
  const alternative = path.join(root, 'alternative');
  await sdk(alternative);
  const manifest = await json(path.join(consumer, 'package.json'));
  manifest.scripts = { preinstall: 'node install.js' };
  await write(path.join(consumer, 'package.json'), manifest);
  await fs.writeFile(path.join(consumer, 'install.js'),
    "const fs = require('node:fs'); if (!fs.existsSync('failed-once')) { fs.writeFileSync('failed-once', ''); process.exit(23); }\n");
  await expect(select(alternative)).rejects.toThrow('pnpm install exited');
  expect(await fs.readFile(active(), 'utf8')).toBe(previous);
  expect(await fs.readFile(selected(), 'utf8')).toBe(previous);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source });
  expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(previousRootLock);
}, 90_000);

it('preserves a concurrent root lock edit instead of hiding it during failed bootstrap recovery', async () => {
  await initialize();
  const manifest = await json(path.join(consumer, 'package.json'));
  manifest.scripts = { preinstall: 'node concurrent.js' };
  await write(path.join(consumer, 'package.json'), manifest);
  const concurrent = '# changed by another writer while pnpm was installing\nlockfileVersion: \'9.0\'\nimporters:\n  .: {}\n';
  await fs.writeFile(path.join(consumer, 'concurrent.js'),
    `require('node:fs').writeFileSync('pnpm-lock.yaml', ${JSON.stringify(concurrent)}); process.exit(23);\n`);
  await expect(select(source)).rejects.toThrow('a changed distribution lock was preserved');
  expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(concurrent);
  expect(await exists(active())).toBe(false);
  expect((await json(selected())).installing).toBe(true);
  await expect(inspectSdk(consumer)).rejects.toThrow('interrupted');
}, 90_000);

it.each(['private', 'version', 'missing', 'escape'])('refuses an invalid SDK package before installing the consumer: %s', async invalid => {
  await initialize();
  const file = path.join(source, 'packages/lumen/package.json'), manifest = await json(file);
  if (invalid === 'private') manifest.private = true;
  if (invalid === 'version') manifest.version = 'unversioned';
  if (invalid === 'missing') manifest.dependencies['@omnitron-dev/missing'] = 'workspace:*';
  await write(file, manifest);
  if (invalid === 'escape') {
    await fs.rename(path.dirname(file), path.join(root, 'outside'));
    await fs.symlink(path.join(root, 'outside'), path.dirname(file));
  }
  await expect(select(source)).rejects.toThrow(invalid === 'missing' ? /does not provide/ :
    invalid === 'escape' ? /outside the selected checkout/ : /Invalid Omnitron SDK package identity/);
  expect(await exists(path.join(consumer, 'node_modules'))).toBe(false);
  expect(await exists(selected())).toBe(false);
});

it('rejects a transitive framework import resolving outside the selected SDK', async () => {
  await initialize();
  await select(source);
  const link = path.join(source, 'packages/lumen/node_modules/@omnitron-dev/lumen-ast');
  await fs.unlink(link);
  const other = path.join(root, 'other');
  await fs.mkdir(other);
  await fs.symlink(other, link);
  await expect(inspectSdk(consumer)).rejects.toThrow(/lumen resolves.*lumen-ast/);
});

it('refuses an external consumer dependency directory before package-manager bootstrap or installation', async () => {
  await initialize();
  const external = path.join(root, 'shared-dependencies');
  await fs.mkdir(external);
  await fs.writeFile(path.join(external, 'preserve'), 'existing shared SDK');
  await fs.symlink(external, path.join(consumer, 'node_modules'));
  await expect(select(source)).rejects.toThrow('requires project-owned node_modules');
  expect(await fs.readFile(path.join(external, 'preserve'), 'utf8')).toBe('existing shared SDK');
  expect(await exists(path.join(consumer, 'pnpm-lock.yaml'))).toBe(false);
  expect(await exists(selected())).toBe(false);
});
