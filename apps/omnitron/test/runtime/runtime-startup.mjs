import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reserveDaemonPorts } from './fixture-ports.mjs';
import { execFile, spawn } from 'node:child_process';
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
const { httpPort, ports: [tcpPort], release } = await reserveDaemonPorts(1);
const socket = path.join(home, 'daemon.sock');
const ownerDirectory = path.join(directory, 'e');
await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({
  role: 'slave', initialized: true, initializedAt: new Date().toISOString(), webapp: false,
  port: tcpPort, httpPort, host: '127.0.0.1',
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
let foreground;
let foregroundError;
let foregroundClosed;
try {
  await release();
  for (const [cycle, mode] of ['background', 'foreground', 'forwarded-foreground'].entries()) {
    const args = ['up', '--no-infra', '--no-watch'];
    const options = { cwd: directory, env: { ...process.env, OMNITRON_HOME: home } };
    if (mode === 'background') {
      const output = await execute(installed.launcher, args, { ...options, timeout: 90_000, maxBuffer: 1024 * 1024 });
      await fs.writeFile(path.join(directory, `start-${cycle}.log`), output.stdout + output.stderr, { mode: 0o600 });
    } else {
      args.push('--foreground');
      const log = await fs.open(path.join(directory, `start-${cycle}.log`), 'wx', 0o600);
      try {
        foreground = mode === 'foreground'
          ? spawn(installed.launcher, args, { ...options, stdio: ['ignore', log.fd, log.fd] })
          : spawn(process.execPath, [path.join(dist, 'cli/omnitron.js'), ...args], { ...options, stdio: ['ignore', log.fd, log.fd] });
        foregroundError = undefined;
        foregroundClosed = new Promise(resolve => {
          foreground.once('error', error => { foregroundError = error; resolve(); });
          foreground.once('close', resolve);
        });
      } finally { await log.close(); }
      assert.ok(foreground.pid);
      owned.add(foreground.pid);
    }
    let status;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (foreground) {
        assert.ifError(foregroundError);
        assert.equal(foreground.exitCode, null, `Foreground CLI exited during startup in ${mode}`);
        assert.equal(foreground.signalCode, null, `Foreground CLI was signalled during startup in ${mode}`);
      }
      client = createDaemonClient(socket, 2_000);
      try { status = await client.status(); break; }
      catch { await client.disconnect(); client = null; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(status, `Daemon did not become ready in ${mode}`);
    assert.equal(status.build.commit, installed.artifact.build.commit);
    assert.equal(status.execution.mode, 'resident');
    assert.ok(PidManager.processArgvMatches(status.pid, mode === 'background'
      ? installed.artifact.entry : path.join(installed.artifact.directory, 'cli/omnitron.js')));
    assert.equal(status.apps.length, 0);
    owned.add(status.pid); owned.add(status.execution.owner.pid);
    states.push({ mode, backend: status.pid, owner: status.execution.owner.pid, epoch: status.execution.epoch });
    // Startup has completed: the foreground CLI must remain available, while
    // another foreground invocation against it must return without lingering.
    const alreadyRunning = await execute(installed.launcher, ['up', '--foreground', '--no-infra', '--no-watch'], {
      ...options, timeout: 30_000, maxBuffer: 1024 * 1024,
    });
    assert.match(alreadyRunning.stdout + alreadyRunning.stderr, /Daemon already running/);
    assert.equal((await client.status()).pid, status.pid);
    if (foreground) assert.equal(foreground.exitCode, null, 'Foreground CLI completed before daemon shutdown');
    await client.shutdown({ force: false }).catch(() => undefined);
    await client.disconnect(); client = null;
    await waitDead(status.pid); await waitDead(status.execution.owner.pid);
    if (foreground) {
      await waitDead(foreground.pid);
      await foregroundClosed;
      assert.ifError(foregroundError);
      assert.equal(foreground.exitCode, 0, 'Foreground CLI must preserve the daemon shutdown result');
      foreground = null;
    }
  }
  assert.equal(new Set(states.map(state => state.owner)).size, states.length);
  for (let index = 1; index < states.length; index++) assert.ok(states[index].epoch > states[index - 1].epoch);
  assert.equal((await selectedBackend(home)).runtimeHash, installed.artifact.runtimeHash);
  await fs.appendFile(path.join(installed.artifact.directory, 'cli/omnitron.js'), '\n// altered fixture\n');
  await assert.rejects(() => execute(installed.launcher, ['--help'], {
    cwd: directory, env: { ...process.env, OMNITRON_HOME: home }, timeout: 30_000,
  }), error => /changed after sealing/.test(error.stderr));
  await verifyRuntimeArtifact(path.resolve(dist, '../../..'));
  console.log(JSON.stringify({ test: 'durable-cold-start-and-integrity', directory, states, foregroundLifecycle: true, sourcePathAbsent: true, alteredRuntimeRefused: true }));
} finally {
  await client?.disconnect();
  for (const marker of [path.join(home, 'daemon.pid'), path.join(ownerDirectory, 'owner.pid')]) {
    const pid = new PidManager(marker).getPid(); if (pid) owned.add(pid);
  }
  for (const pid of owned) {
    if (PidManager.isProcessAlive(pid)) { process.kill(pid, 'SIGTERM'); await waitDead(pid); }
  }
}
