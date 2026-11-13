/** Exercise the published SQL endpoint, storage and Docker identity through a real bridge transition. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const dist = path.resolve(process.argv[2] ?? 'dist');
const load = file => import(pathToFileURL(path.join(dist, file)));
const { inspectControlPlaneDatabase, moveControlPlaneDatabase } = await load('daemon/control-plane-database.js');
const { createContainer, waitForHealthy, restartContainer, execInContainer } = await load('infrastructure/container-runtime.js');
const { Client } = createRequire(path.join(dist, 'index.js'))('pg');
const { resolveOmnitronPg } = await load('infrastructure/service-resolver.js');
const docker = async (...args) => (await promisify(execFile)('docker', args, { timeout: 25_000 })).stdout.trim();
const nonce = randomBytes(10).toString('hex');
const name = 'omnitron-db-qa-' + nonce, old = name + '-old_default', target = name + '-new_default', volume = name + '-data';
const label = 'omnitron.test=' + nonce, labelValue = '{{index .Labels "omnitron.test"}}';
const report = { passed: false, cleanup: false, container: null, checks: [] };
const networkIds = [], image = await docker('image', 'inspect', 'postgres:17-alpine', '--format', '{{.Id}}');
const listener = createServer();
await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
async function query(text, args = []) {
  const client = new Client({ host: '127.0.0.1', port, database: 'omnitron', user: 'omnitron', password: nonce,
    connectionTimeoutMillis: 2200, query_timeout: 2200 });
  client.on('error', () => {});
  try {
    await client.connect();
    return (await client.query(text, args)).rows;
  } finally {
    await client.end();
  }
}
let id, ownsVolume = false;
async function ready() {
  if (!await waitForHealthy(id, 60_000)) {
    throw Error('Test PostgreSQL did not become healthy: ' +
      await docker('inspect', '--format', '{{json .State.Health}}', id));
  }
}
try {
  for (const bridge of [old, target]) networkIds.push(await docker('network', 'create', '--label', label, bridge));
  assert.equal(await docker('volume', 'ls', '-q', '--filter', 'name=^' + volume + '$'), '');
  assert.equal(await docker('volume', 'create', '--label', label, volume), volume);
  ownsVolume = true;
  const spec = resolveOmnitronPg({ port, password: nonce, image });
  const prior = { ...spec, name, network: old, restart: 'no',
    volumes: [{ ...spec.volumes[0], source: volume }], labels: { ...spec.labels, 'omnitron.test': nonce },
    healthCheck: { ...spec.healthCheck, interval: '1s', startPeriod: '30s' } };
  const desired = { ...prior, network: target };
  await createContainer(prior);
  id = await docker('container', 'inspect', name, '--format', '{{.Id}}');
  assert.match(id, /^[a-f0-9]{64}$/); report.container = id;
  await ready();
  await query('create table sentinel(value text primary key)');
  await query('insert into sentinel values ($1)', [nonce]);
  const verify = () => query('select system_identifier::text, value from pg_control_system() cross join sentinel');
  const before = await verify();
  assert.equal(before.length, 1);
  assert.equal(before[0].value, nonce);
  report.checks.push('Authenticated host SQL reached the original database and committed the fixture row');
  const literal = "alpha beta (draft's value)";
  assert.equal(await execInContainer(id, ['printf', '%s', literal]), literal);
  report.checks.push('Xec preserves spaces, apostrophes and parentheses in an argument');
  const plan = await inspectControlPlaneDatabase(desired);
  assert.equal(plan.action, 'move-network');
  assert.equal(plan.move.id, id); assert.equal(plan.move.fromId, networkIds[0]); assert.equal(plan.move.toId, networkIds[1]);
  const mismatched = await inspectControlPlaneDatabase({ ...desired, environment: { ...desired.environment, UNDECLARED: '1' } });
  assert.equal(mismatched.action, 'hold');
  await docker('network', 'connect', networkIds[1], id);
  assert.deepEqual(await verify(), before);
  assert.equal((await inspectControlPlaneDatabase(desired)).move.attachedToTarget, true);
  await moveControlPlaneDatabase(desired, plan.move);
  report.checks.push('The native transition reported completion');
  assert.deepEqual(await verify(), before);
  assert.equal((await inspectControlPlaneDatabase(desired)).action, 'retain');
  const afterRestart = await docker('container', 'inspect', id, '--format', '{{.State.StartedAt}}');
  assert.notEqual(afterRestart, plan.move.startedAt);
  await moveControlPlaneDatabase(desired, plan.move);
  assert.equal(await docker('container', 'inspect', id, '--format', '{{.State.StartedAt}}'), afterRestart);
  report.checks.push('An interrupted connect resumes, preserves the SQL cluster and row, and replay does not restart twice');
  await docker('network', 'connect', networkIds[0], id);
  await docker('network', 'disconnect', networkIds[1], id);
  await restartContainer(id);
  await ready();
  const pending = await inspectControlPlaneDatabase(desired);
  assert.equal(pending.action, 'move-network');
  await docker('network', 'connect', networkIds[1], id);
  await docker('network', 'disconnect', networkIds[0], id);
  // A controller can disappear after detach. Linux may already route correctly;
  // on OrbStack the next cold start must restore the missing host publication.
  const resumed = await inspectControlPlaneDatabase(desired);
  assert(['retain', 'move-network'].includes(resumed.action), JSON.stringify(resumed));
  await moveControlPlaneDatabase(desired, pending.move);
  assert.deepEqual(await verify(), before);
  report.checks.push('Cold startup after an interrupted detach recovers the original SQL cluster');
  await restartContainer(id); await ready();
  assert.equal((await inspectControlPlaneDatabase(desired)).action, 'retain');
  assert.deepEqual(await verify(), before);
  const networks = JSON.parse(await docker('container', 'inspect', id, '--format', '{{json .NetworkSettings.Networks}}'));
  assert.deepEqual(Object.keys(networks), [target]);
  report.checks.push('Host SQL, cluster identity and the stored row survive migration and a native restart');
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
