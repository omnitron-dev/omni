import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const dist = path.resolve(process.argv[2]);
assert.ok(dist.includes('omnitron-handoff-'), 'Pass a disposable, sealed validation runtime');
const directory = await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/private/tmp' : os.tmpdir(), 'omni-start-'));
const home = path.join(directory, 'i');
await fs.mkdir(home, { mode: 0o700 });
process.env.OMNITRON_HOME = home;
const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { RuntimeInstallation, selectedBackend } = await load('daemon/runtime-installation.js');
const { createDaemonClient } = await load('daemon/daemon-client.js');
const { PidManager } = await load('daemon/pid-manager.js');
const { verifyRuntimeArtifact } = await load('shared/runtime-artifact.js');
const reserve = () => new Promise((resolve, reject) => {
  const server = net.createServer(); server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const socket = path.join(home, 'daemon.sock');
const ownerDirectory = path.join(directory, 'e');
await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({
  role: 'slave', initialized: true, initializedAt: new Date().toISOString(), webapp: false,
  port: await reserve(), httpPort: await reserve(), host: '127.0.0.1',
  auth: { jwtSecret: 'isolated-runtime-startup-test-secret' },
  executionHost: { enabled: true, directory: ownerDirectory },
}), { mode: 0o600 });
const source = path.join(directory, 'source');
await fs.cp(path.resolve(dist, '../../..'), source, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE });
const installation = await RuntimeInstallation.open(home);
const installed = await installation.exclusive(async () => {
  const artifact = await installation.install(source);
  await installation.select(artifact.runtimeHash, 0);
  const launcher = await installation.writeLauncher();
  return { artifact, launcher };
});
await installation.close();
// The original installation path is now absent. Cold start must use only the permanent copy.
await fs.rename(source, source + '.retired');
const owned = new Set();
const waitDead = async pid => {
  for (let attempt = 0; attempt < 400 && PidManager.isProcessAlive(pid); attempt++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(PidManager.isProcessAlive(pid), false, `Fixture process ${pid} is still alive`);
};
let client;
const states = [];
try {
  for (let cycle = 0; cycle < 2; cycle++) {
    const output = await execute(installed.launcher, ['up', '--no-infra', '--no-watch'], {
      cwd: directory, env: { ...process.env, OMNITRON_HOME: home }, timeout: 90_000, maxBuffer: 1024 * 1024,
    });
    await fs.writeFile(path.join(directory, `start-${cycle}.log`), output.stdout + output.stderr, { mode: 0o600 });
    client = createDaemonClient(socket, 15_000);
    const status = await client.status();
    assert.equal(status.build.commit, installed.artifact.build.commit);
    assert.equal(status.execution.mode, 'resident');
    assert.ok(PidManager.processArgvMatches(status.pid, installed.artifact.entry));
    assert.equal(status.apps.length, 0);
    owned.add(status.pid); owned.add(status.execution.owner.pid);
    states.push({ backend: status.pid, owner: status.execution.owner.pid, epoch: status.execution.epoch });
    await client.shutdown({ force: false }).catch(() => undefined);
    await client.disconnect(); client = null;
    await waitDead(status.pid); await waitDead(status.execution.owner.pid);
  }
  assert.notEqual(states[0].owner, states[1].owner);
  assert.ok(states[1].epoch > states[0].epoch);
  assert.equal((await selectedBackend(home)).runtimeHash, installed.artifact.runtimeHash);
  await fs.appendFile(path.join(installed.artifact.directory, 'cli/omnitron.js'), '\n// altered fixture\n');
  await assert.rejects(() => execute(installed.launcher, ['--help'], {
    cwd: directory, env: { ...process.env, OMNITRON_HOME: home }, timeout: 30_000,
  }), error => /changed after sealing/.test(error.stderr));
  await verifyRuntimeArtifact(path.resolve(dist, '../../..'));
  console.log(JSON.stringify({ test: 'durable-cold-start-and-integrity', directory, states, sourcePathAbsent: true, alteredRuntimeRefused: true }));
} finally {
  await client?.disconnect();
  for (const marker of [path.join(home, 'daemon.pid'), path.join(ownerDirectory, 'owner.pid')]) {
    const pid = new PidManager(marker).getPid(); if (pid) owned.add(pid);
  }
  for (const pid of owned) {
    if (PidManager.isProcessAlive(pid)) { process.kill(pid, 'SIGTERM'); await waitDead(pid); }
  }
}
