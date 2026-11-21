import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runtimeArtifactDigest } from '../../src/shared/runtime-artifact.ts';
import { readCommandResult, CommandResultError } from '../../src/shared/command-result.ts';
import { tsImport } from 'tsx/esm/api';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';

const { runtimeUpdatePlanDigest } = await tsImport('../../src/daemon/runtime-update.ts', import.meta.url);
const { runtimeUpdateActions, verifyRuntimeUpdateTarget } = await tsImport('../../src/daemon/runtime-update-host.ts', import.meta.url);
const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const cli = fileURLToPath(new URL('../../src/cli/omnitron.ts', import.meta.url));
const commit = 'c'.repeat(40);

test('machine results preserve refusals, explicit codes and process failure without exposing raw output', () => {
  assert.deepEqual(readCommandResult('{"ok":true,"data":{"ready":true}}', 'status'), { ready: true });
  assert.throws(() => readCommandResult(JSON.stringify({ ok: false, error: { message: 'Preparation refused' },
    code: 'REVIEW_STALE', details: { phase: 'inspect' } }), 'runtime update prepare'), error => {
    assert.equal(error.message, 'Preparation refused');
    assert.equal(error.code, 'REVIEW_STALE');
    assert.deepEqual(error.details.reported, { phase: 'inspect' });
    return true;
  });
  assert.throws(() => readCommandResult('{"ok":true,"data":{"reason":"Not finished"}}', 'apply', 7), error =>
    error instanceof CommandResultError && error.message === 'Not finished' && error.exitCode === 7);
  const review = { ok: true, data: { targets: [
    { node: 'local', infrastructure: { checks: [
      { resource: 'cache', state: 'pass', message: 'Ready' },
      { resource: 'gateway', state: 'unknown', message: 'Configuration changed', environment: 'private-value' },
    ] } }, { node: 'peer', reason: 'Declarations unavailable' },
  ] } };
  assert.throws(() => readCommandResult(JSON.stringify(review), 'review', 1), error =>
    error instanceof CommandResultError && error.message === 'local: gateway: Configuration changed; peer: Declarations unavailable');
  assert.throws(() => readCommandResult('{"ok":true,"data":{}}', 'apply', 'SIGTERM'), error =>
    error instanceof CommandResultError && error.exitCode === 1);
  assert.throws(() => readCommandResult('private-output-that-is-not-json', 'status'), error =>
    !error.message.includes('private-output') && !JSON.stringify(error.details).includes('private-output'));
  const transport = Error('connection lost');
  assert.throws(() => readCommandResult('partial', 'status', 1, transport), error => error === transport);
  for (const value of [null, [], true, { data: {} }])
    assert.throws(() => readCommandResult(JSON.stringify(value), 'status'), CommandResultError);
});

async function instance(t) {
  const home = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'runtime-cli-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const invoke = (...args) => execute(process.execPath, ['--import=tsx/esm', cli, '--json', ...args], {
    cwd: root, env: { ...process.env, OMNITRON_HOME: home }, timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  return { home, invoke };
}

test('status reports unavailable startup as one structured error without human output', async t => {
  const { invoke } = await instance(t);
  await assert.rejects(invoke('status'), error => {
    assert.equal(error.stdout, '');
    const reply = JSON.parse(error.stderr);
    assert.equal(reply.ok, false);
    assert.equal(reply.code, 'DAEMON_UNAVAILABLE');
    assert.equal(reply.details.absence.kind, 'stopped');
    return true;
  });
});

async function candidate(home, reply = { ok: true, data: { delegated: true } }, status = 0, journalFormats) {
  const stage = path.join(home, 'candidate');
  const called = path.join(home, 'called');
  await fs.mkdir(path.join(stage, 'packages/0/dist/cli'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(stage, 'packages/0/dist/daemon'), { recursive: true, mode: 0o700 });
  if (journalFormats) {
    await fs.mkdir(path.join(stage, 'packages/0/dist/shared'));
    await fs.writeFile(path.join(stage, 'packages/0/dist/shared/controller-journal-formats.json'), JSON.stringify(journalFormats));
  }
  await fs.mkdir(path.join(stage, 'packages/0/webapp/dist'), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(stage, 'packages/0/webapp/dist/index.html'), '<html>Console fixture</html>');
  for (const output of ['dist', 'webapp/dist']) {
    await fs.writeFile(path.join(stage, 'packages/0', output, 'BUILD.json'), JSON.stringify({ commit, dirty: false, builtAt: '2026-11-17T18:00:00Z' }), { mode: 0o600 });
  }
  await fs.writeFile(path.join(stage, 'packages/0/dist/cli/omnitron.js'), '// Verified fixture entry\n', { mode: 0o600 });
  await fs.writeFile(path.join(stage, 'packages/0/dist/daemon/daemon-entry.js'), '// Sealed preflight entry\n', { mode: 0o600 });
  const quoted = "'" + called.replaceAll("'", "'\\''") + "'";
  const encoded = "'" + JSON.stringify(reply).replaceAll("'", "'\\''") + "'";
  await fs.writeFile(path.join(stage, 'node'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${quoted}\nprintf '%s\\n' ${encoded}\nexit ${status}\n`, { mode: 0o700 });
  const artifact = await runtimeArtifactDigest(stage);
  const manifest = { protocol: 1, sha256: artifact, platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 };
  await fs.writeFile(path.join(stage, 'RUNTIME.json'), JSON.stringify(manifest), { mode: 0o600 });
  const directory = path.join(home, 'runtime/releases', artifact);
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 });
  await fs.rename(stage, directory);
  return { artifact, directory, called, manifest };
}

test('offline cold recovery checks both the final backend and interim starter against the same physical controller journal', async t => {
  const { home } = await instance(t);
  const { RuntimeInstallation } = await tsImport('../../src/daemon/runtime-installation.ts', import.meta.url);
  const registry = await RuntimeInstallation.open(home); await registry.close();
  const legacy = await candidate(home), current = await candidate(home, undefined, 0, { studioTeams: 1, hostFlows: 1 });
  const actions = await runtimeUpdateActions({ instance: home, runtime: await verifyRuntimeUpdateTarget(current.directory),
    call: () => assert.fail('offline admission may not depend on a serving controller'),
    run: () => assert.fail('must not touch services') });
  const plan = { configuration: { basis: 'retained-next-start' }, before: { backend: legacy.artifact, console: null, consoleCommit: null },
    target: { artifact: current.artifact } };
  await fs.mkdir(path.join(home, 'data'));
  const db = openSqliteDatabase(path.join(home, 'data/daemon-state.db')); t.after(() => db.close());
  db.exec('CREATE TABLE flow_definitions(active TEXT); CREATE TABLE flow_deliveries(status TEXT);');
  await actions.validateRestore(plan);
  db.exec("INSERT INTO flow_definitions VALUES('fixture-activation')");
  await assert.rejects(actions.validateRestore(plan), /active flows/);
  await assert.rejects(actions.validateRestore({ ...plan, before: { ...plan.before, backend: current.artifact },
    target: { artifact: legacy.artifact } }), /active flows/);
  await actions.validateRestore({ ...plan, before: { ...plan.before, backend: current.artifact } });
  db.exec("UPDATE flow_definitions SET active=NULL; INSERT INTO flow_deliveries VALUES('dispatching')");
  await assert.rejects(actions.validateRestore(plan), /pending deliveries/);
  db.exec("UPDATE flow_deliveries SET status='delivered'");
  await actions.validateRestore(plan);
  await assert.rejects(fs.access(current.called));
});

for (const capable of [false, true]) test('offline recovery checks the sealed cold starter for an independent Console (capable=' + capable + ')', async t => {
  const { home } = await instance(t);
  const fixture = await candidate(home, { protocol: 1, build: { commit, dirty: false }, ...(capable && { coldConsoleProtocol: 1 }) });
  const actions = await runtimeUpdateActions({ instance: home, runtime: await verifyRuntimeUpdateTarget(fixture.directory),
    call: () => assert.fail('an unavailable serving backend cannot be needed for restore preflight'),
    run: () => assert.fail('the preflight must not change native services') });
  const plan = { stackAdmissionProtocol: 1, configuration: { sha256: 'a'.repeat(64), basis: 'retained-next-start' },
    target: { artifact: fixture.artifact, commit }, before: { backend: 'a'.repeat(64), console: null, consoleCommit: null } };
  await actions.validateRestore(plan);
  await assert.rejects(fs.access(fixture.called));
  const previousConsole = await candidate(home);
  plan.before.console = previousConsole.artifact;
  plan.before.consoleCommit = commit;
  if (capable) await actions.validateRestore(plan);
  else await assert.rejects(actions.validateRestore(plan), /cannot restore the independently selected Console/);
  assert.deepEqual((await fs.readFile(fixture.called, 'utf8')).trim().split('\n'), [
    path.join(fixture.directory, 'packages/0/dist/daemon/daemon-entry.js'), '--check-backend',
  ]);
  await fs.appendFile(path.join(previousConsole.directory, 'packages/0/webapp/dist/index.html'), 'changed');
  await assert.rejects(actions.validateRestore(plan), /changed after sealing/);
});

test('native lifecycle children use human output even when the parent is in JSON mode', async t => {
  const { home } = await instance(t);
  const runtime = await candidate(home);
  let called = false;
  const actions = await runtimeUpdateActions({ runtime: await verifyRuntimeUpdateTarget(runtime.directory), instance: home,
    call: async () => assert.fail('shutdown does not use a structured CLI call'),
    run: async (cwd, executable, argv, options) => {
      called = true;
      assert.equal(cwd, home);
      assert.equal(executable, path.join(runtime.directory, 'node'));
      assert.deepEqual(argv, [path.join(runtime.directory, 'packages/0/dist/cli/omnitron.js'), 'down']);
      const child = await execute(process.execPath, ['-e', 'process.stdout.write(process.env.OMNITRON_OUTPUT)'], {
        env: { ...process.env, OMNITRON_OUTPUT: 'json', ...options.env },
      });
      assert.equal(child.stdout, 'human');
      return '';
    },
  });
  await actions.stop({ backend: runtime.artifact });
  assert.equal(called, true);
});

test('native shutdown admission names each resource the cold candidate would change', async t => {
  const { home } = await instance(t), runtime = await candidate(home);
  const actions = await runtimeUpdateActions({ runtime: await verifyRuntimeUpdateTarget(runtime.directory), instance: home,
    call: async args => {
      assert.deepEqual(args, ['backend', 'select', runtime.artifact, '--check']);
      return { checked: true, candidate: runtime.artifact, schemaScope: 'all', infrastructure: {
        coverage: 'reviewed-declarations', intentDigest: 'd'.repeat(64),
        containers: [{ name: 'sample-dev-gateway', action: 'replace', id: 'a'.repeat(64) }],
        controlPlaneDatabase: { action: 'move-network', id: 'b'.repeat(64) },
      } };
    }, run: () => assert.fail('cold preview must not operate native services') });
  await assert.rejects(actions.validateStop({ backendPid: 123 }, { target: { artifact: runtime.artifact } }),
    /sample-dev-gateway: replace, Control-plane PostgreSQL: move-network/);
});

test('host preparation retains its live proof without rereading candidate bytes', async t => {
  const { home } = await instance(t), fixture = await candidate(home);
  const runtime = await verifyRuntimeUpdateTarget(fixture.directory);
  const open = fs.open;
  let reads = 0;
  t.mock.method(fs, 'open', (...args) => {
    if (String(args[0]).startsWith(fixture.directory + path.sep)) reads++;
    return open(...args);
  });
  const options = { runtime, instance: home,
    call: async () => assert.fail('proof admission must not call a running controller'),
    run: async () => assert.fail('proof admission must not execute a command') };
  await runtimeUpdateActions(options);
  assert.equal(reads, 0, 'metadata freshness must not turn into another content hash');
  assert.ok(Object.isFrozen(runtime));
  await assert.rejects(runtimeUpdateActions({ ...options, runtime: JSON.parse(JSON.stringify(runtime)) }), /no in-process verification/);
});

test('the candidate directs Linux hosts to fleet before querying live services', { skip: process.platform !== 'linux' }, async t => {
  const { home } = await instance(t);
  const fixture = await candidate(home);
  const actions = await runtimeUpdateActions({ runtime: await verifyRuntimeUpdateTarget(fixture.directory), instance: home,
    call: () => assert.fail('Linux preparation must not query the serving controller'),
    run: () => assert.fail('Linux preparation must not change services') });
  await assert.rejects(actions.prepare(), /omnitron fleet rollout plan/);
});

test('host preparation rejects mutation and cannot revive a stale proof by restoring original bytes', async t => {
  const { home } = await instance(t), fixture = await candidate(home);
  const runtime = await verifyRuntimeUpdateTarget(fixture.directory);
  const file = path.join(fixture.directory, 'packages/0/dist/BUILD.json'), bytes = await fs.readFile(file);
  const options = { runtime, instance: home,
    call: async () => assert.fail('changed runtime must not contact a controller'),
    run: async () => assert.fail('changed runtime must not execute a command') };
  await fs.appendFile(file, ' ');
  await assert.rejects(runtimeUpdateActions(options), /changed after verification/);
  await fs.writeFile(file, bytes);
  await assert.rejects(runtimeUpdateActions(options), /invalidated/);
  await runtimeUpdateActions({ ...options, runtime: await verifyRuntimeUpdateTarget(fixture.directory) });
});

test('public status is available without a daemon, a Git checkout or a receipt', async t => {
  const { invoke, home } = await instance(t);
  const result = await invoke('runtime', 'update', 'status');
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, data: { prepared: null, receipt: null, runtime: null } });
  assert.deepEqual(await fs.readdir(home), [], 'inspection must not create state or contact an owner');
  await assert.rejects(invoke('runtime', 'update', 'recover', '../current'), error =>
    JSON.parse(error.stderr).ok === false && /full SHA-256/.test(error.stderr));
  assert.deepEqual(await fs.readdir(home), []);
});

test('public artifact verification uses the same bytes as the explicit source export and executes nothing', async t => {
  const { invoke, home } = await instance(t);
  const runtime = await candidate(home);
  assert.deepEqual(JSON.parse((await invoke('runtime', 'verify', runtime.directory)).stdout).data, runtime.manifest);
  const source = await execute(process.execPath, ['--conditions=omnitron-source', '--import=tsx/esm', '--input-type=module', '--eval',
    "import { verifyRuntimeArtifact } from '@omnitron-dev/omnitron/runtime-artifact'; process.stdout.write(JSON.stringify(await verifyRuntimeArtifact(process.argv[1])));", runtime.directory], { cwd: root });
  assert.deepEqual(JSON.parse(source.stdout), runtime.manifest);
  await assert.rejects(fs.access(runtime.called));
  await fs.appendFile(path.join(runtime.directory, 'packages/0/dist/cli/omnitron.js'), '// Changed\n');
  await assert.rejects(invoke('runtime', 'update', 'prepare', runtime.directory), error => /changed after sealing/.test(error.stderr));
  await assert.rejects(fs.access(runtime.called), 'altered candidates must never execute');
});

test('public prepare delegates exactly once to the sealed candidate Node and CLI', { skip: process.platform === 'win32' }, async t => {
  const { invoke, home } = await instance(t);
  const runtime = await candidate(home);
  const result = JSON.parse((await invoke('runtime', 'update', 'prepare', runtime.directory)).stdout);
  assert.deepEqual(result, { ok: true, data: { delegated: true } });
  assert.deepEqual((await fs.readFile(runtime.called, 'utf8')).trim().split('\n'), [
    path.join(runtime.directory, 'packages/0/dist/cli/omnitron.js'), '--json', 'runtime', 'update', 'prepare', runtime.directory,
  ]);
  await assert.rejects(fs.access(path.join(home, 'runtime/local-updates')), 'the reviewing CLI cannot run host actions itself');
});

test('public prepare preserves target refusal reasons and the structured review on nonzero exit', { skip: process.platform === 'win32' }, async t => {
  const { invoke, home } = await instance(t);
  const review = { project: 'sample', stack: 'local', digest: null,
    targets: [{ node: 'local', reason: 'Selected release declarations changed' }] };
  const runtime = await candidate(home, { ok: true, data: review }, 1);
  await assert.rejects(invoke('runtime', 'update', 'prepare', runtime.directory), error => {
    const reply = JSON.parse(error.stderr);
    assert.equal(reply.ok, false);
    assert.equal(reply.error, 'local: Selected release declarations changed');
    assert.equal(reply.code, 'CLI_RESULT_UNCONFIRMED');
    assert.equal(reply.details.exitCode, 1);
    assert.deepEqual(reply.details.result, review);
    return true;
  });
  assert.deepEqual((await fs.readFile(runtime.called, 'utf8')).trim().split('\n'), [
    path.join(runtime.directory, 'packages/0/dist/cli/omnitron.js'), '--json', 'runtime', 'update', 'prepare', runtime.directory,
  ]);
  await assert.rejects(fs.access(path.join(home, 'runtime/local-updates')), 'a refused review must not apply a host action');
});

test('status exposes verified candidate paths and refuses a mismatching private plan', async t => {
  const { invoke, home } = await instance(t);
  const runtime = await candidate(home);
  const plan = { protocol: 1, instance: home, target: { artifact: runtime.artifact, commit } };
  const prepared = { protocol: 1, digest: runtimeUpdatePlanDigest(plan), plan };
  const records = path.join(home, 'runtime/local-updates');
  await fs.mkdir(records, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(records, 'prepared.json'), JSON.stringify(prepared), { mode: 0o600 });
  const { data } = JSON.parse((await invoke('runtime', 'update', 'status', prepared.digest)).stdout);
  assert.deepEqual(data.prepared, prepared);
  assert.equal(data.receipt, null);
  assert.deepEqual(data.runtime, { artifact: runtime.artifact, commit, directory: runtime.directory,
    node: path.join(runtime.directory, 'node'), cli: path.join(runtime.directory, 'packages/0/dist/cli/omnitron.js'),
    nodeVersion: process.version, platform: process.platform, arch: process.arch });
  await assert.rejects(fs.access(runtime.called));
  prepared.plan.target.commit = 'd'.repeat(40);
  await fs.writeFile(path.join(records, 'prepared.json'), JSON.stringify(prepared), { mode: 0o600 });
  await assert.rejects(invoke('runtime', 'update', 'apply', prepared.digest), error => /does not match its reviewed plan/.test(error.stderr));
  await assert.rejects(fs.access(runtime.called));
});
