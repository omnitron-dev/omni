/** Real Docker reconfiguration through the same manager used by stack start.
 * node test/runtime/stack-infrastructure-reconfiguration.mjs dist [receipt.json]
 * Two nonce-scoped Alpine containers, no ports/network, one disposable volume.
 * Requires a cached alpine:3.24 image; never pulls images or contacts a daemon.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';

const run = promisify(execFile);
const dist = path.resolve(process.argv[2] || 'dist');
const { StackInfrastructureManager } = await import(pathToFileURL(path.join(dist, 'infrastructure/stack-infra-manager.js')));
const manager = new StackInfrastructureManager(createNullLogger());
const project = `infra-qa-${randomBytes(12).toString('hex')}`, stack = 'dev';
const prefix = `${project}-${stack}`, names = [`${prefix}-gateway`, `${prefix}-storage`], volume = `${prefix}-storage-data`;
const report = { test: 'stack-infrastructure-reconfiguration', project, passed: false, liveActivation: false, checks: [] };
const exec = async args => (await run('docker', args, { timeout: 30_000, maxBuffer: 1024 * 1024 })).stdout.trim();
const provider = await exec(['info', '--format', '{{.ID}}']);
const image = await exec(['image', 'inspect', 'alpine:3.24', '--format', '{{.Id}}']);
assert.match(image, /^sha256:[a-f0-9]{64}$/);
const scope = { type: 'local', apps: [] };
const config = (probe, storageProbe) => ({ services: {
  gateway: { ports: {}, env: {}, docker: {
    image, network: 'none', restart: 'no', resources: { cpus: 0.25, memory: '32m' },
    command: ['sh', '-c', 'touch /probe-one /probe-two; trap "exit 0" TERM; while :; do sleep 1; done'],
  }, healthCheck: { type: 'command', target: `test -f /${probe}`, interval: '1s', timeout: '1s', retries: 1, startPeriod: '1s' } },
  storage: { ports: {}, env: {}, docker: {
    image, network: 'none', restart: 'no', resources: { cpus: 0.25, memory: '32m' }, volumes: { data: '/data' },
    command: ['sh', '-c', 'trap "exit 0" TERM; while :; do sleep 1; done'],
  }, ...(storageProbe && { healthCheck: { type: 'command', target: storageProbe, interval: '1s', timeout: '1s', retries: 1 } }) },
} });
const inspect = async name => {
  assert(names.includes(name));
  assert.equal(await exec(['info', '--format', '{{.ID}}']), provider);
  const [value] = JSON.parse(await exec(['inspect', name]));
  assert.equal(value.Name, `/${name}`); assert.equal(value.Image, image);
  assert.equal(value.Config.Labels['omnitron.managed'], 'true');
  assert.equal(value.Config.Labels['omnitron.project'], project); assert.equal(value.Config.Labels['omnitron.stack'], stack);
  assert.equal(value.HostConfig.NetworkMode, 'none'); assert.equal(Object.keys(value.HostConfig.PortBindings ?? {}).length, 0);
  assert(value.Mounts.every(mount => mount.Type === 'volume' && mount.Name === volume && mount.Destination === '/data'));
  return value;
};
let failure;
try {
  for (const name of names) assert.equal(await exec(['ps', '-aq', '--filter', `name=^/${name}$`]), '');
  assert.equal(await exec(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]), '');
  const owner = await manager.provisionStack(project, stack, scope, config('probe-one'));
  assert.equal(owner.getState().ready, true);
  const initial = await Promise.all(names.map(inspect));
  await exec(['exec', initial[1].Id, 'sh', '-c', `printf '%s' '${project}' > /data/sentinel`]);
  const volumeBefore = await exec(['volume', 'inspect', volume]);
  report.initial = initial.map(item => ({ id: item.Id, name: item.Name, health: item.State.Health?.Status ?? null }));
  const cold = new StackInfrastructureManager(createNullLogger());
  try {
    await assert.rejects(cold.provisionStack(project, stack, scope, config('probe-two'), undefined, undefined, 'automatic'),
      /Automatic start would replace/);
    assert.deepEqual((await Promise.all(names.map(inspect))).map(item => item.Id), initial.map(item => item.Id));
    assert.equal(await exec(['exec', initial[1].Id, 'cat', '/data/sentinel']), project);
    assert.equal(cold.getInstance(project, stack), null);
    report.checks.push('Cold automatic boot holds immutable drift before touching either native container');
  } finally { cold.dispose(); }
  assert.equal(await manager.provisionStack(project, stack, scope, config('probe-two')), owner);
  assert.equal(owner.getState().ready, true);
  const changed = await Promise.all(names.map(inspect));
  assert.notEqual(changed[0].Id, initial[0].Id); assert.equal(changed[0].State.Health.Status, 'healthy');
  assert(changed[0].Config.Healthcheck.Test.join(' ').includes('/probe-two'));
  assert.equal(changed[1].Id, initial[1].Id);
  assert.equal(await exec(['exec', changed[1].Id, 'cat', '/data/sentinel']), project);
  assert.equal(await exec(['volume', 'inspect', volume]), volumeBefore);
  report.checks.push('Only the changed health-check container is replaced; another native ID and volume data remain exact');
  await manager.provisionStack(project, stack, scope, config('probe-two'));
  assert.deepEqual((await Promise.all(names.map(inspect))).map(item => item.Id), changed.map(item => item.Id));
  const snapshot = manager.captureRecoveryState();
  assert(snapshot[0].infrastructure.containers.find(item => item.name === names[0]).healthCheck.test.join(' ').includes('/probe-two'));
  report.checks.push('Repeated current configuration is idempotent and recovery metadata retains the new probe');
  await manager.provisionStack(project, stack, scope, config('probe-two', 'test -f /data/sentinel'), undefined, undefined, 'reconcile');
  const forward = await inspect(names[1]);
  assert.notEqual(forward.Id, changed[1].Id); assert.equal(forward.State.Health.Status, 'healthy');
  assert.equal(await exec(['exec', forward.Id, 'cat', '/data/sentinel']), project);
  await manager.provisionStack(project, stack, scope, config('probe-two'), undefined, undefined, 'reconcile');
  const reverse = await inspect(names[1]);
  assert.notEqual(reverse.Id, forward.Id);
  assert.equal(await exec(['exec', reverse.Id, 'cat', '/data/sentinel']), project);
  assert.equal(await exec(['volume', 'inspect', volume]), volumeBefore);
  assert.equal((await inspect(names[0])).Id, changed[0].Id);
  report.checks.push('Reviewing the volume-backed service in both directions keeps its original named volume, contents and sibling ID');
  const review = await manager.inspectStopContainers(project, stack);
  await manager.teardownStack(project, stack, review);
  assert.equal(await exec(['volume', 'inspect', volume]), volumeBefore);
  await manager.provisionStack(project, stack, scope, config('probe-two'));
  const restarted = await Promise.all(names.map(inspect));
  assert.equal(await exec(['exec', restarted[1].Id, 'cat', '/data/sentinel']), project);
  assert.equal(manager.getInstance(project, stack).getState().ready, true);
  report.checks.push('Reviewed stop and ordinary start preserve the volume sentinel and restore healthy services');
  report.passed = true;
} catch (error) { failure = error; report.failure = { message: error.message, code: error.code }; }
finally {
  try {
    await manager.getInstance(project, stack)?.relinquishMonitoring();
    manager.dispose();
    for (const name of names) {
      const id = await exec(['ps', '-aq', '--no-trunc', '--filter', `name=^/${name}$`]);
      if (!id) continue;
      const value = await inspect(name); assert.equal(value.Id, id);
      if (value.State.Running) await exec(['stop', '--time', '5', id]);
      await exec(['rm', id]);
    }
    assert.equal(await exec(['info', '--format', '{{.ID}}']), provider);
    if (await exec(['volume', 'ls', '-q', '--filter', `name=^${volume}$`])) {
      assert.equal(await exec(['ps', '-aq', '--filter', `volume=${volume}`]), '');
      await exec(['volume', 'rm', volume]);
    }
    for (const name of names) assert.equal(await exec(['ps', '-aq', '--filter', `name=^/${name}$`]), '');
    assert.equal(await exec(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]), '');
    report.cleanup = { passed: true, containers: names, volume };
  } catch (error) {
    report.passed = false;
    report.cleanup = { passed: false, message: error.message };
    failure = failure ? new AggregateError([failure, error], 'Native verification and cleanup failed') : error;
  }
  if (process.argv[3]) await fs.writeFile(path.resolve(process.argv[3]), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
}
if (failure) throw failure;
