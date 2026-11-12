import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { assertReleaseVersionAvailable } from '../../.xec/release-registry.js';

const packages = Array.from({ length: 35 }, (_, index) => ({ name: `@fixture/package-${index}`, version: '0.3.5' }));

function document(name, versions, latest, extraTags = {}) {
  return { name, 'dist-tags': { latest, ...extraTags }, versions: Object.fromEntries(versions.map(version => [version, { name, version }])) };
}

async function registryFixture(t, reply) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'release-registry-'));
  const requests = [];
  const server = http.createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1));
    requests.push({ name, method: request.method });
    response.setHeader('content-type', 'application/json');
    if (request.method !== 'GET') { response.writeHead(405).end('{"error":"read only"}'); return; }
    const result = reply(name);
    response.writeHead(result.status ?? 200).end(JSON.stringify(result.body));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const registry = `http://127.0.0.1:${server.address().port}/`;
  const npmrc = path.join(directory, 'npmrc');
  // A caller's scoped registry must not divert the explicit release registry.
  await fs.writeFile(npmrc, '@fixture:registry=http://127.0.0.1:1/\nfetch-retries=0\nupdate-notifier=false\n');
  const env = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc, NPM_CONFIG_CACHE: path.join(directory, 'cache'),
    npm_config_userconfig: npmrc, npm_config_cache: path.join(directory, 'cache') };
  const options = { registry, env, run: (cwd, executable, args, settings) => releaseCommand(cwd, executable, args, { ...settings, timeoutMs: 15_000 }) };
  return { directory, requests, options };
}

test('real npm checks every public package and admits an unused common version without mutations', { timeout: 60_000 }, async t => {
  const fixture = await registryFixture(t, name => name.endsWith('-34')
    ? { status: 404, body: { error: 'not found' } }
    : { body: document(name, ['0.3.5', '0.4.0', '0.4.1', '0.4.2', '0.4.3', '0.4.4', '0.4.5'], '0.3.5') });
  await assertReleaseVersionAvailable(fixture.directory, packages, '0.4.6', fixture.options);
  assert.deepEqual(new Set(fixture.requests.map(request => request.name)), new Set(packages.map(pkg => pkg.name)));
  assert.ok(fixture.requests.every(request => request.method === 'GET'));
});

test('a historical version on the last package refuses preparation even when latest is older', { timeout: 60_000 }, async t => {
  const fixture = await registryFixture(t, name => ({ body: document(name,
    name.endsWith('-34') ? ['0.3.5', '0.4.1', '0.4.5'] : ['0.3.5'], '0.3.5') }));
  let prepared = false;
  await assert.rejects(async () => {
    await assertReleaseVersionAvailable(fixture.directory, packages, '0.4.1', fixture.options);
    prepared = true;
  }, /@fixture\/package-34@0\.4\.1: this version already exists/);
  assert.equal(prepared, false);
  assert.deepEqual(new Set(fixture.requests.map(request => request.name)), new Set(packages.map(pkg => pkg.name)));
  assert.ok(fixture.requests.every(request => request.method === 'GET'));
});

test('real npm rejects a latest downgrade and preserves independent prerelease channels', { timeout: 30_000 }, async t => {
  const fixture = await registryFixture(t, name => ({ body: document(name, ['0.4.10', '0.4.6-rc.1'], '0.4.10', { rc: '0.4.6-rc.1' }) }));
  await assert.rejects(assertReleaseVersionAvailable(fixture.directory, packages.slice(0, 1), '0.4.6', fixture.options), /latest is already 0\.4\.10/);
  await assertReleaseVersionAvailable(fixture.directory, packages.slice(0, 1), '0.4.6-rc.2', fixture.options);
  await assert.rejects(assertReleaseVersionAvailable(fixture.directory, packages.slice(0, 1), '0.4.6-rc.0', fixture.options), /rc is already 0\.4\.6-rc\.1/);
});

test('real npm permission errors refuse admission instead of pretending the package is absent', { timeout: 30_000 }, async t => {
  const fixture = await registryFixture(t, () => ({ status: 403, body: { error: 'forbidden' } }));
  await assert.rejects(assertReleaseVersionAvailable(fixture.directory, packages.slice(0, 1), '0.4.6', fixture.options),
    error => /Cannot verify registry availability/.test(error.message) && error.cause instanceof ReleaseCommandError);
});

test('malformed registry replies and transport failures cannot authorize a new release', async () => {
  const pkg = packages[0];
  const valid = { name: pkg.name, versions: ['0.3.5'], 'dist-tags': { latest: '0.3.5' } };
  for (const text of ['not json', 'null', '{}', '[]', JSON.stringify({ ...valid, name: '@fixture/other' }),
    JSON.stringify({ ...valid, versions: [] }), JSON.stringify({ ...valid, versions: ['^0.3.5'] }),
    JSON.stringify({ ...valid, 'dist-tags': { latest: '0.8.0' } })]) {
    await assert.rejects(assertReleaseVersionAvailable('.', [pkg], '0.4.6', { run: async () => text }), /Invalid npm metadata/);
  }
  for (const error of [new Error('network disconnected'), new ReleaseCommandError('npm', 1, '{"error":{"code":"E401"}}', ''),
    new ReleaseCommandError('npm', 1, 'invalid error response', 'E404'),
    Object.assign(new Error('not a registry response'), { stdout: '{"error":{"code":"E404"}}' })]) {
    await assert.rejects(assertReleaseVersionAvailable('.', [pkg], '0.4.6', { run: async () => { throw error; } }),
      refused => /Cannot verify registry availability/.test(refused.message) && refused.cause === error);
  }
});

test('the entire local inventory and target version are validated before any registry request', async () => {
  let calls = 0;
  const options = { run: async () => { calls++; throw Error('unexpected request'); } };
  for (const inventory of [[], [...packages, packages[0]], [...packages, { name: '../escape', version: '0.3.5' }],
    [...packages, { name: '@fixture/last', version: '^0.3.5' }]]) {
    await assert.rejects(assertReleaseVersionAvailable('.', inventory, '0.4.6', options));
  }
  for (const version of ['next', 'v0.4.6', '0.4.6+build'])
    await assert.rejects(assertReleaseVersionAvailable('.', packages, version, options));
  assert.equal(calls, 0);
});
