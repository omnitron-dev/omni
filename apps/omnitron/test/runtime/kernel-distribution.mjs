// Exercise the shipped receiver with real Node binaries, tar, SQLite and RuntimeInstallation.
// Only the OS guardian's read-only readiness response is supplied by the fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stageFixtureExtractor } from './fixture-extractor.mjs';
const dist = await fs.realpath(process.argv[2]);
const sdk = name => import(pathToFileURL(path.join(dist, name + '.js')).href);
const { RuntimeInstallation } = await sdk('daemon/runtime-installation');
const { runtimeArtifactDigest } = await sdk('shared/runtime-artifact');
const { writePortableArchive, sha256File } = await sdk('release/portable-archive');
const { importKernelBuild, resolveKernelBuild } = await sdk('services/kernel-catalog');
const sshFixture = process.argv[3] === '--ssh-fixture';
if (sshFixture) {
  assert.equal(process.platform, 'linux');
  assert.ok(process.getuid() > 0);
  assert.equal((await fs.lstat('/run/omnitron-kernel-qa/disposable')).uid, 0);
  assert.equal(os.homedir(), '/home/receiver');
  await assert.rejects(fs.stat(path.join(os.homedir(), '.omnitron/runtime')), { code: 'ENOENT' });
}
const work = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-kernel-transfer-')));
const home = sshFixture ? path.join(os.homedir(), '.omnitron') : path.join(work, 'instance');
const { kernelReceiverSource } = await sdk('services/kernel-distribution');
const receiver = kernelReceiverSource();
async function fixture(name, commit) {
  const root = path.join(work, name), pkg = path.join(root, 'packages/0'), compiled = path.join(pkg, 'dist');
  await fs.mkdir(path.join(compiled, 'daemon'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(compiled, 'shared'));
  await fs.writeFile(path.join(pkg, 'package.json'), '{"type":"module"}');
  const build = { commit, dirty: false, builtAt: '2026-01-01T00:00:00.000Z' };
  await fs.writeFile(path.join(compiled, 'BUILD.json'), JSON.stringify(build));
  await fs.writeFile(path.join(compiled, 'daemon/daemon-entry.js'), 'console.log(' +
    JSON.stringify(JSON.stringify({ protocol: 1, build })) + ')');
  // Real dependency closures contain executable helpers with group/other bits.
  // Their exact bits participate in the sealed digest even inside a private inbox.
  await fs.writeFile(path.join(compiled, 'helper.sh'), '#!/bin/sh\nexit 0\n');
  await fs.chmod(path.join(compiled, 'helper.sh'), 0o751);
  for (const module of ['daemon/runtime-installation', 'daemon/backend-candidate', 'shared/runtime-artifact', 'shared/build-stamp']) {
    await fs.writeFile(path.join(compiled, module + '.js'), 'export * from ' +
      JSON.stringify(pathToFileURL(path.join(dist, module + '.js')).href));
  }
  await fs.writeFile(path.join(compiled, 'daemon/managed-runtime.js'), `export const readManagedRuntime=async home=>({
    directory:home,backend:{artifact:process.env.FIXTURE_GUARDIAN_ARTIFACT}
  });export const managedJobPid=async()=>42;export const verifyManagedIsolation=async()=>{};`);
  await fs.writeFile(path.join(compiled, 'daemon/daemon-client.js'),
    'export const createDaemonClient=()=>({disconnect:async()=>{}})');
  await fs.writeFile(path.join(compiled, 'daemon/private-control-client.js'), `export const privateControlClient=async()=>({
    service:{status:async()=>({state:'ready',operationPending:false,kernelHandoff:Number(process.env.FIXTURE_HANDOFF??1)})},
    close:async()=>{}
  })`);
  await fs.copyFile(process.execPath, path.join(root, 'node'), constants.COPYFILE_FICLONE);
  await fs.chmod(path.join(root, 'node'), 0o500);
  await fs.symlink('packages/0', path.join(root, 'app'));
  const dependencies = await stageFixtureExtractor(dist, pkg, i => path.join(root, 'packages', String(i + 1)));
  const sha256 = await runtimeArtifactDigest(root);
  const manifest = { protocol: 1, sha256, platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 + dependencies };
  await fs.writeFile(path.join(root, 'RUNTIME.json'), JSON.stringify(manifest), { mode: 0o600 });
  return { root, commit, manifest };
}
let installation;
try {
  const prior = await fixture('previous', 'a'.repeat(40)), next = await fixture('candidate', 'b'.repeat(40));
  installation = await RuntimeInstallation.open(home);
  const selected = await installation.exclusive(async () => {
    const installed = await installation.install(prior.root);
    await installation.select(installed.runtimeHash, 0);
    return installed;
  });
  const before = installation.selection();
  const registry = installation.directory;
  const publisher = sshFixture ? home : path.join(work, 'controller');
  let archive, entry;
  if (process.platform === 'linux') {
    entry = await importKernelBuild(next.root, publisher);
    ({ archive } = await resolveKernelBuild(next.commit, entry, publisher));
  } else {
    // Local macOS can exercise its receiver process without advertising Darwin to the Linux fleet.
    archive = path.join(work, 'runtime.tgz');
    await writePortableArchive(next.root, archive, { preserveExecutableBits: true });
    entry = { commit: next.commit, ...next.manifest, artifact: next.manifest.sha256, archive: await sha256File(archive), bytes: (await fs.stat(archive)).size };
  }
  const remoteFile = path.join(work, 'receipt-bound-archive.tgz');
  const cleanEnv = { ...process.env, OMNITRON_HOME: home };
  delete cleanEnv.NODE_PATH;
  delete cleanEnv.NODE_OPTIONS;
  const call = async (phase, capability = 1) => {
    const file = phase === 'install' ? await fs.open(remoteFile, 'r') : null;
    try {
      // The received tree and registry share a filesystem. This fixture has
      // capacity for a single expanded copy and exercises the shipped receiver.
      const singleCopy = `import fileOperations from 'node:fs/promises';
        const originalCopy = fileOperations.cp;
        fileOperations.cp = (from, ...args) => {
          if (from === ${JSON.stringify(path.join(registry, '.incoming-' + entry.artifact, 'payload'))})
            throw Error('Fleet tried to copy the entire extracted tree again');
          return originalCopy(from, ...args);
        };`;
      const result = spawnSync(selected.execPath, ['--input-type=module', '-e', 'process.umask(0o077);\n' + singleCopy + '\n' + receiver, phase, registry, selected.runtimeHash, JSON.stringify(entry)], {
        encoding: 'utf8', stdio: [file?.fd ?? 'ignore', 'pipe', 'pipe'], env: { ...cleanEnv, FIXTURE_HANDOFF: String(capability) },
      });
      if (result.status !== 0) throw Error(result.stderr || String(result.error));
      return JSON.parse(result.stdout);
    } finally { await file?.close(); }
  };
  if (sshFixture) {
    const { exerciseKernelSSH } = await import('./kernel-distribution-ssh.mjs');
    await exerciseKernelSSH({ sdk, home, previous: selected, entry, installation, before });
  } else {
    await assert.rejects(call('prepare', 0), /kernelHandoff@1/);
    assert.equal((await call('prepare')).installed, false);
    await fs.copyFile(archive, remoteFile);
    await fs.chmod(remoteFile, 0o600);
    const file = await fs.open(remoteFile, 'r+');
    try { await file.write(Buffer.from([0]), 0, 1, 0); } finally { await file.close(); }
    await assert.rejects(call('install'), /transfer SHA-256 mismatch/);
    assert.deepEqual(installation.selection(), before);
    assert.equal((await call('prepare')).installed, false);
    await fs.copyFile(archive, remoteFile);
    await fs.chmod(remoteFile, 0o600);
    assert.deepEqual(await call('install'), { installed: true, artifact: entry.artifact });
    assert.equal((await call('prepare')).installed, true);
    // The real registry survives an exited installer. A remote owner check
    // must report its PID before attempting to talk to the serving daemon.
    const open = pathToFileURL(path.join(selected.runtimeRoot, 'packages/0/dist/daemon/runtime-installation.js')).href;
    const leaseHolder = spawnSync(selected.execPath, ['--input-type=module', '-e',
      `import {RuntimeInstallation} from ${JSON.stringify(open)};
       const r=await RuntimeInstallation.open(${JSON.stringify(home)},{existing:true});
       await r.exclusive(()=>process.exit(0));`], { env: cleanEnv });
    assert.equal(leaseHolder.status, 0);
    const { commandFailure } = await sdk('execution/command-failure');
    const observer = 'const commandFailure=' + commandFailure.toString() + ';\n' +
      await fs.readFile(path.join(dist, '../data/operations/managed-kernel.mjs'), 'utf8');
    const inspected = spawnSync(selected.execPath, ['--input-type=module', '-e', observer,
      home, selected.runtimeRoot, '42', JSON.stringify({ operation: 'inspect' })],
    { encoding: 'utf8', env: { ...cleanEnv, FIXTURE_GUARDIAN_ARTIFACT: selected.runtimeHash } });
    assert.equal(inspected.status, 1);
    assert.equal(commandFailure(inspected.stderr, 'exit 1'),
      'The runtime registry has an unsettled lease (installation PID ' + leaseHolder.pid + ')');
    await installation.exclusive(async () => {});
  }
  assert.deepEqual(installation.selection(), before);
  assert.equal(installation.activation(), null);
  assert.equal((await installation.artifact(entry.artifact)).build.commit, next.commit);
  assert.equal((await fs.stat(path.join(installation.releasePath(entry.artifact), 'packages/0/dist/helper.sh'))).mode & 0o111, 0o111);
  console.log('Verified native installation, unchanged selection, transfer corruption, repeat staging and guardian capability.');
} finally {
  await installation?.close();
  await fs.rm(work, { recursive: true, force: true });
}
