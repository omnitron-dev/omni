import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ReleaseCommandError } from '@xec-sh/ops/release';
import { runUpdate } from '../../.xec/update.mjs';

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
  const options = { progress() {}, run: async (_root, _cmd, args) => {
    calls.push(args);
    return JSON.stringify({ ok: true, data: { id } });
  } };
  await runUpdate(['apply', id], options);
  await runUpdate(['reconcile', id], options);
  await runUpdate(['local-check', '/private/runtime/dist'], options);
  assert.deepEqual(calls, [
    ['--json', 'fleet', 'rollout', 'apply', id, '--wait'],
    ['--json', 'fleet', 'rollout', 'reconcile', id],
    ['--json', 'backend', 'upgrade', '/private/runtime/dist', '--check'],
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
    calls.push(args);
    throw new ReleaseCommandError('omnitron', 1, JSON.stringify(reply), '');
  } };
  await assert.rejects(runUpdate(['status', id], options), error =>
    error.isUserError && error.exitCode === 1 && error.message === receipt.reason);
  assert.deepEqual(JSON.parse(output[0]), receipt);
  reply = { ok: false, error: 'Prepare a compatible database transition' };
  await assert.rejects(runUpdate(['local-check', '/private/runtime/dist'], options), error =>
    error.isUserError && error.message === reply.error);
  assert.equal(calls.length, 2, 'a refusal cannot replay an operation');
  const transport = new ReleaseCommandError('omnitron', 2, 'incomplete response', 'connection lost');
  await assert.rejects(runUpdate(['apply', id], { ...options, run: async () => { throw transport; } }), error => error === transport);
});
