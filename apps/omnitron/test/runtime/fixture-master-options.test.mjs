import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { initialRuntimeDirectories, readMasterFixture, removeOwnedFixtureRoot } from './fixture-master-options.mjs';
import { reserveDaemonPorts } from './fixture-ports.mjs';
import { preparationOption } from './fixture-preparation.mjs';
const db = 'postgresql://fixture:synthetic-test-secret@127.0.0.1:45509/fixture';
const baseConfig = { port: 45500, httpPort: 45501, role: 'master', host: '127.0.0.1',
  auth: { jwtSecret: 'synthetic-only' }, releaseStore: { endpoint: 'http://127.0.0.1:45510', bucket: 'fixture',
    accessKey: { secret: 'fixture.access' }, secretKey: { secret: 'fixture.secret' } } };
async function fixture(t, change = {}) {
  const parent = await fs.mkdtemp(path.join(await fs.realpath('/tmp'), 'omni-m-'));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const scenario = path.join(parent, 'scenario.mjs'), config = path.join(parent, 'config.json'), root = path.join(parent, 'm');
  await fs.writeFile(scenario, 'export async function managedMasterScenario(){throw Error("must not execute in input tests")}', { mode: 0o600 });
  await fs.writeFile(config, JSON.stringify({ ...baseConfig, ...change }), { mode: 0o600 });
  return { parent, root, scenario, config,
    argv: ['/sealed/omnitron-handoff-a/dist', '/sealed/omnitron-handoff-a/dist', '--master-scenario', scenario, '--fixture-root', root, '--master-config', config] };
}
test('master inputs preserve store/auth, pin private execution and do not create any fixture or execute scenario', async t => {
  const f = await fixture(t); const master = await readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db });
  assert.deepEqual(master.daemonConfig.auth, baseConfig.auth); assert.deepEqual(master.daemonConfig.releaseStore, baseConfig.releaseStore);
  assert.equal(master.daemonConfig.host, '127.0.0.1'); assert.equal(master.daemonConfig.role, 'master'); assert.equal(master.daemonConfig.webapp, false);
  assert.deepEqual(master.daemonConfig.executionHost, { enabled: true, directory: path.join(f.root, 'e') });
  assert.deepEqual(master.requestedPorts, { httpPort: 45501, ports: [45500] });
  await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
});
test('default and legacy roundtrip modes remain unselected', async () => {
  assert.equal(await readMasterFixture(['/a', '/b', '--owner-roundtrip'], {}), undefined);
  assert.equal(await readMasterFixture(['/a', '/b', '--backend-only'], {}), undefined);
});
test('ordinary guardian/backend qualification preserves independently selected initial roles', () => {
  const owner = '/sealed/omnitron-handoff-owner/packages/0/dist';
  const backend = '/sealed/omnitron-handoff-backend/packages/0/dist';
  const guardian = '/sealed/omnitron-handoff-guardian/packages/0/dist';
  const candidate = '/sealed/omnitron-handoff-candidate/packages/0/dist';
  for (const mode of [[], ['--backend-only'], ['--owner-roundtrip']]) {
    const argv = [owner, candidate, ...mode, '--initial-backend', backend, '--initial-guardian', guardian];
    assert.deepEqual(initialRuntimeDirectories(argv, owner, candidate), { initialBackendDist: backend, initialGuardianDist: guardian });
  }
  assert.deepEqual(initialRuntimeDirectories([owner, candidate], owner, candidate),
    { initialBackendDist: owner, initialGuardianDist: owner });
  assert.deepEqual(initialRuntimeDirectories([owner, candidate, '--initial-backend', backend], owner, candidate),
    { initialBackendDist: backend, initialGuardianDist: owner });
  assert.deepEqual(initialRuntimeDirectories([owner, candidate, '--initial-guardian', guardian], owner, candidate),
    { initialBackendDist: owner, initialGuardianDist: guardian });
});
test('reviewed recovery preparation is explicit, isolated and cannot be combined with another native scenario', () => {
  const inputs = ['/sealed/omnitron-handoff-owner', '/sealed/omnitron-handoff-candidate'];
  assert.deepEqual(preparationOption([...inputs, '--reviewed-recovery', '--prepare-only'], {}), { mode: 'prepare' });
  assert.deepEqual(preparationOption([...inputs, '--reviewed-recovery', '--prepared', '/private/preparation.json'], {}),
    { mode: 'execute', receipt: '/private/preparation.json' });
  for (const extra of ['--owner-roundtrip', '--backend-only', '--master-scenario', '--reviewed-recovery'])
    assert.throws(() => preparationOption([...inputs, '--reviewed-recovery', '--prepare-only', extra], {}));
  assert.throws(() => preparationOption([...inputs, '--reviewed-recovery', '--prepare-only'], { OMNITRON_HOME: '/live' }),
    /must not override/);
});
test('initial role selection rejects missing, duplicated and non-fixture runtime inputs', () => {
  const owner = '/sealed/omnitron-handoff-owner/packages/0/dist';
  const candidate = '/sealed/omnitron-handoff-candidate/packages/0/dist';
  const selected = '/sealed/omnitron-handoff-selected/packages/0/dist';
  for (const flag of ['--initial-backend', '--initial-guardian']) {
    for (const suffix of [[flag], [flag, '--backend-only'], [flag, selected, flag, selected], [flag, '/live/runtime/packages/0/dist']])
      assert.throws(() => initialRuntimeDirectories([owner, candidate, ...suffix], owner, candidate));
    assert.throws(() => initialRuntimeDirectories([owner, flag, selected], owner, undefined), /requires a candidate/);
  }
});
for (const [name, change] of Object.entries({ scope: { scope: 'system' }, socket: { socketPath: '/other/socket' }, environment: { environment: {} },
  role: { role: 'slave' }, host: { host: '0.0.0.0' }, cluster: { cluster: { enabled: true } },
  execution: { executionHost: { enabled: true, directory: '/other/execution' } }, auth: { auth: { jwtSecret: 'synthetic-only', unknown: true } },
  port: { port: 45503 }, store: { releaseStore: { ...baseConfig.releaseStore, accessKey: 'literal' } } })) {
  test(`rejects ${name} override before any root creation`, async t => {
    const f = await fixture(t, change); await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db }));
    await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
  });
}
test('rejects mixed modes, unknown/duplicate flags and incomplete groups', async t => {
  const f = await fixture(t);
  for (const argv of [[...f.argv, '--owner-roundtrip'], [...f.argv, '--unexpected', 'value'], [...f.argv, '--fixture-root', f.root], f.argv.slice(0, -2)])
    await assert.rejects(readMasterFixture(argv, { OMNITRON_DATABASE_URL: db }));
  await assert.rejects(readMasterFixture(['/a', '/b', '--fixture-root', f.root], {}));
});
test('rejects nonprivate or symlinked config; parse errors do not disclose contents', async t => {
  const f = await fixture(t); await fs.chmod(f.config, 0o644); await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db }), /private 0600/);
  await fs.chmod(f.config, 0o600); const link = path.join(f.parent, 'link'); await fs.symlink(f.config, link);
  await assert.rejects(readMasterFixture([...f.argv.slice(0, -1), link], { OMNITRON_DATABASE_URL: db }), /symlinks/);
  await fs.writeFile(f.config, '{"secret":"NEVER_PRINT_TEST_VALUE",');
  await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db }), error => !String(error).includes('NEVER_PRINT_TEST_VALUE') && /valid JSON/.test(String(error)));
});
test('requires absent owned root and bounded UDS; rejects parent symlinks', async t => {
  const f = await fixture(t); await fs.mkdir(f.root); await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db }), /must be absent/); await fs.rmdir(f.root);
  const long = [...f.argv]; long[5] = path.join(f.parent, 'x'.repeat(80)); await assert.rejects(readMasterFixture(long, { OMNITRON_DATABASE_URL: db }), /100 bytes/);
  const alias = path.join(f.parent, 'alias'); await fs.symlink(f.parent, alias); const linked = [...f.argv]; linked[5] = path.join(alias, 'm');
  await assert.rejects(readMasterFixture(linked, { OMNITRON_DATABASE_URL: db }), /symlinks/);
});
test('requires separate explicit loopback PG, without opening a database', async t => {
  const f = await fixture(t);
  for (const value of [undefined, '', 'postgresql://x:private@remote.invalid:5555/db', 'postgresql://x:private@127.0.0.1:45500/db'])
    await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: value }));
});
test('rejects URLs that would fall back to the SDK default database without disclosing credentials', async t => {
  const f = await fixture(t);
  const secret = 'NEVER_PRINT_DATABASE_VALUE';
  for (const value of [
    `postgresql://fixture:${secret}@127.0.0.1:0/fixture`,
    `postgresql://fixture:${secret}@127.0.0.1:45509/%ZZ`,
    `postgresql://%ZZ:${secret}@127.0.0.1:45509/fixture`,
    `postgresql://fixture:${secret}%ZZ@127.0.0.1:45509/fixture`,
    `postgresql://fixture:${secret}%C0%AF@127.0.0.1:45509/fixture`,
    `postgresql://fixture:${secret}@127.0.0.1:45509/fixture?host=remote.invalid`,
    `postgresql://fixture:${secret}@127.0.0.1:45509/fixture#different-db`,
  ]) {
    await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: value }), error => !String(error).includes(secret));
    await assert.rejects(fs.stat(f.root), { code: 'ENOENT' });
  }
  const escaped = 'postgresql://fixture%2Duser:synthetic%40secret@127.0.0.1:45509/fixture%2Ddb';
  const master = await readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: escaped });
  assert.equal(master.databaseUrl, escaped);
});
test('invalid booleans do not disclose their supplied values', async t => {
  const secret = 'NEVER_PRINT_BOOLEAN_VALUE';
  for (const change of [{ cluster: { enabled: secret } }, { executionHost: { enabled: secret } }]) {
    const f = await fixture(t, change);
    await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db }), error => !String(error).includes(secret));
  }
});
test('master preserves an explicit Unix Docker endpoint and clears competing ambient selectors', async t => {
  const f = await fixture(t);
  const master = await readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db,
    DOCKER_HOST: 'unix:///var/run/docker.sock', DOCKER_CONTEXT: 'ambient-context' });
  assert.deepEqual(master.dockerEnvironment, { DOCKER_HOST: 'unix:///var/run/docker.sock',
    DOCKER_CONTEXT: '', DOCKER_TLS_VERIFY: '', DOCKER_CERT_PATH: '' });
  assert.equal((await readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db })).dockerEnvironment, undefined);
  for (const host of ['tcp://remote.invalid:2375', 'unix://remote.invalid/tmp/docker.sock',
    'unix:///tmp/../var/run/docker.sock', 'unix:///tmp/docker.sock?x', 'unix:///tmp/docker.sock\n', 'unix:///tmp/docker\0.sock']) {
    await assert.rejects(readMasterFixture(f.argv, { OMNITRON_DATABASE_URL: db, DOCKER_HOST: host }), /canonical Unix socket/);
  }
});
test('cleanup removes only the exact owned root and rejects replacements', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.parent, 'parent-receipt'), 'preserved');
  await fs.mkdir(f.root); const identity = await fs.lstat(f.root); await fs.rename(f.root, f.root + '-old'); await fs.mkdir(f.root);
  await assert.rejects(removeOwnedFixtureRoot(f.root, identity), /identity changed/); await fs.rmdir(f.root); await fs.rename(f.root + '-old', f.root);
  await removeOwnedFixtureRoot(f.root, identity); assert.equal(await fs.readFile(path.join(f.parent, 'parent-receipt'), 'utf8'), 'preserved');
});
function fakeSockets(blocked) {
  const held = new Set(), closed = [], bound = []; let next = 46000;
  const createServer = () => {
    let port, error;
    return { once(event, listener) { assert.equal(event, 'error'); error = listener; },
      listen(requested, host, ready) {
        assert.equal(host, '127.0.0.1'); if (!requested) { while (held.has(next)) next++; requested = next++; }
        if (requested === blocked || held.has(requested)) { queueMicrotask(() => error(Object.assign(Error('busy'), { code: 'EADDRINUSE' }))); return; }
        port = requested; held.add(port); bound.push(port); queueMicrotask(ready);
      }, address() { return { port }; }, unref() { return this; }, close(done) { assert.ok(held.delete(port)); closed.push(port); queueMicrotask(done); } };
  };
  return { createServer, held, closed, bound };
}
test('reserves exact HTTP four-port range plus TCP; release closes each socket once', async () => {
  const fake = fakeSockets(); const r = await reserveDaemonPorts(1, { httpPort: 45501, ports: [45500] }, fake.createServer);
  assert.deepEqual(fake.bound, [45501, 45502, 45503, 45504, 45500]); await r.release(); await r.release(); assert.equal(fake.closed.length, 5); assert.equal(fake.held.size, 0);
});
test('exact busy ports fail without random fallback and release all earlier reservations', async () => {
  const fake = fakeSockets(45503); await assert.rejects(reserveDaemonPorts(1, { httpPort: 45501, ports: [45500] }, fake.createServer), /busy/);
  assert.deepEqual(fake.bound, [45501, 45502]); assert.deepEqual(fake.closed, fake.bound); assert.equal(fake.held.size, 0);
});
test('legacy dynamic reservation remains contiguous and releases once', async () => {
  const fake = fakeSockets(); const r = await reserveDaemonPorts(2, undefined, fake.createServer);
  assert.deepEqual(fake.bound.slice(0, 4), [r.httpPort, r.httpPort + 1, r.httpPort + 2, r.httpPort + 3]); assert.equal(r.ports.length, 2);
  await r.release(); await r.release(); assert.equal(fake.closed.length, 6);
});
