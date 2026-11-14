import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ReleaseCommandError } from '@xec-sh/ops/release';
import { runUpdate } from '../../.xec/update.mjs';
import { locateQualifiedLocalRuntime } from '../../.xec/qualification.mjs';
import { runtimeArtifactDigest, verifyRuntimeArtifact } from '../../apps/omnitron/src/shared/runtime-artifact.ts';

test('local status and recovery use the public CLI without a build or private instance reads', async () => {
  const digest = 'e'.repeat(64);
  const calls = [];
  const status = { prepared: null, receipt: { digest, phase: 'recovery-required' }, runtime: { artifact: 'a'.repeat(64) } };
  const options = { progress() {}, run: async (_root, command, args) => {
    assert.equal(command, '/operator/omnitron');
    calls.push(args);
    return JSON.stringify({ ok: true, data: status });
  } };
  assert.deepEqual(await runUpdate(['local-sync', '--status', '--cli', '/operator/omnitron'], options), status);
  await runUpdate(['local-sync', '--review', digest, '--rollback', '--cli', '/operator/omnitron'], options);
  assert.deepEqual(calls, [
    ['--json', 'runtime', 'update', 'status'], ['--json', 'runtime', 'update', 'recover', digest],
  ]);
  await assert.rejects(runUpdate(['local-sync', '--status', '--review', digest], options), /xec update local-sync/);
  await assert.rejects(runUpdate(['local-apply', '--review', digest], options), /belong to local-sync/);
  assert.equal(calls.length, 2);
});

test('Xec stages a reviewed candidate through Omnitron without activating or using SSH', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-managed-update-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const commit = 'a'.repeat(40), id = '12345678-1234-1234-1234-123456789abc';
  const runtime = path.join(root, 'runtime with spaces');
  await fs.mkdir(path.join(runtime, 'packages/0/dist'), { recursive: true });
  await fs.writeFile(path.join(runtime, 'packages/0/dist/BUILD.json'), JSON.stringify({ commit, dirty: false }));
  const calls = [];
  const options = { root, progress() {}, run: async (_root, executable, args) => {
    assert.equal(executable, 'omnitron');
    calls.push(args);
    assert.ok(!args.includes('--apply'));
    return JSON.stringify({ ok: true, data: args.includes('plan') ? { id, commit, state: 'planned' } : [] });
  } };
  await runUpdate(['plan', commit, '--runtime', runtime, '--node', 'worker-a', '--request-id', id], options);
  assert.deepEqual(calls[0], ['--json', 'fleet', 'rollout', 'import', runtime]);
  assert.deepEqual(calls[1], ['--json', 'fleet', 'rollout', 'plan', commit, 'worker-a', '--stage', '--wait', '--request-id', id]);
  const count = calls.length;
  await assert.rejects(runUpdate(['plan', commit, '--runtime', runtime, '--node=--apply'], options), /not command options/);
  await assert.rejects(runUpdate(['plan', 'b'.repeat(40), '--runtime', runtime, '--node', 'worker-a'], options), /Runtime source differs/);
  assert.equal(calls.length, count);
});

test('activation and reconciliation delegate exactly once; local check cannot imply apply', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const calls = [];
  const options = { progress() {}, run: async (_root, command, args) => {
    if (args[0] === '--conditions=omnitron-source') return '{}';
    if (args.includes('backend')) assert.equal(command, '/private/runtime/node');
    else assert.equal(command, 'omnitron');
    calls.push(args);
    return JSON.stringify({ ok: true, data: { id } });
  } };
  await runUpdate(['apply', id], options);
  await runUpdate(['reconcile', id], options);
  await runUpdate(['local-check', '/private/runtime/packages/0/dist'], options);
  assert.deepEqual(calls, [
    ['--json', 'fleet', 'rollout', 'apply', id, '--wait'],
    ['--json', 'fleet', 'rollout', 'reconcile', id],
    ['/private/runtime/packages/0/dist/cli/omnitron.js', '--json', 'backend', 'upgrade', '/private/runtime/packages/0/dist', '--check'],
  ]);
  await assert.rejects(runUpdate(['apply', '--apply'], options));
  const failed = { ...options, run: async () => { throw Error('connection lost'); } };
  await assert.rejects(runUpdate(['apply', id], failed), /connection lost/);
});


test('controller refusals preserve structured receipts, nonzero status and the actual reason', async () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const receipt = { id, state: 'blocked', reason: 'Migration sets differ', targets: [{ name: 'worker-a', state: 'blocked' }] };
  const output = [], calls = [];
  let reply = { ok: true, data: receipt };
  const options = { progress: message => output.push(message), run: async (_root, _cmd, args) => {
    if (args[0] === '--conditions=omnitron-source') return '{}';
    calls.push(args);
    throw new ReleaseCommandError('omnitron', reply.ok ? 1 : 7, reply.ok ? JSON.stringify(reply) : '', reply.ok ? '' : JSON.stringify(reply));
  } };
  await assert.rejects(runUpdate(['status', id], options), error =>
    error.isUserError && error.exitCode === 1 && error.message === receipt.reason);
  assert.deepEqual(JSON.parse(output[0]), receipt);
  reply = { ok: false, error: 'Prepare a compatible database transition' };
  await assert.rejects(runUpdate(['local-check', '/private/runtime/packages/0/dist'], options), error =>
    error.isUserError && error.exitCode === 7 && error.message === reply.error);
  assert.equal(calls.length, 2, 'a refusal cannot replay an operation');
  await assert.rejects(runUpdate(['local-check', '/private/runtime/packages/0/dist', '--cli', '/old/omnitron'], options), /its own CLI/);
  assert.equal(calls.length, 2);
  const transport = new ReleaseCommandError('omnitron', 2, 'incomplete response', 'connection lost');
  await assert.rejects(runUpdate(['apply', id], { ...options, run: async () => { throw transport; } }), error => error === transport);
});

test('check builds one isolated local revision and apply consumes the same verified bytes', { skip: !['linux', 'darwin'].includes(process.platform) }, async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-development-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const commit = 'b'.repeat(40), events = [];
  let dist, dirty = false;
  const options = { progress() {}, run: async (_root, executable, args) => {
    events.push([executable, ...args]);
    if (args[0] === '--conditions=omnitron-source') return JSON.stringify(await verifyRuntimeArtifact(args.at(-1)));
    if (args[0] === 'rev-parse') return commit;
    if (args[0] === 'status') return dirty ? ' M pkg.ts' : '';
    if (args[0]?.endsWith('/freeze-backend.mjs')) {
      const directory = args[2];
      for (const dir of ['dist', 'webapp/dist']) {
        const target = path.join(directory, 'packages/0', dir);
        await fs.mkdir(target, { recursive: true });
        await fs.writeFile(path.join(target, 'BUILD.json'), JSON.stringify({ commit, dirty: false }));
      }
      await fs.writeFile(path.join(directory, 'RUNTIME.json'), JSON.stringify({ protocol: 1, platform: process.platform,
        arch: process.arch, nodeVersion: process.version, sha256: await runtimeArtifactDigest(directory) }));
    }
    if (args.includes('update')) return JSON.stringify({ ok: true, data: { digest: 'a'.repeat(64) } });
    if (args.includes('upgrade')) { dist = args[args.indexOf('upgrade') + 1]; return '{"ok":true,"data":{}}'; }
    return '';
  } };
  await runUpdate(['local-check', '--cache-dir', cache], options);
  await runUpdate(['local-apply', '--cache-dir', cache], options);
  assert.equal(events.filter(([command, arg]) => command === 'pnpm' && arg === 'install').length, 1);
  assert.equal(events.filter(call => call.includes('upgrade')).length, 2);
  assert.ok(!events.some(call => call.includes('test') || call.includes('publish')));
  await runUpdate(['local-sync', '--cache-dir', cache], options);
  await runUpdate(['local-sync', '--cache-dir', cache, '--review', 'a'.repeat(64)], options);
  assert.deepEqual(events.filter(call => call.includes('update')).map(call => call.slice(-4)), [
    ['runtime', 'update', 'prepare', path.resolve(dist, '../../..')], ['runtime', 'update', 'apply', 'a'.repeat(64)],
  ]);
  assert.equal(events.filter(([command, arg]) => command === 'pnpm' && arg === 'install').length, 1);
  dirty = true;
  await assert.rejects(runUpdate(['local-apply', '--cache-dir', cache], options), /Commit the local changes/);
  dirty = false;
  await fs.appendFile(path.join(dist, 'BUILD.json'), ' ');
  await assert.rejects(runUpdate(['local-apply', '--cache-dir', cache], options), /changed after sealing/);
  assert.equal(events.filter(call => call.includes('upgrade')).length, 2);
});

test('local sync consumes the completed native release build without another build, copy or CI lookup',
  { skip: !['linux', 'darwin'].includes(process.platform) }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-qualified-local-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const commit = 'c'.repeat(40), cache = path.join(root, 'development');
    const identity = { schema: 1, commit, version: '0.4.8', node: process.version };
    const key = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    const selection = path.join(root, '.release-artifacts/qualification', commit);
    const directory = path.join(selection, key), build = path.join(directory, 'build');
    const runtime = path.join(build, 'runtime');
    for (const subpath of ['dist', 'webapp/dist']) {
      const target = path.join(runtime, 'packages/0', subpath);
      await fs.mkdir(target, { recursive: true });
      await fs.writeFile(path.join(target, 'BUILD.json'), JSON.stringify({ commit, dirty: false }));
    }
    const sha256 = await runtimeArtifactDigest(runtime);
    const producer = { nodeVersion: process.version, platform: process.platform, arch: process.arch };
    await fs.writeFile(path.join(runtime, 'RUNTIME.json'), JSON.stringify({ protocol: 1, ...producer, sha256 }));
    await fs.writeFile(path.join(build, 'QUALIFICATION.json'), JSON.stringify({
      revision: commit, independentBuilds: 2, node: process.version, sha256,
    }));
    await fs.writeFile(path.join(directory, 'qualification.json'), JSON.stringify({
      identity, completedAt: '2026-11-14T10:00:00Z',
    }));
    await fs.writeFile(path.join(selection, 'selected.json'), JSON.stringify({ identity, key }));
    const calls = [], progress = [];
    const options = { root, progress: message => progress.push(message), run: async (_root, executable, args) => {
      calls.push([executable, ...args]);
      if (args[0] === 'rev-parse') return commit;
      if (args[0] === 'status') return '';
      if (args[0] === '--conditions=omnitron-source') return JSON.stringify(await verifyRuntimeArtifact(args.at(-1)));
      assert.equal(executable, path.join(runtime, 'node'), 'only the verified native candidate may run');
      assert.deepEqual(args.slice(-4), ['runtime', 'update', 'prepare', runtime]);
      return '{"ok":true,"data":{"prepared":true}}';
    } };
    await runUpdate(['local-sync', '--cache-dir', cache], options);
    assert.equal(calls.filter(call => call.includes('--conditions=omnitron-source')).length, 1);
    assert(progress.includes('Using qualified local runtime ' + commit));
    assert(!(await fs.readdir(cache)).some(entry => entry === [commit, process.platform, process.arch, process.version].join('-')));
    assert.equal(await locateQualifiedLocalRuntime(root, commit, { ...producer, nodeVersion: 'v0.0.0' }), null);
    assert.equal(await locateQualifiedLocalRuntime(root, commit, { ...producer, arch: 'foreign' }), null);
    const count = calls.filter(call => call.includes('prepare')).length;
    await fs.appendFile(path.join(runtime, 'packages/0/dist/BUILD.json'), ' ');
    await assert.rejects(runUpdate(['local-sync', '--cache-dir', cache], options), /changed after sealing/);
    assert.equal(calls.filter(call => call.includes('prepare')).length, count);
    assert(!calls.some(([command]) => command === 'pnpm' || command === 'gh'), 'neither rebuilding nor CI is required');
    await fs.writeFile(path.join(selection, 'selected.json'), JSON.stringify({ identity, key: '../elsewhere' }));
    await assert.rejects(locateQualifiedLocalRuntime(root, commit, producer), /Invalid selected local qualification/);
  });
