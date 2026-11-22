import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { allocationInput, passiveAllocationDefinition } from '../commands/passive-allocation.js';
import { readReceiver, runReceiverPhase } from './receiver.mjs';

const digest = c => c.repeat(64);
test('only a transient pre-lease observation can be repeated, with fresh evidence', async () => {
  for (const [phase, code, succeeds, count] of [
    ['inspect', 408, true, 2], ['inspect', 'ECONNRESET', true, 2],
    ['stage', 408, false, 1], ['inspect', 'EACCES', false, 1],
  ]) {
    let attempts = 0;
    const run = () => runReceiverPhase(phase, () => readReceiver('Project inventory', () => {
      if (++attempts === 1) throw Object.assign(new Error('private wrapper argument'), { code });
      return 'fresh inventory';
    }));
    if (succeeds) assert.equal(await run(), 'fresh inventory');
    else await assert.rejects(run, { message: code === 408 ? 'Project inventory timed out' : 'Project inventory unavailable' });
    assert.equal(attempts, count);
  }
  let attempts = 0;
  await assert.rejects(() => runReceiverPhase('inspect', () => readReceiver('Process inventory', () => {
    attempts++;
    throw Object.assign(new Error('private wrapper argument'), { code: 'EPIPE' });
  })), { message: 'Process inventory lost its connection' });
  assert.equal(attempts, 2);
});

function sample(change = () => {}) {
  const prepared = { protocol: 1, project: 'example', stack: 'prod', release: 'release-1', commit: 'c'.repeat(40),
    manifestSha256: digest('a'), digest: digest('b'), nodeId: 'receiver', sshFingerprint: 'SHA256:' + 'P'.repeat(43) };
  const config = { stacks: { prod: { type: 'remote', nodes: [{ nodeId: 'receiver' }] } }, apps: [
    { name: 'api', bootstrap: 'src/bootstrap.ts', env: { PRIVATE_FIXTURE: 'sentinel-value', NODE_OPTIONS: '--max-old-space-size=4096' } },
    { name: 'jobs', script: 'index.js', dependsOn: ['api'] },
  ] };
  change(config);
  const bytes = Buffer.from(JSON.stringify({ ...prepared, config }));
  prepared.declarationsSha256 = createHash('sha256').update(bytes).digest('hex');
  const options = { expectPrepared: prepared.digest, backend: digest('d'), ownerArtifact: digest('e'), user: 'worker', uid: '995', fromNode: 'source' };
  return { prepared, bytes, options };
}
test('the Pipeline carries only deployment identities and public launch requirements', async () => {
  const { prepared, bytes, options } = sample();
  const input = allocationInput(prepared, bytes, options);
  assert.deepEqual(input.apps, [
    { name: 'api', mode: 'bootstrap', nodeOptions: '--max-old-space-size=4096' },
    { name: 'jobs', mode: 'script', dependsOn: ['api'] },
  ]);
  const graph = await passiveAllocationDefinition({ ok: true, data: prepared }, bytes, options);
  assert.deepEqual(graph, await passiveAllocationDefinition(prepared, bytes, options));
  assert.equal(graph.steps.length, 3);
  assert.equal(graph.steps[1].nodeId, prepared.nodeId);
  assert.deepEqual(graph.steps[1].dependsOn, ['verify-original-placement']);
  assert.equal(graph.steps[1].retries, 0);
  assert.deepEqual(graph.steps[2].dependsOn, ['prepare-passive-allocation']);
  assert.ok(Buffer.byteLength(graph.steps[1].run) < 22 * 1024);
  assert.equal(JSON.stringify(input).includes('sentinel'), false);
});
test('the native all-applications selection admits the exact single-node release', () => {
  const { prepared, bytes, options } = sample(c => { c.stacks.prod.apps = 'all'; });
  assert.deepEqual(allocationInput(prepared, bytes, options).apps.map(a => a.name), ['api', 'jobs']);
});

test('a replacement binds both disabled publications and the reviewed recipient owner', async () => {
  const { prepared, bytes, options } = sample();
  const previous = { protocol: 1, project: prepared.project, sourceStack: prepared.stack, nodeId: prepared.nodeId,
    directory: '/opt/omnitron/projects/example', ticket: digest('1'), release: 'release-zero', manifestSha256: digest('2'),
    configSha256: digest('3'), definitionSha256: digest('4'), owner: 'previous-owner', enabledApps: 0, physicalContainers: 0, handles: 0 };
  const replace = { ...options, replaces: previous, expectReplaced: previous.ticket };
  const same = allocationInput(prepared, bytes, replace);
  assert.equal(same.replaces.owner, previous.owner);
  assert.notEqual(same.ticket, allocationInput(prepared, bytes, options).ticket);
  const fresh = allocationInput(prepared, bytes, { ...replace, expectOwner: 'confirmed-successor' });
  assert.equal(fresh.replaces.previousOwner, previous.owner);
  assert.notEqual(fresh.ticket, same.ticket);
  assert.equal(fresh.replaces.owner, 'confirmed-successor');
  const graph = await passiveAllocationDefinition(prepared, bytes, replace);
  assert.match(graph.name, /^Replace passive allocation /);
  assert.equal(graph.steps[1].nodeId, prepared.nodeId);
  assert.ok(Buffer.byteLength(graph.steps[1].run) < 22 * 1024);
  for (const change of [{ nodeId: 'other' }, { sourceStack: 'other' }, { release: prepared.release }, { manifestSha256: prepared.manifestSha256 },
    { enabledApps: 1 }, { handles: 1 }, { physicalContainers: 1 }, { directory: '/elsewhere' }, { configSha256: null }, { owner: 'wrong/shape' }])
    assert.throws(() => allocationInput(prepared, bytes, { ...replace, replaces: { ...previous, ...change } }));
  for (const change of [{ expectReplaced: digest('0') }, { expectReplaced: undefined }, { replaces: undefined }, { expectOwner: '/other' }])
    assert.throws(() => allocationInput(prepared, bytes, { ...replace, ...change }));
});
test('source admission refuses another SHA, recipient, membership, loader or account', () => {
  const { prepared, bytes, options } = sample();
  for (const override of [{ fromNode: 'receiver' }, { uid: '0' }, { user: 'root' }, { expectPrepared: digest('f') }])
    assert.throws(() => allocationInput(prepared, bytes, { ...options, ...override }));
  assert.throws(() => allocationInput(prepared, Buffer.concat([bytes, Buffer.from(' ')]), options));
  for (const change of [
    c => { c.stacks.prod.nodes[0].nodeId = 'different'; }, c => { c.stacks.prod.nodes[0].apps = ['jobs']; },
    c => { c.apps[1].enabled = false; }, c => { c.apps[1].name = 'api'; },
    c => { c.apps[0].env.NODE_OPTIONS = '--require=unreviewed'; },
  ]) {
    const { prepared: r, bytes: b, options: o } = sample(change);
    assert.throws(() => allocationInput(r, b, o));
  }
});

test('both controller checks require the original registered placement and current SSH pin', async () => {
  const { prepared, bytes, options } = sample();
  const graph = await passiveAllocationDefinition(prepared, bytes, options);
  const original = { id: options.fromNode, host: 'original.fixture', daemonPort: 9700 };
  const receiver = { id: prepared.nodeId, host: 'receiver.fixture', daemonPort: 9700 };
  const route = n => ({ config: { type: 'remote', nodes: [{ nodeId: n.id, host: n.host, port: n.daemonPort }] } });
  const responses = { 'stack check-release': prepared, 'node list': { nodes: [original, receiver] },
    'node ssh-key': { nodeId: receiver.id, trusted: prepared.sshFingerprint, observed: prepared.sshFingerprint },
    'stack status': route(original) };
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-passive-admission-'));
  try {
    await fs.writeFile(path.join(temp, 'omnitron'), [
      '#!/usr/bin/env node',
      "const key = process.argv.slice(3, 5).join(' ');",
      "const value = JSON.parse(process.env.FIXTURE_DECISIONS)[key];",
      "process.stdout.write(JSON.stringify({ok: !!value, data: value}));",
    ].join('\n') + '\n', { mode: 0o700 });
    const run = index => promisify(execFile)('/bin/sh', ['-c', graph.steps[index].run], {
      env: { PATH: temp + ':' + process.env.PATH, FIXTURE_DECISIONS: JSON.stringify(responses) },
    });
    assert.equal(JSON.parse((await run(0)).stdout).prepared, prepared.digest);
    assert.equal(JSON.parse((await run(2)).stdout).apps, 2);
    responses['stack status'] = route(receiver);
    await assert.rejects(run(2), /original registered placement/);
    responses['stack status'] = route(original);
    responses['node ssh-key'].observed = 'SHA256:' + 'Z'.repeat(43);
    await assert.rejects(run(0), /host key changed/);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
});
