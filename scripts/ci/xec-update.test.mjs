import assert from 'node:assert/strict';
import { withLocalRuntime } from '../../.xec/local-runtime.mjs';
import { within } from '@xec-sh/core';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { releaseCommand, ReleaseCommandError } from '@xec-sh/ops/release';
import { command as registerUpdate } from '../../.xec/commands/update.js';
import { locateQualifiedLocalRuntime } from '../../.xec/qualification.mjs';
import { runtimeArtifactDigest, verifyRuntimeArtifact } from '../../apps/omnitron/src/shared/runtime-artifact.ts';

const { Command } = createRequire(import.meta.resolve('@xec-sh/cli'))('commander');

async function runUpdate(args, options = {}) {
  const program = new Command().exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
  const outputs = [];
  registerUpdate(program, { ...options, progress(value) { outputs.push(value); options.progress?.(value); } });
  await program.parseAsync(['update', ...args], { from: 'user' });
  return outputs.length ? JSON.parse(outputs.at(-1)) : undefined;
}

test('update help and validation are owned by the registered native command tree', async () => {
  const output = [];
  const program = new Command().exitOverride().configureOutput({ writeOut: text => output.push(text), writeErr() {} });
  registerUpdate(program, { run() { throw Error('Help must not execute'); } });
  await assert.rejects(program.parseAsync(['update', 'local-sync', '--help'], { from: 'user' }),
    error => error.code === 'commander.helpDisplayed' && error.exitCode === 0);
  assert.match(output.join(''), /Usage:.*update local-sync/);
  assert.match(output.join(''), /--review <sha256>/);
  let calls = 0;
  for (const args of [
    ['plan', 'a'.repeat(40)], ['unknown'], ['status', 'one', 'two'],
    ['local-sync', 'unexpected'], ['local-apply', '--review', 'a'.repeat(64)],
    ['local-sync', '--status', '--cache-dir', '/never-build'], ['local-sync', '--review'],
  ]) await assert.rejects(runUpdate(args, { run() { calls++; throw Error('Parser must reject before effects'); } }),
    error => error.code?.startsWith('commander.'));
  assert.equal(calls, 0);
});

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
  await runUpdate(['local-sync', '--review', digest, '--reconcile', '--cli', '/operator/omnitron'], options);
  assert.deepEqual(calls, [
    ['--json', 'runtime', 'update', 'status'], ['--json', 'runtime', 'update', 'recover', digest],
    ['--json', 'runtime', 'update', 'reconcile', digest],
  ]);
  await assert.rejects(runUpdate(['local-sync', '--status', '--review', digest], options), /cannot be used with option/);
  await assert.rejects(runUpdate(['local-apply', '--review', digest], options), /unknown option/);
  await assert.rejects(runUpdate(['local-sync', '--reconcile', '--rollback', '--review', digest], options), /cannot be used with option/);
  await assert.rejects(runUpdate(['local-sync', '--reconcile'], options), /requires the exact/);
  assert.equal(calls.length, 3);
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

test('target-specific preparation refusals survive Xec with their complete review', async () => {
  const review = { digest: null, targets: [{ node: 'local', reason: 'Pinned declarations changed' }] };
  const output = [];
  let calls = 0;
  await assert.rejects(runUpdate(['local-sync', '--status', '--cli', '/operator/omnitron'], {
    progress: value => output.push(value),
    run: async () => { calls++; throw new ReleaseCommandError('omnitron', 1, JSON.stringify({ ok: true, data: review }), ''); },
  }), error => error.isUserError && error.exitCode === 1 && error.message === 'local: Pinned declarations changed');
  assert.deepEqual(JSON.parse(output[0]), review);
  assert.equal(calls, 1);
});

test('check builds one isolated local revision and apply consumes the same verified bytes', { skip: !['linux', 'darwin'].includes(process.platform) }, async t => {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-development-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const commit = 'b'.repeat(40), events = [];
  let dist, dirty = false;
  const options = { progress() {}, run: async (_root, executable, args) => {
    events.push([executable, ...args]);
    if (executable === '/bin/rm') return releaseCommand(_root, executable, args);
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
  assert(!(await fs.readdir(cache)).some(entry => entry.startsWith('.build-')), 'isolated source cleanup must finish before admission');
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

async function finalizationFixture(t, hooks = {}) {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-runtime-finalization-'));
  t.after(() => fs.rm(cache, { recursive: true, force: true }));
  const commit = 'd'.repeat(40);
  const run = async (root, executable, args, options) => {
    if (executable === '/bin/rm') {
      await hooks.cleanup?.(options);
      await fs.rm(args.at(-1), { recursive: true, force: true });
      return '';
    }
    if (args[0] === 'rev-parse') return commit;
    if (args[0] === 'status') return '';
    if (executable === 'pnpm' && args[0] === 'install') await hooks.build?.();
    if (args[0] === '--conditions=omnitron-source') return JSON.stringify(await verifyRuntimeArtifact(args.at(-1)));
    if (args[0]?.endsWith('/freeze-backend.mjs')) {
      const directory = args[2];
      for (const subpath of ['dist', 'webapp/dist']) {
        const out = path.join(directory, 'packages/0', subpath);
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(path.join(out, 'BUILD.json'), JSON.stringify({ commit, dirty: false }));
      }
      await fs.writeFile(path.join(directory, 'RUNTIME.json'), JSON.stringify({ protocol: 1,
        sha256: await runtimeArtifactDigest(directory), platform: process.platform, arch: process.arch, nodeVersion: process.version }));
    }
    return '';
  };
  return { cache, run, directory: path.join(cache, [commit, process.platform, process.arch, process.version].join('-')) };
}

const finalizationOptions = { skip: !['linux', 'darwin'].includes(process.platform), timeout: 10_000 };
test('Xec prepares the published runtime while joining checkout cleanup', finalizationOptions, async t => {
  let release, started;
  const gate = new Promise(resolve => { release = resolve; }), cleaning = new Promise(resolve => { started = resolve; });
  let cleaned = false;
  const fixture = await finalizationFixture(t, { cleanup: async options => {
    assert(options.signal instanceof AbortSignal); started(); await gate; cleaned = true;
  } });
  const value = await withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async (dist, signal) => {
    assert(signal instanceof AbortSignal);
    await cleaning;
    assert.equal(cleaned, false);
    assert.equal(dist, path.join(fixture.directory, 'packages/0/dist'));
    await verifyRuntimeArtifact(fixture.directory);
    release(); return 'prepared';
  }, { prepareWhileCleaning: true });
  assert.equal(value, 'prepared'); assert.equal(cleaned, true);
  assert(!(await fs.readdir(fixture.cache)).some(file => file.startsWith('.build-')));
});

test('a prepare refusal still joins cleanup and preserves both failures', finalizationOptions, async t => {
  let release, refused;
  const gate = new Promise(resolve => { release = resolve; }), preparation = new Promise(resolve => { refused = resolve; });
  const fixture = await finalizationFixture(t, { cleanup: async () => { await gate; throw Error('cleanup failure'); } });
  let finished = false;
  const result = withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => {
    refused(); throw Error('prepare refusal');
  }, { prepareWhileCleaning: true });
  const observed = result.then(() => { finished = true; }, error => { finished = true; return error; });
  await preparation; await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false); release();
  const error = await observed;
  assert(error instanceof AggregateError);
  assert.deepEqual(error.errors.map(item => item.message).sort(), ['cleanup failure', 'prepare refusal']);
  await verifyRuntimeArtifact(fixture.directory);
});

test('cleanup failure cannot silently turn a prepared receipt into success or delete its runtime', finalizationOptions, async t => {
  let preparations = 0;
  const fixture = await finalizationFixture(t, { cleanup: async () => { throw Error('cleanup failure'); } });
  await assert.rejects(withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => {
    preparations++; return { digest: 'e'.repeat(64) };
  }, { prepareWhileCleaning: true }), error => error instanceof AggregateError && error.errors[0].message === 'cleanup failure');
  assert.equal(preparations, 1); await verifyRuntimeArtifact(fixture.directory);
});

test('build failure never starts preparation and retains a cleanup failure as a separate cause', finalizationOptions, async t => {
  const fixture = await finalizationFixture(t, { build: async () => { throw Error('build failure'); },
    cleanup: async () => { throw Error('cleanup failure'); } });
  await assert.rejects(withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => assert.fail('unbuilt runtime'),
    { prepareWhileCleaning: true }), error => error instanceof AggregateError &&
      error.errors.map(item => item.message).join(',') === 'build failure,cleanup failure');
});

test('effecting consumers wait for cleanup and do not run if it fails', finalizationOptions, async t => {
  const fixture = await finalizationFixture(t, { cleanup: async () => { throw Error('cleanup failure'); } });
  await assert.rejects(withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => assert.fail('activation must wait')),
    /cleanup failure/);
});

test('cancellation after a callback retains the pipeline outcome even without a callback exception', finalizationOptions, async t => {
  const fixture = await finalizationFixture(t), controller = new AbortController();
  await assert.rejects(within({ signal: controller.signal }, () =>
    withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => {
      controller.abort(new Error('operator cancelled preparation')); return 'observed';
    }, { prepareWhileCleaning: true })), error => {
      assert(error instanceof AggregateError);
      assert.equal(error.cause.status, 'cancelled');
      assert(error.cause.steps.some(step => step.cancelled && step.error));
      return true;
    });
  await verifyRuntimeArtifact(fixture.directory);
});
