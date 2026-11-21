import assert from 'node:assert/strict';
import { localCleanup, scheduleLocalCleanup } from '../../.xec/local-runtime-cleanup.mjs';
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

test('local recovery streams native progress before completion and preserves a structured refusal', async () => {
  const progress = [];
  const chunks = ['{"event":"runtime.update.progress","message":"checking', ' ownership"}\n',
    '{"event":"runtime.update.progress","message":"restoring"}\n'];
  const reason = 'controller ownership changed';
  const terminal = JSON.stringify({ ok: false, code: 'RUNTIME_OBSERVATION_CONFLICT', error: reason });
  const run = async (_root, exe, _args, options) => {
    assert.equal(options.env.OMNITRON_UPDATE_PROGRESS, '1');
    const output = (stream, text) => options.onEvent({ type: 'command-output', executable: exe, at: 0, stream, text });
    // A successful JSON reply may contain a field that happens to look like a progress frame.
    await output('stdout', '{"event":"runtime.update.progress","message":"not progress"}\n');
    for (const chunk of chunks) await output('stderr', chunk);
    assert.deepEqual(progress, ['checking ownership', 'restoring']);
    throw new ReleaseCommandError(exe, 1, '', chunks.join('') + terminal + '\n');
  };
  await assert.rejects(runUpdate(['local-sync', '--review', 'e'.repeat(64), '--rollback', '--cli', '/operator/omnitron'],
    { run, onProgress: message => progress.push(message) }), error => error.message === reason);
  assert.deepEqual(progress, ['checking ownership', 'restoring']);
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

test('local staging needs no serving backend and cannot select or activate the candidate', async () => {
  const calls = [];
  const options = { progress() {}, run: async (_root, executable, args) => {
    if (args[0] === '--conditions=omnitron-source') return '{}';
    assert.equal(executable, '/private/runtime/node');
    calls.push(args);
    return JSON.stringify({ ok: true, data: { id: 'a'.repeat(64), directory: '/installed' } });
  } };
  const installed = await runUpdate(['local-stage', '/private/runtime/packages/0/dist'], options);
  assert.equal(installed.id, 'a'.repeat(64));
  assert.deepEqual(calls, [['/private/runtime/packages/0/dist/cli/omnitron.js', '--json', 'backend', 'install', '/private/runtime']]);
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
    if (args[0] === '--conditions=omnitron-source' && args.includes('status')) {
      const directory = path.resolve(dist, '../../..');
      const { sha256: artifact } = await verifyRuntimeArtifact(directory);
      const target = { artifact, commit };
      return JSON.stringify({ ok: true, data: { prepared: { digest: args.at(-1), plan: { target } },
        receipt: null, runtime: { ...target, directory } } });
    }
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
  assert.deepEqual((await localCleanup(cache, { status: true })).jobs.map(job => job.state), ['cleaned']);
  await runUpdate(['local-apply', '--cache-dir', cache], options);
  assert.deepEqual(events.filter(([command]) => command === 'pnpm'), [
    ['pnpm', 'install', '--frozen-lockfile'],
    ['pnpm', 'exec', 'turbo', 'run', 'build', '--filter=@omnitron-dev/omnitron', '--filter=@omnitron/console'],
  ]);
  assert.equal(events.filter(call => call.includes('upgrade')).length, 2);
  assert.ok(!events.some(call => call.includes('test') || call.includes('publish')));
  await runUpdate(['local-sync', '--cache-dir', cache], options);
  await runUpdate(['local-sync', '--cache-dir', cache, '--review', 'a'.repeat(64)], options);
  assert.deepEqual(events.filter(call => call.includes('update')).map(call => call.slice(-4)), [
    ['runtime', 'update', 'prepare', path.resolve(dist, '../../..')], ['runtime', 'update', 'status', 'a'.repeat(64)],
    ['runtime', 'update', 'apply', 'a'.repeat(64)],
  ]);
  assert.equal(events.filter(([command, arg]) => command === 'pnpm' && arg === 'install').length, 1);
  dirty = true;
  await assert.rejects(runUpdate(['local-apply', '--cache-dir', cache], options), /Commit the local changes/);
  dirty = false;
  await fs.appendFile(path.join(dist, 'BUILD.json'), ' ');
  await assert.rejects(runUpdate(['local-apply', '--cache-dir', cache], options), /changed after sealing/);
  assert.equal(events.filter(call => call.includes('upgrade')).length, 2);
});

test('a reviewed update uses its installed producer with an empty cache and refuses a changed checkout or receipt', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'xec-reviewed-installation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const digest = 'd'.repeat(64), target = { artifact: 'b'.repeat(64), commit: 'a'.repeat(40) };
  const directory = path.join(root, 'releases', target.artifact);
  const dist = path.join(directory, 'packages/0/dist'), cache = path.join(root, 'empty-cache');
  await fs.mkdir(dist, { recursive: true });
  await fs.writeFile(path.join(dist, 'BUILD.json'), JSON.stringify({ commit: target.commit, dirty: false }));
  const status = { receipt: null, prepared: { digest, plan: { target } }, runtime: { ...target, directory, nodeVersion: 'v22.0.0' } };
  let head = target.commit, dirty = false, applies = 0;
  const options = { root, run: async (_root, executable, args) => {
    if (args[0] === 'rev-parse') return head;
    if (args[0] === 'status') return dirty ? ' M src/index.ts' : '';
    if (args.includes('status')) {
      assert.equal(executable, process.execPath);
      assert.deepEqual(args.slice(-5), ['--json', 'runtime', 'update', 'status', digest]);
      return JSON.stringify({ ok: true, data: status });
    }
    assert.equal(executable, path.join(directory, 'node'));
    assert.deepEqual(args, [path.join(dist, 'cli/omnitron.js'), '--json', 'runtime', 'update', 'apply', digest]);
    applies++;
    return JSON.stringify({ ok: true, data: { digest, phase: 'accepted' } });
  } };
  const apply = () => runUpdate(['local-sync', '--cache-dir', cache, '--review', digest], options);
  assert.equal((await apply()).phase, 'accepted');
  await assert.rejects(fs.stat(cache), { code: 'ENOENT' });
  head = 'c'.repeat(40);
  await assert.rejects(apply(), /checkout changed/);
  head = target.commit; dirty = true;
  await assert.rejects(apply(), /checkout changed/);
  dirty = false; status.prepared.digest = 'e'.repeat(64);
  await assert.rejects(apply(), /no matching verified installation/);
  status.prepared.digest = digest; status.runtime.artifact = 'f'.repeat(64);
  await assert.rejects(apply(), /no matching verified installation/);
  assert.equal(applies, 1);
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
      await hooks.cleanup?.(options, args.at(-1));
      await fs.rm(args.at(-1), { recursive: true, force: true });
      return '';
    }
    if (args.includes('--json')) {
      const command = args.slice(args.indexOf('--json') + 1);
      return JSON.stringify({ ok: true, data: await hooks.native?.(command) ?? { command } });
    }
    if (args[0] === 'rev-parse') return commit;
    if (args[0] === 'status') return '';
    if (executable === 'pnpm' && args[0] === 'install') await hooks.build?.();
    if (executable === process.execPath && args[0] === '--input-type=module' && args[2]?.includes('assertStandaloneNodeConfiguration')) {
      await hooks.producer?.();
    }
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
test('refuses an unsuitable Node producer before creating a checkout or installing dependencies', finalizationOptions, async t => {
  const fixture = await finalizationFixture(t, {
    producer: () => { throw Error('Standalone Node required'); },
    build: () => assert.fail('Started installing dependencies'),
    cleanup: () => assert.fail('Created a build workspace'),
  });
  await assert.rejects(withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, () => assert.fail('Prepared a runtime')),
    /Standalone Node required/);
  assert.deepEqual((await localCleanup(fixture.cache, { status: true })).jobs, []);
});

const pending = cache => localCleanup(cache, { status: true });
const defer = { deferCleanup: true, schedule: async () => {} };
const fixtureOptions = fixture => ({ root: process.cwd(), run: fixture.run, scheduleCleanup: defer.schedule });
const cleanupOptions = { ...finalizationOptions, timeout: 30_000 };

test('public stage and sync deliver the verified bytes and release the revision lock while recursive removal is blocked', cleanupOptions, async t => {
  let builds = 0, installations = 0;
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  const installing = Promise.withResolvers(), finishInstall = Promise.withResolvers();
  t.after(() => { release.resolve(); finishInstall.resolve(); });
  const fixture = await finalizationFixture(t, {
    build: () => { builds++; },
    cleanup: async (_options, tree) => { entered.resolve(tree); await release.promise; },
    native: async command => {
      if (command.includes('install')) { installations++; installing.resolve(); await finishInstall.promise; }
      return { command };
    },
  });
  let removing;
  const options = { ...fixtureOptions(fixture), scheduleCleanup: async base => {
    removing ??= localCleanup(base, { run: fixture.run });
    await entered.promise;
  } };
  const staging = runUpdate(['local-stage', '--cache-dir', fixture.cache], options);
  await installing.promise;
  assert.equal((await pending(fixture.cache)).jobs[0].state, 'removing');
  const sync = await runUpdate(['local-sync', '--cache-dir', fixture.cache], options);
  assert.deepEqual(sync.command, ['runtime', 'update', 'prepare', fixture.directory]);
  finishInstall.resolve();
  assert.deepEqual((await staging).command, ['backend', 'install', fixture.directory]);
  assert.equal(builds, 1); assert.equal(installations, 1);
  await verifyRuntimeArtifact(fixture.directory);
  const concurrent = await localCleanup(fixture.cache, { run: fixture.run });
  assert.equal(concurrent.busy, true);
  release.resolve();
  assert.equal((await removing).jobs[0].state, 'cleaned');
});

test('partial removal and an expired deadline retain a separate cleanup receipt and retry without another build or install', cleanupOptions, async t => {
  let builds = 0, calls = 0, removals = 0;
  const fixture = await finalizationFixture(t, {
    build: () => { builds++; },
    native: () => ({ installed: ++calls }),
    cleanup: async (_options, tree) => {
      if (++removals === 1) { await fs.rm(path.join(tree, 'source'), { recursive: true }); throw Error('native timeout after 300000ms'); }
    },
  });
  const options = fixtureOptions(fixture), cleanup = ['local-cleanup', '--cache-dir', fixture.cache];
  assert.deepEqual(await runUpdate(['local-stage', '--cache-dir', fixture.cache], options), { installed: 1 });
  await assert.rejects(runUpdate(cleanup, options), /still require cleanup/);
  const failed = (await runUpdate([...cleanup, '--status'], options)).jobs[0];
  assert.equal(failed.state, 'failed'); assert.equal(failed.attempts, 1); assert.match(failed.error, /300000ms/);
  assert.equal((await verifyRuntimeArtifact(fixture.directory)).sha256.length, 64);
  const retried = (await runUpdate(cleanup, options)).jobs[0];
  assert.equal(retried.state, 'cleaned'); assert.equal(retried.id, failed.id); assert.equal(retried.attempts, 2);
  await runUpdate(cleanup, options);
  assert.equal(builds, 1); assert.equal(calls, 1); assert.equal(removals, 2);
});

test('a live producer is never collected and an interrupted worker can resume from its receipt', cleanupOptions, async t => {
  const entered = Promise.withResolvers(), release = Promise.withResolvers();
  t.after(() => release.resolve());
  const fixture = await finalizationFixture(t, { build: async () => { entered.resolve(); await release.promise; } });
  const building = withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => 'staged', defer);
  await entered.promise;
  const active = (await runUpdate(['local-cleanup', '--cache-dir', fixture.cache], fixtureOptions(fixture))).jobs[0];
  assert.equal(active.state, 'building'); assert.equal(active.attempts, 0);
  release.resolve(); assert.equal(await building, 'staged');
  const file = path.join(fixture.cache, '.runtime-workspaces', active.id, 'job.json');
  await fs.writeFile(file, JSON.stringify({ ...active, state: 'removing', attempts: 1 }));
  const retry = (await localCleanup(fixture.cache, { run: fixture.run })).jobs[0];
  assert.equal(retry.state, 'cleaned'); assert.equal(retry.attempts, 2);
});

test('a cache hit recovers a dead producer and confirms a completed native removal after a worker crash', cleanupOptions, async t => {
  let builds = 0, removals = 0;
  const fixture = await finalizationFixture(t, { build: () => { builds++; }, cleanup: () => { removals++; } });
  const options = fixtureOptions(fixture), stage = ['local-stage', '--cache-dir', fixture.cache];
  await runUpdate(stage, options);
  const [job] = (await pending(fixture.cache)).jobs;
  const file = path.join(fixture.cache, '.runtime-workspaces', job.id, 'job.json');
  await fs.writeFile(file, JSON.stringify({ ...job, state: 'building' }));
  let draining;
  await runUpdate(stage, { ...options, scheduleCleanup: base => { draining = localCleanup(base, { run: fixture.run }); } });
  assert.equal((await draining).jobs[0].state, 'cleaned');
  await fs.writeFile(file, JSON.stringify({ ...job, state: 'removing', attempts: 1 }));
  assert.equal((await localCleanup(fixture.cache, { run: fixture.run })).jobs[0].state, 'cleaned');
  assert.equal(builds, 1); assert.equal(removals, 1);
});

test('cleanup refuses a substituted tree and leaves unrelated, unregistered and legacy files untouched', cleanupOptions, async t => {
  const fixture = await finalizationFixture(t);
  await withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => 'staged', defer);
  const [job] = (await pending(fixture.cache)).jobs;
  const tree = path.join(fixture.cache, '.runtime-workspaces', job.id, 'tree'), original = tree + '-held';
  const legacy = path.join(fixture.cache, '.build-existing');
  await fs.mkdir(legacy); await fs.writeFile(path.join(legacy, 'keep'), 'retained');
  await fs.rename(tree, original); await fs.symlink(legacy, tree);
  assert.equal((await localCleanup(fixture.cache, { run: fixture.run })).jobs[0].state, 'failed');
  assert.equal(await fs.readFile(path.join(legacy, 'keep'), 'utf8'), 'retained');
  await fs.unlink(tree); await fs.mkdir(tree);
  assert.match((await localCleanup(fixture.cache, { run: fixture.run })).jobs[0].error, /replaced/);
  await fs.rmdir(tree); await fs.rename(original, tree);
  assert.equal((await localCleanup(fixture.cache, { run: fixture.run })).jobs[0].state, 'cleaned');
  assert.equal(await fs.readFile(path.join(legacy, 'keep'), 'utf8'), 'retained');
  await verifyRuntimeArtifact(fixture.directory);
});

test('public status reports an invalid receipt while another registered checkout can still be reclaimed', cleanupOptions, async t => {
  const fixture = await finalizationFixture(t);
  await runUpdate(['local-stage', '--cache-dir', fixture.cache], fixtureOptions(fixture));
  const [job] = (await pending(fixture.cache)).jobs;
  const invalid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const directory = path.join(fixture.cache, '.runtime-workspaces', invalid);
  await fs.mkdir(directory, { mode: 0o700 });
  await fs.writeFile(path.join(directory, 'job.json'), '{', { mode: 0o600 });
  await fs.mkdir(path.join(directory, 'tree'));
  const args = ['local-cleanup', '--cache-dir', fixture.cache], options = fixtureOptions(fixture);
  await assert.rejects(runUpdate(args, options), /still require cleanup/);
  const status = await runUpdate([...args, '--status'], options);
  assert.equal(status.jobs.find(record => record.id === job.id).state, 'cleaned');
  assert.equal(status.jobs.find(record => record.id === invalid).state, 'invalid');
  assert((await fs.stat(path.join(directory, 'tree'))).isDirectory());
});

test('delivery, build and cancellation keep their own outcome when cleanup is a separate job', cleanupOptions, async t => {
  const fixture = await finalizationFixture(t);
  await assert.rejects(withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => { throw Error('installation rejected'); }, defer), /installation rejected/);
  const controller = new AbortController();
  await assert.rejects(within({ signal: controller.signal }, () => withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async (_dist, signal) => {
    assert.equal(signal, controller.signal); controller.abort(Error('operator cancelled')); return 'unobserved';
  }, defer)), /operator cancelled/);
  const broken = await finalizationFixture(t, { build: () => { throw Error('build rejected'); } });
  await assert.rejects(withLocalRuntime(process.cwd(), broken.cache, broken.run, () => {}, async () => assert.fail('unbuilt runtime'), defer), /build rejected/);
  assert.equal((await pending(broken.cache)).jobs[0].state, 'queued');
  await assert.rejects(fs.stat(broken.directory), { code: 'ENOENT' });
});

test('blocking activation still refuses a failed cleanup while stage reports an unavailable worker separately', cleanupOptions, async t => {
  const fixture = await finalizationFixture(t, { cleanup: async () => { throw Error('native permission failure'); } });
  await assert.rejects(withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => assert.fail('activation must wait')), /native permission failure/);
  const calls = []; const clean = await finalizationFixture(t);
  const stage = await withLocalRuntime(process.cwd(), clean.cache, clean.run, message => calls.push(message), async () => 'staged',
    { deferCleanup: true, schedule: async () => { throw Error('worker unavailable'); } });
  assert.equal(stage, 'staged'); assert(calls.some(message => message.includes('worker unavailable')));
  assert.equal((await pending(clean.cache)).jobs[0].state, 'queued');
});

test('the independent worker reclaims a registered checkout after the staging process returns', cleanupOptions, async t => {
  const fixture = await finalizationFixture(t);
  await withLocalRuntime(process.cwd(), fixture.cache, fixture.run, () => {}, async () => 'staged', defer);
  const [job] = (await pending(fixture.cache)).jobs;
  await scheduleLocalCleanup(fixture.cache, job.id);
  const until = Date.now() + 20_000;
  while (!(await pending(fixture.cache)).jobs.some(job => job.state === 'cleaned')) {
    if (Date.now() >= until) assert.fail('independent worker did not finish');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  await verifyRuntimeArtifact(fixture.directory);
});
