/** Native, nonce-scoped test of the host database's bridge migration using the candidate's code. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] ?? 'dist');
const load = file => import(pathToFileURL(path.join(dist, file)));
const { inspectControlPlaneDatabase, moveControlPlaneDatabase } = await load('daemon/control-plane-database.js');
const { createContainer, waitForHealthy, restartContainer } = await load('infrastructure/container-runtime.js');
const docker = async (...args) => (await promisify(execFile)('docker', args, { timeout: 25_000 })).stdout.trim();
const nonce = randomBytes(10).toString('hex');
const name = 'omnitron-db-qa-' + nonce, old = name + '-old_default', target = name + '-new_default', volume = name + '-data';
const label = 'omnitron.test=' + nonce, labelValue = '{{index .Labels "omnitron.test"}}';
const report = { passed: false, cleanup: false, container: null, checks: [] };
const networkIds = [], image = await docker('image', 'inspect', 'alpine:3.24', '--format', '{{.Id}}');
let id, ownsVolume = false;
try {
  for (const bridge of [old, target]) networkIds.push(await docker('network', 'create', '--label', label, bridge));
  assert.equal(await docker('volume', 'ls', '-q', '--filter', 'name=^' + volume + '$'), '');
  assert.equal(await docker('volume', 'create', '--label', label, volume), volume);
  ownsVolume = true;
  const prior = { name, image, environment: {}, ports: [], volumes: [{ source: volume, target: '/data' }], restart: 'no',
    labels: { 'omnitron.managed': 'true', 'omnitron.service': 'omnitron-pg', 'omnitron.internal': 'true', 'omnitron.test': nonce },
    network: old, command: ['sh', '-c', 'trap "exit 0" TERM; while :; do sleep 1; done'],
    resources: { cpus: 0.25, memory: '32m' }, healthCheck: { test: ['CMD-SHELL', 'true'], interval: '1s', timeout: '1s', retries: 2 } };
  const desired = { ...prior, network: target };
  await createContainer(prior);
  id = await docker('container', 'inspect', name, '--format', '{{.Id}}');
  assert.match(id, /^[a-f0-9]{64}$/); report.container = id;
  assert(await waitForHealthy(id, 20_000));
  await docker('exec', id, 'sh', '-c', 'echo ' + nonce + ' >/data/sentinel');
  const plan = await inspectControlPlaneDatabase(desired);
  assert.equal(plan.action, 'move-network');
  assert.equal(plan.move.id, id); assert.equal(plan.move.fromId, networkIds[0]); assert.equal(plan.move.toId, networkIds[1]);
  const mismatched = await inspectControlPlaneDatabase({ ...desired, environment: { UNDECLARED: '1' } });
  assert.equal(mismatched.action, 'hold');
  await docker('network', 'connect', networkIds[1], id);
  assert.equal((await inspectControlPlaneDatabase(desired)).move.attachedToTarget, true);
  await moveControlPlaneDatabase(desired, plan.move);
  assert.equal((await inspectControlPlaneDatabase(desired)).action, 'retain');
  assert.equal(await docker('container', 'inspect', id, '--format', '{{.State.StartedAt}}'), plan.move.startedAt);
  await moveControlPlaneDatabase(desired, plan.move);
  report.checks.push('An interrupted connect resumes on the same generation and refuses unrelated configuration drift');
  await restartContainer(id); assert(await waitForHealthy(id, 20_000));
  assert.equal((await inspectControlPlaneDatabase(desired)).action, 'retain');
  assert.equal(await docker('exec', id, 'cat', '/data/sentinel'), nonce);
  const networks = JSON.parse(await docker('container', 'inspect', id, '--format', '{{json .NetworkSettings.Networks}}'));
  assert.deepEqual(Object.keys(networks), [target]);
  report.checks.push('One endpoint, original container and exact volume contents survive a native restart');
  report.passed = true;
} finally {
  const existing = await docker('ps', '-a', '-q', '--no-trunc', '--filter', 'name=^/' + name + '$');
  if (existing) {
    assert.equal(await docker('container', 'inspect', existing, '--format', '{{index .Config.Labels "omnitron.test"}}'), nonce);
    if (id) assert.equal(existing, id);
    await docker('container', 'stop', '--time', '5', existing); await docker('container', 'rm', existing);
  }
  if (ownsVolume) {
    assert.equal(await docker('volume', 'inspect', volume, '--format', labelValue), nonce);
    await docker('volume', 'rm', volume);
  }
  for (const networkId of networkIds.reverse()) {
    assert.equal(await docker('network', 'inspect', networkId, '--format', labelValue), nonce);
    await docker('network', 'rm', networkId);
  }
  report.cleanup = true;
  if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(report));
}
