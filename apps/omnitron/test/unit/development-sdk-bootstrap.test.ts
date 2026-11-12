import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { create } from 'tar';
import { sdkCommand, inspectSdk } from '../../bin/sdk.js';

const exec = promisify(execFile), require = createRequire(import.meta.url);
const turbo = path.join(path.dirname(require.resolve('turbo/package.json')), 'bin/turbo');
let root: string, consumer: string, source: string;
let packageManager: string;
let registry: Server | undefined;
const json = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const write = (file: string, value: unknown) => fs.writeFile(file, JSON.stringify(value));
const active = () => path.join(consumer, '.omnitron/dev-sdk/active.json');
const selected = () => path.join(consumer, '.omnitron/dev-sdk/install.json');
const exists = (file: string) => fs.stat(file).then(() => true, error => {
  if (error.code === 'ENOENT') return false;
  throw error;
});
const distribution = () => fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8').catch(error => {
  if (error.code === 'ENOENT') return null;
  throw error;
});

// Real pnpm/Turbo on tiny local workspaces. Registry cases use only a loopback
// fixture server; no public registry, daemon or live SDK is used or modified.
// The harness supplies the exact repository-pinned pnpm. Its version is checked
// before any fixture runs; pnpm must not resolve itself from a global cache.
beforeAll(async () => {
  packageManager = (await json(path.resolve(import.meta.dirname, '../../../../package.json'))).packageManager;
  expect(packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
  const { stdout } = await exec('pnpm', ['--version'], { cwd: os.tmpdir(), timeout: 10_000 });
  expect(stdout.trim()).toBe(packageManager.slice('pnpm@'.length));
});

async function workspace(directory: string) {
  await fs.mkdir(directory, { recursive: true });
  await exec('git', ['init', '--quiet', directory]);
  await write(path.join(directory, 'package.json'), {
    name: path.basename(directory), private: true, packageManager,
  });
  await fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'),
    // Standard externally managed tool mode: the prerequisite above owns the
    // strict version check. This mode does not generate a manager boot document.
    `packages:\n  - packages/*\noffline: true\npmOnFail: ignore\nverifyDepsBeforeRun: error\nstoreDir: ${path.join(root, 'store')}\ncacheDir: ${path.join(root, 'cache')}\n`);
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
  if (registry) {
    registry.closeAllConnections();
    await new Promise<void>(resolve => registry!.close(() => resolve()));
    registry = undefined;
  }
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});
const initialize = () => sdkCommand(['init', '--project-dir', consumer]);
const select = (checkout?: string) => sdkCommand(['dev', ...(checkout ? [checkout] : []), '--project-dir', consumer, '--no-watch']);

async function installRegistry(virtualStoreDir?: string, nodeLinker = 'isolated') {
  const packages = new Map<string, { manifest: Record<string, unknown>; bytes: Buffer; integrity: string }>();
  for (const name of ['lumen', 'lumen-ast']) {
    const directory = path.join(root, 'published-' + name), pkg = path.join(directory, 'package');
    await fs.mkdir(path.join(pkg, 'dist'), { recursive: true });
    const manifest = { name: '@omnitron-dev/' + name, version: '0.3.5', type: 'module', main: './dist/index.js',
      ...(name === 'lumen' ? { dependencies: { '@omnitron-dev/lumen-ast': '0.3.5' } } : {}) };
    await write(path.join(pkg, 'package.json'), manifest);
    await fs.writeFile(path.join(pkg, 'dist/index.js'), name === 'lumen' ? "export {value} from '@omnitron-dev/lumen-ast';\n" : 'export const value = 7;\n');
    const archive = path.join(directory, 'package.tgz');
    await create({ cwd: directory, file: archive, gzip: true, noMtime: true, portable: true }, ['package']);
    const bytes = await fs.readFile(archive);
    packages.set(manifest.name, { manifest, bytes, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') });
  }
  registry = createServer((request, response) => {
    const name = decodeURIComponent((request.url ?? '').split('/-/')[0]!.slice(1));
    const pkg = packages.get(name);
    if (!pkg) { response.writeHead(404).end(); return; }
    if (request.url!.includes('/-/')) { response.writeHead(200).end(pkg.bytes); return; }
    const url = 'http://127.0.0.1:' + (registry!.address() as { port: number }).port;
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      name, 'dist-tags': { latest: '0.3.5' }, time: { '0.3.5': '2026-01-01T00:00:00Z' },
      versions: { '0.3.5': { ...pkg.manifest, dist: { integrity: pkg.integrity, tarball: url + '/' + name + '/-/package.tgz' } } },
    }));
  });
  await new Promise<void>((resolve, reject) => registry!.once('error', reject).listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + (registry.address() as { port: number }).port + '/';
  const settings = path.join(consumer, 'pnpm-workspace.yaml');
  await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace('offline: true', 'offline: false') +
    'nodeLinker: ' + nodeLinker + '\nminimumReleaseAge: 0\n' +
    (virtualStoreDir ? 'virtualStoreDir: ' + JSON.stringify(virtualStoreDir) + '\n' : '') +
    'registries:\n  default: ' + JSON.stringify(url) + "\n  '@omnitron-dev': " + JSON.stringify(url) + '\n');
  await initialize();
  await exec('pnpm', ['install', '--ignore-scripts'], { cwd: consumer, timeout: 45_000 });
}

it.each([{ external: false, nodeLinker: 'isolated' }, { external: true, nodeLinker: 'isolated' },
  { external: false, nodeLinker: 'hoisted' }, { external: true, nodeLinker: 'hoisted' }])(
  'restores registry dependencies using the installed pnpm store (%j)', async ({ external, nodeLinker }) => {
  const store = external ? path.join(root, 'consumer-virtual-store') : path.join(consumer, 'node_modules/.pnpm');
  await installRegistry(external ? store : undefined, nodeLinker);
  const baseline = await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8');
  await select(source);
  expect((await exec('pnpm', ['run', 'build'], { cwd: consumer })).stdout).toContain('Built with SDK value 42');
  await sdkCommand(['registry', '--project-dir', consumer]);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'registry', verifiedImports: 1 });
  const installedRoot = nodeLinker === 'hoisted' ? path.join(consumer, 'node_modules') : store;
  expect(await fs.realpath(path.join(consumer, 'node_modules/@omnitron-dev/lumen'))).toMatch(new RegExp('^' + installedRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '/'));
  expect((await exec('pnpm', ['run', 'build'], { cwd: consumer })).stdout).toContain('Built with SDK value 7');
  expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(baseline);
}, 90_000);

it.each(['configured-store', 'receipt-store', 'symlink-store', 'installed-lock', 'outside-package'])(
  'refuses registry provenance drift without modifying installation: %s', async drift => {
    const store = path.join(root, 'consumer-virtual-store');
    await installRegistry(store);
    expect(await inspectSdk(consumer)).toMatchObject({ mode: 'registry' });
    const receiptFile = path.join(consumer, 'node_modules/.modules.yaml');
    const receipt = parseAllDocuments(await fs.readFile(receiptFile, 'utf8'))[0]!.toJS();
    const other = path.join(root, 'other');
    if (drift === 'configured-store') {
      await fs.mkdir(other);
      const settings = path.join(consumer, 'pnpm-workspace.yaml');
      await fs.writeFile(settings, (await fs.readFile(settings, 'utf8')).replace(JSON.stringify(store), JSON.stringify(other)));
    }
    if (drift === 'receipt-store') { receipt.virtualStoreDir = other; await write(receiptFile, receipt); }
    if (drift === 'symlink-store') { await fs.rename(store, other); await fs.symlink(other, store, 'dir'); }
    if (drift === 'installed-lock') {
      const file = path.join(store, 'lock.yaml');
      const lock = parseAllDocuments(await fs.readFile(file, 'utf8')).at(-1)!.toJS();
      lock.packages['@omnitron-dev/lumen@0.3.5'].resolution.integrity = 'sha512-' + Buffer.alloc(64, 3).toString('base64');
      await write(file, lock);
    }
    if (drift === 'outside-package') {
      const link = path.join(consumer, 'node_modules/@omnitron-dev/lumen');
      await fs.cp(await fs.realpath(link), other, { recursive: true });
      await fs.unlink(link);
      await fs.symlink(other, link, 'dir');
    }
    const rootLock = await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8');
    const before = await fs.readFile(receiptFile, 'utf8');
    await expect(inspectSdk(consumer)).rejects.toThrow(/receipt|physical directory|does not match the distribution lock/);
    expect(await fs.readFile(receiptFile, 'utf8')).toBe(before);
    expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(rootLock);
  }, 90_000
);

it('rebuilds the same SDK selection after source changes with unchanged package versions', async () => {
  await initialize();
  await select(source);
  const before = await fs.readFile(path.join(consumer, '.omnitron/dev-sdk/built.json'), 'utf8');
  const profile = await fs.readFile(active(), 'utf8');
  const script = path.join(source, 'packages/lumen-ast/build.js');
  await fs.writeFile(script, (await fs.readFile(script, 'utf8')).replace('value = 42', 'value = 99'));
  await select();
  expect(await fs.readFile(active(), 'utf8')).toBe(profile);
  expect(await fs.readFile(path.join(consumer, '.omnitron/dev-sdk/built.json'), 'utf8')).not.toBe(before);
  expect((await exec('pnpm', ['run', 'build'], { cwd: consumer })).stdout).toContain('Built with SDK value 99');
}, 90_000);

it('binds environment-resolved pnpm layout changes even when workspace text is unchanged', async () => {
  const first = path.join(root, 'first-store'), second = path.join(root, 'second-store');
  vi.stubEnv('SDK_TEST_VIRTUAL_STORE', first);
  await installRegistry('${SDK_TEST_VIRTUAL_STORE}');
  await select(source);
  const profile = await json(active());
  const workspace = await fs.readFile(path.join(consumer, 'pnpm-workspace.yaml'), 'utf8');
  vi.stubEnv('SDK_TEST_VIRTUAL_STORE', second);
  await select();
  expect((await json(active())).inputSha256).not.toBe(profile.inputSha256);
  expect(await fs.readFile(path.join(consumer, 'pnpm-workspace.yaml'), 'utf8')).toBe(workspace);
  await sdkCommand(['registry', '--project-dir', consumer]);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'registry' });
  const actual = await fs.realpath(path.join(consumer, 'node_modules/@omnitron-dev/lumen'));
  expect(path.relative(second, actual).startsWith('..')).toBe(false);
  expect((await exec('pnpm', ['run', 'build'], { cwd: consumer })).stdout).toContain('Built with SDK value 7');
}, 90_000);

it('retains the last successful build checkpoint when a repeated SDK build fails', async () => {
  await initialize();
  await select(source);
  const checkpoint = path.join(consumer, '.omnitron/dev-sdk/built.json');
  const before = await fs.readFile(checkpoint, 'utf8');
  const profile = await fs.readFile(active(), 'utf8');
  const rootLock = await distribution();
  const script = path.join(source, 'packages/lumen-ast/build.js');
  const original = await fs.readFile(script, 'utf8');
  await fs.writeFile(script, 'throw Error("Build was not completed");\n');
  await expect(select()).rejects.toThrow(/pnpm exec exited/);
  expect(await fs.readFile(checkpoint, 'utf8')).toBe(before);
  expect(await fs.readFile(active(), 'utf8')).toBe(profile);
  expect(await distribution()).toBe(rootLock);
  await fs.writeFile(script, original.replace('value = 42', 'value = 100'));
  await select();
  expect((await exec('pnpm', ['run', 'build'], { cwd: consumer })).stdout).toContain('Built with SDK value 100');
}, 90_000);

it.each([false, true])('bootstraps a standalone Lumen consumer with absent/stale distribution lock: %s', async stale => {
  const lock = '# The distribution predates the newly declared Lumen dependency.\nlockfileVersion: \'9.0\'\nimporters:\n  .: {}\n';
  if (stale) await fs.writeFile(path.join(consumer, 'pnpm-lock.yaml'), lock);
  await initialize();
  expect(await exists(path.join(consumer, 'node_modules'))).toBe(false);
  expect(await exists(path.join(consumer, 'pnpm-lock.yaml'))).toBe(stale);
  await select(source);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source, verifiedImports: 1,
    distributionLock: stale ? 'present' : 'absent', distributionLockChanged: false });
  const baseline = await distribution();
  expect(baseline).toBe(stale ? lock : null);
  const profile = await json(active());
  expect(Object.keys(profile.links).sort()).toEqual(['@omnitron-dev/lumen', '@omnitron-dev/lumen-ast']);
  expect(profile.versions).toEqual({ '@omnitron-dev/lumen': '0.3.5', '@omnitron-dev/lumen-ast': '0.3.5' });
  expect(await fs.realpath(path.join(consumer, 'node_modules/@omnitron-dev/lumen'))).toBe(path.join(source, 'packages/lumen'));
  expect((await exec(process.execPath, ['--input-type=module', '-e', "import {value} from '@omnitron-dev/lumen'; console.log(value)"], { cwd: consumer })).stdout.trim()).toBe('42');
  expect(await exists(path.join(consumer, '.omnitron/dev-sdk/pnpm-lock.yaml'))).toBe(true);
  const built = await exec('pnpm', ['run', 'build'], { cwd: consumer });
  expect(built.stdout).toContain('Built with SDK value 42');
  expect(await distribution()).toBe(baseline);
  const before = await fs.readFile(selected(), 'utf8');
  await expect(sdkCommand(['registry', '--project-dir', consumer])).rejects.toThrow(stale ? /stale/ : /No distribution lock/);
  expect(await fs.readFile(selected(), 'utf8')).toBe(before);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development' });
}, 90_000);

it('preserves an existing manager-only lock without treating it as a registry baseline', async () => {
  // An existing input state, taken from the repository's genuine pnpm lock.
  // This does not claim that the externally managed fixture generates it.
  const repositoryLock = await fs.readFile(path.resolve(import.meta.dirname, '../../../../pnpm-lock.yaml'), 'utf8');
  const boot = parseAllDocuments(repositoryLock)[0]!;
  expect(boot.toJS().importers['.'].packageManagerDependencies.pnpm.version).toBe(packageManager.slice('pnpm@'.length));
  const original = boot.toString() + '---\n';
  await fs.writeFile(path.join(consumer, 'pnpm-lock.yaml'), original);
  await initialize();
  await select(source);
  expect(await distribution()).toBe(original);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source, verifiedImports: 1,
    distributionLock: 'manager-only', distributionLockChanged: false });
  const profile = await fs.readFile(selected(), 'utf8');
  await expect(sdkCommand(['registry', '--project-dir', consumer])).rejects.toThrow('package-manager metadata only');
  expect(await fs.readFile(selected(), 'utf8')).toBe(profile);
  expect(await fs.readFile(active(), 'utf8')).toBe(profile);
  expect(await distribution()).toBe(original);
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source });
  expect((await exec('pnpm', ['run', 'build'], { cwd: consumer })).stdout).toContain('Built with SDK value 42');
  expect(await distribution()).toBe(original);
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
  expect(await inspectSdk(consumer)).toMatchObject({ mode: 'development', source, distributionLock: stale ? 'present' : 'absent' });
}, 90_000);

it('restores the accepted SDK after a failed switch without needing registry packages', async () => {
  await initialize();
  await select(source);
  const previous = await fs.readFile(active(), 'utf8');
  const previousRootLock = await distribution();
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
  expect(await distribution()).toBe(previousRootLock);
}, 90_000);

it('preserves a concurrent root lock edit instead of hiding it during failed bootstrap recovery', async () => {
  await initialize();
  const manifest = await json(path.join(consumer, 'package.json'));
  manifest.scripts = { preinstall: 'node concurrent.js' };
  await write(path.join(consumer, 'package.json'), manifest);
  const concurrent = '# changed by another writer while pnpm was installing\nlockfileVersion: \'9.0\'\nimporters:\n  .: {}\n';
  await fs.writeFile(path.join(consumer, 'concurrent.js'),
    `require('node:fs').writeFileSync('pnpm-lock.yaml', ${JSON.stringify(concurrent)}); process.exit(23);\n`);
  await expect(select(source)).rejects.toThrow(
    'pnpm install exited with 1. No verified registry baseline is available; the SDK installation is incomplete. Run sdk dev again to finish it.'
  );
  expect(await fs.readFile(path.join(consumer, 'pnpm-lock.yaml'), 'utf8')).toBe(concurrent);
  expect(await exists(active())).toBe(false);
  expect(await exists(path.join(consumer, '.omnitron/dev-sdk/built.json'))).toBe(false);
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
