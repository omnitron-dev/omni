import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
  const fixture = path.join(directory, 'omnitron');
  await fs.writeFile(fixture, `#!/usr/bin/env python3
import json,os,sys
n=sys.argv[4]
assert sys.argv[1:4] == ['--json','node','ssh-key']
f=json.loads(os.environ['PINS'])[n]
print(json.dumps({'ok':True,'data':{'nodeId':n,'observed':f[0],'trusted':f[1]}}))
`, { mode: 0o700 });
  const graph = await blockPreseedDefinition('offer', spec), run = promisify(execFile);
  const check = pins => run('/bin/sh', ['-c', graph.steps[0].run], { env: {
    PATH: directory + path.delimiter + process.env.PATH, PINS: JSON.stringify(pins),
  } });
  const source = [spec.sourceFingerprint, spec.sourceFingerprint], receiver = [spec.receiverFingerprint, spec.receiverFingerprint];
  await check({ [spec.sourceNode]: source, [spec.receiverNode]: receiver });
  for (const invalid of [[receiver[0], null], [source[0], receiver[1]], [receiver[0], source[1]]])
    await assert.rejects(check({ [spec.sourceNode]: source, [spec.receiverNode]: invalid }), /fingerprint differs/);
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
