// Exercise the shipped receiver with real Node binaries, tar, SQLite and RuntimeInstallation.
// Only the OS guardian's read-only readiness response is supplied by the fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const dist = await fs.realpath(process.argv[2]);
const sdk = name => import(pathToFileURL(path.join(dist, name + '.js')).href);
const { RuntimeInstallation } = await sdk('daemon/runtime-installation');
const { runtimeArtifactDigest } = await sdk('shared/runtime-artifact');
const { writePortableArchive, sha256File } = await sdk('release/portable-archive');
const { importKernelBuild, resolveKernelBuild } = await sdk('services/kernel-catalog');
const shell = promisify(execFile);
const work = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-kernel-transfer-')));
const home = path.join(work, 'instance');
const receiver = await fs.readFile(new URL('../../data/operations/stage-kernel.mjs', import.meta.url), 'utf8');
async function fixture(name, commit) {
  const root = path.join(work, name), pkg = path.join(root, 'packages/0'), compiled = path.join(pkg, 'dist');
  await fs.mkdir(path.join(compiled, 'daemon'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(compiled, 'shared'));
  await fs.writeFile(path.join(pkg, 'package.json'), '{"type":"module"}');
  const build = { commit, dirty: false, builtAt: '2026-01-01T00:00:00.000Z' };
  await fs.writeFile(path.join(compiled, 'BUILD.json'), JSON.stringify(build));
  await fs.writeFile(path.join(compiled, 'daemon/daemon-entry.js'), 'console.log(' +
    JSON.stringify(JSON.stringify({ protocol: 1, build })) + ')');
  for (const module of ['daemon/runtime-installation', 'shared/runtime-artifact', 'shared/build-stamp']) {
    await fs.writeFile(path.join(compiled, module + '.js'), 'export * from ' +
      JSON.stringify(pathToFileURL(path.join(dist, module + '.js')).href));
  }
  await fs.writeFile(path.join(compiled, 'daemon/managed-runtime.js'), 'export const readManagedRuntime=async home=>({directory:home})');
  await fs.writeFile(path.join(compiled, 'daemon/private-control-client.js'), `export const privateControlClient=async()=>({
    service:{status:async()=>({state:'ready',operationPending:false,kernelHandoff:Number(process.env.FIXTURE_HANDOFF)})},
    close:async()=>{}
  })`);
  await fs.copyFile(process.execPath, path.join(root, 'node'), constants.COPYFILE_FICLONE);
  await fs.chmod(path.join(root, 'node'), 0o500);
  await fs.symlink('packages/0', path.join(root, 'app'));
  const sha256 = await runtimeArtifactDigest(root);
  const manifest = { protocol: 1, sha256, platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 };
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
  const publisher = path.join(work, 'controller');
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
  const remoteFile = path.join(registry, '.incoming-' + entry.artifact, 'runtime.tgz');
  const call = async (phase, capability = 1) => {
    const result = await shell(selected.execPath, ['--input-type=module', '-e', receiver, phase, registry, selected.runtimeHash, JSON.stringify(entry)], {
      env: { ...process.env, NODE_PATH: path.resolve(dist, '../node_modules'), OMNITRON_HOME: home, FIXTURE_HANDOFF: String(capability) },
    });
    return JSON.parse(result.stdout);
  };
  await assert.rejects(call('prepare', 0), /kernelHandoff@1/);
  assert.equal((await call('prepare')).installed, false);
  await fs.copyFile(archive, remoteFile);
  const file = await fs.open(remoteFile, 'r+');
  try { await file.write(Buffer.from([0]), 0, 1, 0); } finally { await file.close(); }
  await assert.rejects(call('install'), /transfer SHA-256 mismatch/);
  assert.deepEqual(installation.selection(), before);
  assert.equal((await call('prepare')).installed, false);
  await fs.copyFile(archive, remoteFile);
  assert.deepEqual(await call('install'), { installed: true, artifact: entry.artifact });
  assert.equal((await call('prepare')).installed, true);
  assert.deepEqual(installation.selection(), before);
  assert.equal(installation.activation(), null);
  assert.equal((await installation.artifact(entry.artifact)).build.commit, next.commit);
  console.log('Verified native installation, unchanged selection, transfer corruption, repeat staging and guardian capability.');
} finally {
  await installation?.close();
  await fs.rm(work, { recursive: true, force: true });
}
