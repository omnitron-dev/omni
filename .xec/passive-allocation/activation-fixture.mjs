import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const sha = data => createHash('sha256').update(data).digest('hex');
const smokeNames = ['passive-smoke-one', 'passive-smoke-two'];

export async function buildSmokeRelease(sdk, work, store, id, file, target, commit) {
  const { ArtifactBuilder } = await sdk('project/artifact-builder');
  const out = path.join(store, id, 'artifacts');
  await fs.mkdir(out, { recursive: true });
  const builder = new ArtifactBuilder(work, out), artifacts = [], apps = [];
  for (const name of smokeNames) {
    const cwd = path.join(work, name);
    await fs.mkdir(path.join(cwd, 'dist'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'package.json'), JSON.stringify({ name, type: 'module', version: '1.0.0', files: ['dist'] }));
    await fs.writeFile(path.join(cwd, 'dist/main.js'), "console.log('synthetic fixture ready'); setInterval(() => {}, 1000);\n");
    const entry = { name, cwd, script: 'dist/main.js' };
    const built = await builder.buildApp(entry, { skipBuild: true, releaseCheckouts: [work] });
    assert.ok(built.launch);
    artifacts.push({ app: name, version: built.version, sha256: built.tarballSha256, bytes: built.size, launch: built.launch,
      packageSource: { directory: name, manifestBlob: 'e'.repeat(40), migrations: {} } });
    apps.push({ name, script: 'dist/main.js' });
  }
  const manifest = { id, project: { repo: 'fixture-project', commit: 'c'.repeat(40) }, omni: { repo: 'fixture-sdk', commit },
    builtAt: new Date().toISOString(), builtBy: 'test', builtWith: { omnitron: '0.3.1', packages: [], target },
    artifacts, gates: [{ name: 'fixture', status: 'passed' }] };
  const bytes = JSON.stringify(manifest);
  await fs.writeFile(path.join(store, id, 'manifest.json'), bytes);
  const capture = { protocol: 1, project: 'passive-fixture', stack: 'test', release: id, commit: manifest.project.commit,
    manifestSha256: sha(bytes), config: { apps, stacks: { test: { type: 'remote', nodes: [{ nodeId: 'receiver-fixture' }] } } } };
  await fs.writeFile(file, JSON.stringify(capture));
}

export async function activateSmoke({ sdk, pkg, work, release, owner, client, logger, project, stack, dir }) {
  assert.deepEqual(release.files.map(a => a.app), smokeNames);
  const { releaseArtifactOrigins } = await sdk('release/origin');
  const { RemoteDeployer } = await sdk('services/remote-deployer.service');
  const root = path.join(work, 'active'), origins = releaseArtifactOrigins(release.manifest, release.manifestSha256);
  const apps = [], artifacts = [];
  for (const a of release.files) {
    const { origin, artifact } = origins.find(v => v.app === a.app);
    artifacts.push({ app: a.app, version: a.version, path: a.path, size: a.bytes,
      checksum: a.sha256, tarballSha256: a.sha256, release: origin, launch: artifact.launch });
    apps.push({ name: a.app, script: artifact.launch.file });
  }
  const mapper = s => s.replaceAll('/opt/omnitron/projects', path.dirname(dir)).replaceAll('/opt/omnitron/artifacts', root);
  const cli = path.join(pkg, 'dist/cli/omnitron.js');
  let checkedBeforeStart = false;
  const remote = new RemoteDeployer(logger, {});
  // Isolated transport and filesystem roots. The publisher, CLI, project RPC and process owner are native.
  Object.assign(remote, {
    inspectInstalledBundle: async () => ({ root: pkg, applicationRuntime: await owner() }),
    verifySSH: async target => assert.equal(target.host, 'fixture.invalid'),
    scpTransfer: async (target, source, destination) => {
      assert.equal(target.host, 'fixture.invalid');
      await fs.copyFile(source, mapper(destination));
    },
    askNodeStatus: async () => {
      await client.refresh();
      const data = { apps: client.orchestrator.list(), pid: process.pid };
      return { raw: JSON.stringify({ ok: true, data }), words: '', code: 0 };
    },
    sshExec: async (target, command, _timeout, stdin) => {
      assert.equal(target.host, 'fixture.invalid');
      if (command.startsWith('docker network inspect ')) return '';
      if (command.startsWith('omnitron stack start ')) {
        const cfg = (await import(pathToFileURL(path.join(dir, 'omnitron.config.mjs')).href + '?before-start')).default;
        assert.deepEqual(cfg.apps.map(e => e.name), smokeNames);
        assert.ok(cfg.apps.every(e => !Object.hasOwn(e, 'enabled')));
        assert.equal(cfg.stacks.deployed.release, undefined);
        assert.deepEqual(cfg.stacks.deployed.managedOrigin, { project, stack });
        checkedBeforeStart = true;
      }
      const cmd = mapper(command.replace(/^omnitron /, process.execPath + ' ' + cli + ' '));
      return new Promise((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', cmd], { cwd: work }), output = [], errors = [];
        child.stdout.on('data', b => output.push(b)); child.stderr.on('data', b => errors.push(b));
        child.on('error', reject); child.stdin.on('error', reject);
        child.on('exit', code => code === 0 ? resolve(Buffer.concat(output).toString()) : reject(Error(Buffer.concat(errors.concat(output)).toString())));
        child.stdin.end(stdin && mapper(stdin));
      });
    },
  });
  const published = await remote.deployToStack([{ host: 'fixture.invalid' }], artifacts, project,
    { stack, apps, concurrency: 1, migrations: [] });
  assert.equal(published.length, artifacts.length);
  for (const result of published) {
    assert.equal(result.status, 'success', result.error);
    const checksum = path.join(root, project, result.app, result.directory ?? result.version, '.artifact-sha256');
    assert.equal((await fs.readFile(checksum, 'utf8')).trim(), artifacts.find(a => a.app === result.app).checksum);
  }
  assert.ok(checkedBeforeStart);
  await client.refresh();
  const byName = new Map(client.orchestrator.list().map(a => [a.name, a]));
  return smokeNames.map(name => {
    const app = byName.get(project + '/deployed/' + name);
    assert.equal(app?.status, 'online'); assert.ok(app.pid > 1);
    return { name, pid: app.pid, generation: app.generation };
  });
}
