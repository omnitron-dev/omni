import '@xec-sh/cli/globals';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Command } from '@xec-sh/core';
import type { RecoveryQualificationExpected, RecoveryQualificationRelease } from '../../src/services/recovery-qualification.js';
import type { TargetRuntime } from '../../data/operations/runtime-identity.js';
import * as tar from 'tar';

const app = path.resolve(__dirname, '../..');
const repo = path.resolve(app, '../..');
const fixture = path.join(app, 'test/fixtures/recovery-qualification');
const files = ['recovery-qualification.js', 'recovery-input-store.js', 'recovery-observations.js', 'runtime-identity.js'];
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const encoded = (value: unknown) => Buffer.from(JSON.stringify(value, (_key, item) =>
  item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : item));

const run = (command: string, args: string[], options: Pick<Command, 'timeout' | 'cwd' | 'env' | 'envMode' | 'nothrow'> = {}) =>
  $.execute({ command, args, adapter: 'local', shell: false, timeout: 30_000, ...options });

async function makeImage(root: string): Promise<string> {
  const context = path.join(root, 'image');
  const copied = new Set();
  async function copy(source: string, absolutePath: string) {
    if (copied.has(absolutePath)) return;
    assert(path.isAbsolute(absolutePath) && path.normalize(absolutePath) === absolutePath);
    const target = path.join(context, 'fs', absolutePath);
    await fs.copy(source, target, { dereference: true });
    await fs.chmod(target, absolutePath.endsWith('.py') ? 0o444 : 0o555);
    copied.add(absolutePath);
  }
  async function binary(source: string, absolutePath: string) {
    await copy(source, absolutePath);
    const { stdout } = await run('/usr/bin/ldd', [source]);
    for (const [, library] of stdout.matchAll(/(?:=>\s+|^\s*)(\/[^\s]+)\s+\(/gm)) {
      assert(library);
      await copy(library, library);
    }
  }
  for (const tool of ['env', 'timeout', 'sleep', 'python3']) await binary('/usr/bin/' + tool, '/usr/bin/' + tool);
  await binary(process.execPath, '/usr/bin/node');

  // Read the OS package inventory without importing modules or executing Python on the host.
  const version = path.basename(await fs.realpath('/usr/bin/python3'));
  assert.match(version, /^python3\.\d+$/);
  const library = '/usr/lib/' + version + '/';
  const { stdout } = await run('/usr/bin/dpkg-query', ['-L', 'lib' + version + '-minimal', 'lib' + version + '-stdlib']);
  for (const entry of new Set(stdout.split('\n'))) {
    if (!entry.startsWith(library) || !/\.(?:py|so)$/.test(entry) ||
        /\/(?:test|tests|site-packages|dist-packages)\/|\/(?:sitecustomize|usercustomize)\.py$/.test(entry)) continue;
    const source = await fs.realpath(entry);
    assert(source.startsWith(library), 'Expected an OS-owned standard library file');
    if (entry.endsWith('.so')) await binary(source, entry);
    else await copy(source, entry);
  }
  const imageId = path.join(root, 'image-id');
  await fs.writeFile(path.join(context, 'Dockerfile'), 'FROM scratch\nLABEL org.omnitron.qa=' + randomUUID() + '\nCOPY fs/ /\n');
  await run('docker', ['build', '--network=none', '--pull=false', '--iidfile', imageId, context], { timeout: 180_000 });
  const image = (await fs.readFile(imageId, 'utf8')).trim();
  assert.match(image, /^sha256:[0-9a-f]{64}$/);
  return image;
}

async function packedInstallation(root: string) {
  const { stdout } = await run('npm', ['pack', '--offline', '--ignore-scripts', '--silent', '--pack-destination', root], { cwd: app });
  const name = stdout.trim();
  assert.match(name, /^[a-z0-9.-]+\.tgz$/);
  const installation = path.join(root, 'package');
  await fs.mkdir(installation);
  await tar.extract({ cwd: installation, file: path.join(root, name), strip: 1, strict: true });
  const manifest = await fs.readJson(path.join(installation, 'package.json'));
  for (const dependency of Object.keys(manifest.dependencies)) {
    const target = path.join(installation, 'node_modules', dependency);
    const local = path.join(app, 'node_modules', dependency);
    let source;
    try { source = await fs.realpath(local); }
    catch (err) {
      if (!(err instanceof Error && 'code' in err && err.code === 'ENOENT')) throw err;
      source = await fs.realpath(path.join(repo, 'node_modules', dependency));
    }
    await fs.ensureSymlink(source, target);
  }
  return installation;
}

async function inputs(root: string, image: string, runtime: TargetRuntime): Promise<RecoveryQualificationExpected> {
  const cas = path.join(root, '.omnitron/recovery-inputs');
  await fs.mkdir(cas, { recursive: true, mode: 0o700 });
  async function retain(bytes: Buffer) {
    const key = hash(bytes);
    await fs.writeFile(path.join(cas, key), bytes, { mode: 0o600 });
    return key;
  }
  const addedMigrations = ['main/219.sql', 'main/220.sql'];
  const probe = await fs.readFile(path.join(fixture, 'probe.py'));
  const application = await fs.readFile(path.join(fixture, 'app.cjs'));
  async function release(role: string): Promise<RecoveryQualificationRelease> {
    const source = path.join(root, role);
    await fs.mkdir(source);
    const code = Buffer.concat([Buffer.from('const ROLE=' + JSON.stringify(role) + ';\n'), application]);
    const closure = encoded({ protocol: 1, runtime });
    await fs.writeFile(path.join(source, 'app.cjs'), code);
    await fs.writeFile(path.join(source, '.omnitron-closure.json'), closure);
    const archive = path.join(root, role + '.tgz');
    await tar.create({ cwd: source, file: archive, gzip: true, portable: true, noMtime: true }, ['app.cjs', '.omnitron-closure.json']);
    const bytes = await fs.readFile(archive);
    const archiveSha = await retain(bytes);
    const names = ['main/218.sql', ...(role === 'incumbent' ? [] : addedMigrations)];
    const migrations = Object.fromEntries(names.map(name => [name, hash('source ' + name)]));
    const commit = hash(role).slice(0, 40);
    const manifest = { id: role, project: { commit }, builtWith: { target: runtime }, migrations,
      artifacts: [{ app: 'ledger', sha256: archiveSha, bytes: bytes.length, closureSha256: hash(closure),
        packageSource: { migrations, migrationPrograms: [{ release: 'app.cjs', releaseSha256: hash(code) }] } }],
      statics: { files: 1, bytes: role.length } };
    const index = { 'index.html': { bytes: role.length, sha256: await retain(Buffer.from(role)) } };
    return { id: role, manifestSha256: await retain(encoded(manifest)), commit, tree: commit,
      artifacts: { ledger: archiveSha }, staticsIndexSha256: await retain(encoded(index)) };
  }
  return { project: 'lab', stack: 'fixture', nodeId: 'production-fixture', addedMigrations,
    probe: { commit: 'f'.repeat(40), sha256: await retain(probe), image, recordSets: ['awards'] },
    incumbent: await release('incumbent'), candidate: await release('candidate'), recovery: await release('recovery') };
}

async function verifier(packageRoot: string) {
  const resolve = createRequire(path.join(packageRoot, 'package.json')).resolve;
  const fileHash = async (file: string) => hash(await fs.readFile(file));
  return hash(encoded({ protocol: 3, receiver: await fileHash(path.join(packageRoot, 'dist/services/recovery-qualification.js')),
    files: await Promise.all(files.map(file => fileHash(path.join(packageRoot, 'data/operations', file)))),
    packages: await Promise.all(['@xec-sh/core', 'tar'].map(async name => [name, await fileHash(resolve(name + '/package.json'))])) }));
}

assert.equal(process.platform, 'linux', 'This qualification requires a disposable Linux Docker runner');
await $.withTempDir(async root => {
  let image: string | undefined;
  try {
    const installed = await packedInstallation(root);
    const fromDist = (file: string) => pathToFileURL(path.join(installed, 'dist', file)).href;
    const { targetRuntime } = await import(fromDist('release/target-runtime.js'));
    const { recoveryQualificationDefinition } = await import(fromDist('services/recovery-qualification.js'));
    image = await makeImage(root);
    const spec = await inputs(root, image, await targetRuntime());
    const nodes = {
      getNode: (id: string) => ({ id, host: id, sshPort: 22, sshUser: 'fixture', createdAt: '2020-01-01' }),
      nodeToSshTarget: async (n: {id: string; host: string; sshPort: number; sshUser: string}) => ({ host: n.host, port: n.sshPort, username: n.sshUser,
        expectedHostFingerprint: 'SHA256:' + (n.id === 'qa' ? 'Q' : 'P').repeat(43) }),
    };
    const graph = await recoveryQualificationDefinition(spec, 'qa', nodes);
    const args = graph.steps[0].run.trim().split(' ');
    assert.equal(args.length, 6);
    assert.deepEqual(args.slice(0, 4), ['omnitron', 'pipeline', 'qualify-recovery', '--json']);
    assert.equal(args[4], await verifier(installed));
    const execute = () => run(process.execPath, [fileURLToPath(fromDist('cli/omnitron.js')), ...args.slice(1)],
      { envMode: 'replace', env: { HOME: root, PATH: '/usr/bin:/bin', LC_ALL: 'C' }, nothrow: true, timeout: 300_000 });
    const ok = await execute();
    assert.equal(ok.exitCode, 0, ok.stderr);
    const reply = JSON.parse(ok.stdout);
    assert.equal(reply.ok, true);
    assert.equal(reply.data.protocol, 2);
    assert.equal(reply.data.verifier, args[4]);
    assert.equal(reply.data.phases.length, 10);
    assert.equal(reply.data.inputs, hash(encoded(spec)));
    const ledger = spec.candidate.artifacts['ledger'];
    assert(ledger);
    await fs.writeFile(path.join(root, '.omnitron/recovery-inputs', ledger), 'damaged');
    const corrupt = await execute();
    assert.notEqual(corrupt.exitCode, 0);
    assert.equal(corrupt.stdout, '');
    assert.match(corrupt.stderr, /admitted bytes/);
    log.success('All ten recovery phases preserved SQLite history and new writes. The receiver rejected corrupt input.');
  } finally {
    if (image) await run('docker', ['image', 'rm', image]);
  }
}, { prefix: 'omni-recovery-fixture-' });
