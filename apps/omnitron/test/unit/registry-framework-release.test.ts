import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'tar';
import { npmTarball, readFrameworkLayout } from '../../src/release/layout.js';
import { resolveRegistryFramework } from '../../src/release/registry-framework.js';

const exec = promisify(execFile);
const core = '@omnitron-dev/omnitron', titan = '@omnitron-dev/titan', version = '0.3.2';
const commit = 'ab'.repeat(20);
let root: string;
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'registry-release-')); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(root, { recursive: true, force: true }); });

async function packed(name: string, gitHead: string | null = commit, dirty = false) {
  const cwd = await fs.mkdtemp(path.join(root, 'archive-')), dir = path.join(cwd, 'package');
  await fs.mkdir(path.join(dir, 'dist'), { recursive: true });
  const metadata = { name, version, ...(gitHead && { gitHead }), main: 'dist/index.js' };
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify(metadata));
  await fs.writeFile(path.join(dir, 'dist/index.js'), 'exports.identity = 1;\n');
  if (name === core) await fs.writeFile(path.join(dir, 'dist/BUILD.json'), JSON.stringify({ commit, dirty, builtAt: '2026-01-01T00:00:00.000Z', timeBasis: 'source' }));
  const file = path.join(cwd, 'package.tgz');
  await create({ cwd, file, gzip: true, noMtime: true, portable: true }, ['package']);
  const bytes = await fs.readFile(file);
  return { dir, bytes, metadata, pin: { name, version, integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') } };
}

function serveArchives(archives: Awaited<ReturnType<typeof packed>>[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async url => {
    if (String(url).startsWith('https://api.github.com/')) return Response.json({ base_commit: { sha: commit }, status: 'ahead' });
    const found = archives.find(({ pin }) => String(url) === npmTarball(pin.name, pin.version));
    if (!found) throw Error('Unexpected network request: ' + url);
    return new Response(Uint8Array.from(found.bytes));
  });
}

describe('verified npm framework inputs', () => {
  it('refuses legacy archives, divergent sources, dirty builds and modified tarballs', async () => {
    const clean = await packed(core);
    const legacy = await packed(core, null);
    const other = await packed(titan, 'cd'.repeat(20));
    const dirty = await packed(core, commit, true);
    for (const [archives, failure] of [
      [[legacy], /packed gitHead/], [[clean, other], /different commits/], [[dirty], /clean release commit/],
    ] as const) {
      serveArchives([...archives]);
      await expect(resolveRegistryFramework(archives.map(pkg => pkg.pin))).rejects.toThrow(failure);
    }
    serveArchives([clean]);
    await expect(resolveRegistryFramework([legacy.pin])).rejects.toThrow(/SHA-512/);
    await expect(resolveRegistryFramework([clean.pin], 'HEAD')).rejects.toThrow(/full registry source commit/);
  });

  it('compares installed bytes, executable semantics, missing and extra entries', async () => {
    const archive = await packed(core);
    serveArchives([archive]);
    const result = await resolveRegistryFramework([archive.pin]);
    expect(result.source).toMatchObject({ commit, onRemote: true, registry: { packages: [archive.pin] } });
    await result.verifyPackage(core, archive.dir);
    const file = path.join(archive.dir, 'dist/index.js');
    if (process.platform !== 'win32') {
      await fs.chmod(file, 0o755);
      await expect(result.verifyPackage(core, archive.dir)).rejects.toThrow(/differs/);
      await fs.chmod(file, 0o644);
    }
    await fs.writeFile(path.join(archive.dir, 'extra'), 'x');
    await expect(result.verifyPackage(core, archive.dir)).rejects.toThrow(/differs/);
    await fs.unlink(path.join(archive.dir, 'extra'));
    await fs.writeFile(file, 'exports.identity = 2;\n');
    await expect(result.verifyPackage(core, archive.dir)).rejects.toThrow(/differs/);
    await fs.unlink(file);
    await expect(result.verifyPackage(core, archive.dir)).rejects.toThrow(/missing/);
  });

  it('rejects a patched framework package and a checkout mixed with published dependencies', async () => {
    const { pin } = await packed(core);
    const lock = "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@omnitron-dev/titan':\n        version: link:../omni/packages/titan\npackages:\n  '" + core + '@' + version + "':\n    resolution: {integrity: " + pin.integrity + '}\n';
    expect(() => readFrameworkLayout(lock)).toThrow(/combine local/);
    expect(() => readFrameworkLayout(lock + "patchedDependencies:\n  '@omnitron-dev/omnitron@0.3.2': { hash: x }")).toThrow(/patches/);
  });
});

it.each(['', 'projects/consumer'])('builds and verifies a registry release from Git subdirectory "%s"', async (subdirectory) => {
  const archives = [await packed(core), await packed(titan)];
  const server = createServer((req, res) => {
    const pathname = decodeURIComponent(req.url ?? '').slice(1);
    const pkg = archives.find(p => pathname === p.pin.name || pathname === new URL(npmTarball(p.pin.name, version)).pathname.slice(1));
    if (!pkg) { res.writeHead(404).end(); return; }
    if (pathname.includes('/-/')) { res.writeHead(200, { 'Content-Type': 'application/octet-stream' }).end(pkg.bytes); return; }
    const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      name: pkg.pin.name, 'dist-tags': { latest: version }, time: { [version]: '2026-01-01T00:00:00Z' },
      versions: { [version]: { ...pkg.metadata, dist: { integrity: pkg.pin.integrity, tarball: url + new URL(npmTarball(pkg.pin.name, version)).pathname } } },
    }));
  });
  await new Promise<void>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  try {
    const repository = path.join(root, 'repository');
    const project = path.join(repository, subdirectory), app = path.join(project, 'apps/worker');
    const home = path.join(root, 'instance');
    vi.stubEnv('OMNITRON_HOME', home);
    vi.stubEnv('XDG_CACHE_HOME', path.join(root, 'cache'));
    await fs.mkdir(app, { recursive: true });
    await fs.mkdir(path.join(project, 'scripts'));
    const url = 'http://127.0.0.1:' + (server.address() as { port: number }).port + '/';
    const network = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const request = new URL(String(input));
      if (request.origin === 'https://api.github.com') return Promise.resolve(Response.json({ base_commit: { sha: commit }, status: 'identical' }));
      if (request.origin !== 'https://registry.npmjs.org') throw Error('Unexpected network origin');
      return network(new URL(request.pathname, url), init);
    });
    await fs.writeFile(path.join(project, 'package.json'), JSON.stringify({ name: 'consumer', private: true, dependencies: { [core]: version } }));
    await fs.writeFile(path.join(project, 'pnpm-workspace.yaml'), "packages: ['apps/*']\nminimumReleaseAge: 0\npackageImportMethod: copy\nverifyDepsBeforeRun: false\nstoreDir: " + JSON.stringify(path.join(root, 'store')) + "\nregistries:\n  default: " + JSON.stringify(url) + "\n  '@omnitron-dev': " + JSON.stringify(url) + '\n');
    await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'worker', version: '1.0.0', dependencies: { [titan]: version }, scripts: { build: 'node build.mjs' } }));
    await fs.writeFile(path.join(app, 'build.mjs'), "import fs from 'node:fs'; fs.mkdirSync('dist',{recursive:true}); fs.writeFileSync('dist/main.js', 'console.log(1)'); if (process.env.TAMPER_FRAMEWORK === '1') { fs.writeFileSync('node_modules/@omnitron-dev/titan/dist/index.js', 'exports.identity = 2;\\n'); fs.writeFileSync('node_modules/@omnitron-dev/titan/package.json',JSON.stringify({name:'replacement',version:'0.3.2'})); }");
    await fs.writeFile(path.join(project, 'omnitron.config.mjs'), "export default { apps: [{name:'worker',cwd:'apps/worker',script:'dist/main.js'}] };");
    await fs.writeFile(path.join(project, 'scripts/gates.mjs'), "console.log(JSON.stringify({gates:[{name:'smoke',outcome:'passed'}]}));");
    await exec('pnpm', ['install', '--lockfile-only', '--ignore-scripts'], { cwd: project, timeout: 45_000 });
    if (subdirectory) await fs.writeFile(path.join(repository, 'pnpm-lock.yaml'), 'unrelated project lock');
    await exec('git', ['init', '-q'], { cwd: repository });
    await exec('git', ['add', '.'], { cwd: repository });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'], { cwd: repository });
    vi.resetModules();
    const { ProjectRegistry } = await import('../../src/project/registry.js');
    vi.spyOn(ProjectRegistry, 'open').mockReturnValue({ get: () => ({ name: 'consumer', path: project }) } as unknown as InstanceType<typeof ProjectRegistry>);
    const { runReleaseBuild } = await import('../../src/release/build-run.js');
    const result = await runReleaseBuild('consumer', {});
    expect(result.root.startsWith(home + path.sep)).toBe(true);
    expect(result.manifest.project.directory).toBe(subdirectory || undefined);
    expect(result.manifest.artifactFailures).toBeUndefined();
    expect(result.manifest.artifacts).toEqual([expect.objectContaining({ app: 'worker', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) })]);
    expect(result.manifest.omni).toMatchObject({ commit, registry: { packages: archives.map(a => a.pin) } });
    expect(result.manifest.gates).toEqual([{ name: 'smoke', status: 'passed' }]);
    const { readReleaseId } = await import('../../src/shared/release-reading.js');
    const second = await runReleaseBuild('consumer', {});
    expect(second.id).not.toBe(result.id);
    expect(readReleaseId(second.id)).toEqual(readReleaseId(result.id));
    expect(second.manifest.artifacts).toEqual(result.manifest.artifacts);
    await expect(runReleaseBuild('consumer', { env: { TAMPER_FRAMEWORK: '1' } })).rejects.toThrow(/framework file differs/);
    expect(JSON.parse(await fs.readFile(result.manifestPath, 'utf8'))).toEqual(result.manifest);
    await expect(fs.stat(path.join(result.root, 'src'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}, 120_000);
