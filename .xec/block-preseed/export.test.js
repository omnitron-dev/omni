import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Netron } from '@omnitron-dev/titan/netron';
import { UnixSocketTransport } from '@omnitron-dev/titan/netron/transport/unix';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { quoteForShell } from '@xec-sh/core';
import { TerminalRpcService } from '../../apps/omnitron/src/services/terminal.rpc-service.ts';
import { createAuthContextWrapper } from '../../apps/omnitron/src/services/auth-context.ts';
import { nodeHostPinKey, nodeSshIdentity } from '../../apps/omnitron/src/services/node-host-key.ts';
import { checkPipelineDefinition } from '../../apps/omnitron/src/services/pipeline-definition.ts';
import { blockPreseedDefinition } from '../commands/block-preseed.js';

const spec = { id: 'd24f5061-e7c7-4aa3-ad78-a9752ffe90ab', sourceNode: 'node-one', receiverNode: 'node-two',
  sourceFingerprint: 'SHA256:' + 'A'.repeat(43), receiverFingerprint: 'SHA256:' + 'B'.repeat(43),
  sourceIp: '192.0.2.1', receiverIp: '192.0.2.2', receiverPort: 22, blocks: '/example/blocks',
  stageParent: '/example/staging', firstActive: 2, rateKiB: 128, ttlMinutes: 2 };
const wire = Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020', 'hex'),
  generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]);
const offer = { protocol: 1, id: spec.id, spec: 'a'.repeat(64), publicKey: 'ssh-ed25519 ' + wire.toString('base64'),
  manifest: 'b'.repeat(64), files: 2, bytes: 128, issued: 200, expires: 320 };

test('stock pipeline checker admits each graph with registered-node dependencies and no private material', async () => {
  for (const phase of ['offer', 'copy', 'accept', 'revoke']) {
    const graph = await blockPreseedDefinition(phase, spec, ['copy', 'accept'].includes(phase) ? offer : undefined);
    await checkPipelineDefinition(graph);
    assert.equal(graph.steps[0].name, 'registered-pins');
    assert.equal(graph.steps[0].nodeId, undefined);
    assert(graph.steps.slice(1).every(step => [spec.sourceNode, spec.receiverNode].includes(step.nodeId) && step.retries === 0));
    assert.doesNotMatch(JSON.stringify(graph), /BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY/);
    if (phase === 'accept') assert(graph.steps.every(step => Buffer.byteLength(step.run) <= 22 * 1024));
    if (phase === 'accept')
      assert.deepEqual(graph.steps.slice(1).map(step => [step.name, step.nodeId, step.dependsOn]),
        [['seal', spec.receiverNode, ['registered-pins']], ['forget', spec.sourceNode, ['seal']]]);
    if (phase === 'copy')
      assert.deepEqual(graph.steps.slice(1).map(step => [step.name, step.nodeId, step.dependsOn]),
        [['grant', spec.receiverNode, ['registered-pins']], ['send', spec.sourceNode, ['grant']],
          ['seal', spec.receiverNode, ['send']], ['forget', spec.sourceNode, ['seal']]]);
  }
});

test('only the bounded public contract and exact offers can be exported', async () => {
  for (const change of [{ receiverNode: 'local' }, { sourceNode: spec.receiverNode }, { receiverFingerprint: spec.sourceFingerprint },
    { sourceIp: '192.0.2.0/24' }, { blocks: '/example/wallets' }, { stageParent: '/example/../etc' },
    { ttlMinutes: 0 }, { rateKiB: 0 }, { privateKey: 'invalid' }])
    await assert.rejects(blockPreseedDefinition('offer', { ...spec, ...change }), /Invalid/);
  for (const change of [{ id: 'foreign' }, { publicKey: offer.publicKey + ' options' }, { secret: 'invalid' }])
    await assert.rejects(blockPreseedDefinition('copy', spec, { ...offer, ...change }), /public offer/);
});

test('the exported registration check requires the exact observed and already trusted key on both nodes', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'block-preseed-pins-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = { id: spec.sourceNode, host: 'source.invalid', sshPort: 22, sshUser: 'fixture' };
  const receiver = { ...source, id: spec.receiverNode, host: 'receiver.invalid' };
  const nodes = new Map([source, receiver].map(n => [n.id, n]));
  const observed = new Map([[source.host, spec.sourceFingerprint], [receiver.host, spec.receiverFingerprint]]);
  const keys = new Map([source, receiver].map(n => [nodeHostPinKey(n.id), { target: nodeSshIdentity(n), fingerprint: observed.get(n.host) }]));
  const probed = [];
  const terminal = new TerminalRpcService(
    { getNode: id => nodes.get(id) }, {}, { kvGetSync: id => keys.get(id) }, {}, {},
    { probe: async ({ host }) => { probed.push(host); return observed.get(host); } },
  );
  const socket = path.join(directory, 'rpc.sock');
  const server = new Netron(createNullLogger(), { id: 'registered-pin-test' });
  t.after(async () => { terminal.dispose(); await server.stop(); });
  server.registerTransport('unix', () => new UnixSocketTransport());
  server.registerTransportServer('unix', { name: 'local', options: {
    path: socket, mode: 0o600, invocationWrapper: createAuthContextWrapper(),
  } });
  server.setTransportAuthContext('unix', {
    userId: 'omnitron-local', roles: ['admin'], permissions: [], metadata: { source: 'local-unix-socket' },
  });
  await server.start();
  await server.peer.exposeService(terminal);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const q = arg => quoteForShell(arg, 'posix');
  const file = path.join(directory, 'omnitron');
  await fs.writeFile(file, `#!/bin/sh\nexec ${q(process.execPath)} --import tsx ${q(path.join(root, 'apps/omnitron/src/cli/omnitron.ts'))} "$@"\n`, { mode: 0o700 });
  const graph = await blockPreseedDefinition('offer', spec), run = promisify(execFile);
  const opts = { cwd: root, env: { ...process.env, PATH: directory + path.delimiter + process.env.PATH,
    OMNITRON_HOME: directory, OMNITRON_SOCKET: socket, OMNITRON_OUTPUT: 'json' } };
  const check = () => run('/bin/sh', ['-c', graph.steps[0].run], opts);
  const result = await check();
  assert.deepEqual(result.stdout.trim().split('\n').map(line => JSON.parse(line).data), [
    { nodeId: source.id, fingerprint: spec.sourceFingerprint }, { nodeId: receiver.id, fingerprint: spec.receiverFingerprint },
  ]);
  assert.deepEqual(probed.splice(0), [source.host, receiver.host]);
  observed.set(source.host, spec.receiverFingerprint);
  await assert.rejects(check(), /fingerprint differs/);
  assert.deepEqual(probed.splice(0), [source.host]);
  observed.set(source.host, spec.sourceFingerprint);
  keys.delete(nodeHostPinKey(receiver.id));
  await assert.rejects(check(), /fingerprint differs/);
  assert.equal(keys.has(nodeHostPinKey(receiver.id)), false);
  nodes.set(receiver.id, source);
  await assert.rejects(check(), /different node ID/);
  await assert.rejects(run(file, ['node', 'ssh-key', 'node-', '--expect', spec.sourceFingerprint], opts), /registered remote SSH node/);
  await assert.rejects(run(file, ['node', 'ssh-key', source.id, '--trust', spec.sourceFingerprint, '--expect', spec.sourceFingerprint], opts), /without --trust/);
});

test('the public Xec process flushes an entire copy definition to a pipe', async t => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'block-preseed-export-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const specFile = path.join(directory, 'spec.json'), offerFile = path.join(directory, 'offer.json');
  await fs.writeFile(specFile, JSON.stringify(spec));
  await fs.writeFile(offerFile, JSON.stringify(offer));
  const { stdout } = await promisify(execFile)(path.join(root, 'node_modules/.bin/xec'),
    ['block-preseed', 'copy', specFile, '--offer', offerFile], { cwd: root, maxBuffer: 1024 * 1024 });
  assert(stdout.length > 65536);
  assert.deepEqual(JSON.parse(stdout), await blockPreseedDefinition('copy', spec, offer));
});
