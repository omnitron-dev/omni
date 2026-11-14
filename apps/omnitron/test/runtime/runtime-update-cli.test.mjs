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

const { runtimeUpdatePlanDigest } = await tsImport('../../src/daemon/runtime-update.ts', import.meta.url);
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

async function candidate(home, reply = { ok: true, data: { delegated: true } }, status = 0) {
  const stage = path.join(home, 'candidate');
  const called = path.join(home, 'called');
  await fs.mkdir(path.join(stage, 'packages/0/dist/cli'), { recursive: true, mode: 0o700 });
  await fs.mkdir(path.join(stage, 'packages/0/webapp/dist'), { recursive: true, mode: 0o700 });
  for (const output of ['dist', 'webapp/dist']) {
    await fs.writeFile(path.join(stage, 'packages/0', output, 'BUILD.json'), JSON.stringify({ commit, dirty: false }), { mode: 0o600 });
  }
  await fs.writeFile(path.join(stage, 'packages/0/dist/cli/omnitron.js'), '// Verified fixture entry\n', { mode: 0o600 });
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
