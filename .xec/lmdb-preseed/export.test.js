import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import test from 'node:test';
import { checkPipelineDefinition } from '../../apps/omnitron/src/services/pipeline-definition.ts';
import { lmdbDefinition, preparedDataDefinition } from '../commands/lmdb-preseed.js';
import { sha } from './build.js';

const elf = randomBytes(70 * 1024);
Buffer.from([127, 69, 76, 70, 2, 1]).copy(elf);
elf.writeUInt16LE(62, 18);
const spec = { id: '705f8e4c-d502-4c07-9327-c394760555af', sourceNode: 'fixture-one', receiverNode: 'fixture-two',
  sourceFingerprint: 'SHA256:' + 'A'.repeat(43), receiverFingerprint: 'SHA256:' + 'B'.repeat(43), sourceIp: '192.0.2.10',
  receiverIp: '192.0.2.20', receiverPort: 22, stageParent: '/srv/private-staging', rateKiB: 24576, ttlMinutes: 20,
  lmdb: '/srv/chain/lmdb', payload: 'monero-lmdb-compact-v1', nettype: 'mainnet', machine: 'x86_64', minimumHeight: 8,
  maxBytes: 512 * 1024, helperSha256: sha(elf) };
const pub = Buffer.concat([Buffer.from('0000000b7373682d6564323535313900000020', 'hex'),
  generateKeyPairSync('ed25519').publicKey.export({ format: 'der', type: 'spki' }).subarray(-32)]);
const offer = { protocol: 1, id: spec.id, spec: 'a'.repeat(64), publicKey: 'ssh-ed25519 ' + pub.toString('base64'),
  manifest: 'b'.repeat(64), issued: 100, expires: 100 + 60 * spec.ttlMinutes, format: spec.payload,
  sourceFreeFloorBytes: 8 * 1024 ** 3, pollSeconds: 5, anchor: { nettype: 'mainnet', height: 8, checkpointHeight: 1,
    genesis: 'c'.repeat(64), tip: 'd'.repeat(64), checkpointHash: 'e'.repeat(64) } };

test('preparing an independent database uses the sealed bytes on the registered receiver', async () => {
  const seal = { sealed: true, stage: spec.stageParent + '/block-preseed-' + spec.id, manifest: offer.manifest,
    offer: 'f'.repeat(64), sha256: '8'.repeat(64), bytes: 8192, format: spec.payload, database: { height: 10 } };
  const graph = await preparedDataDefinition(spec, offer, seal, 4096);
  await checkPipelineDefinition(graph);
  assert.deepEqual(graph.steps.map(s => s.name), ['registered-pins', 'prepare-data']);
  assert.equal(graph.steps[1].nodeId, spec.receiverNode);
  assert.equal(graph.steps[1].retries, 0);
  assert(graph.steps.every(s => Buffer.byteLength(s.run) <= 24 * 1024));
  for (const change of [{ sealed: false }, { stage: '/' }, { manifest: '0'.repeat(64) }, { bytes: spec.maxBytes + 1 }])
    await assert.rejects(preparedDataDefinition(spec, offer, { ...seal, ...change }, 4096), /successful seal/);
  await assert.rejects(preparedDataDefinition(spec, offer, seal, -1), /free-space reserve/);
});

test('the stock engine accepts bounded content-addressed installation and each reviewed lifecycle', async () => {
  const phases = { offer: ['offer'], copy: ['grant', 'send', 'seal', 'forget'], accept: ['seal', 'forget'], revoke: ['revoke', 'forget'] };
  for (const [phase, actions] of Object.entries(phases)) {
    const graph = await lmdbDefinition(phase, spec, ['copy', 'accept'].includes(phase) ? offer : undefined, phase === 'revoke' ? undefined : elf);
    await checkPipelineDefinition(graph);
    assert.equal(graph.steps[0].name, 'registered-pins');
    assert(graph.steps.every(step => Buffer.byteLength(step.run) <= 24 * 1024));
    assert.deepEqual(graph.steps.slice(-actions.length).map(step => step.name), actions);
    const install = graph.steps.filter(step => step.name.startsWith('helper-part-') || step.name === 'checked-helper');
    if (phase === 'revoke') { assert.deepEqual(install, []); continue; }
    assert(install.length > 2);
    assert.equal(install.at(-1).name, 'checked-helper');
    for (const [i, part] of install.entries()) {
      assert(part.run.length < 12 * 1024);
      assert.deepEqual(part.dependsOn, [i ? install[i - 1].name : 'registered-pins']);
      assert.equal(part.retries, 0);
      assert.equal(part.nodeId, phase === 'offer' ? spec.sourceNode : spec.receiverNode);
    }
  }
});

test('the private source, helper, bounds and chain checkpoint are explicit', async () => {
  for (const change of [{ lmdb: '/srv/chain/wallets' }, { nettype: 'other' }, { rateKiB: 24577 }, { ttlMinutes: 1441 },
    { minimumHeight: 1 }, { payload: 'other' }, { sourceIp: spec.receiverIp }, { helperSha256: undefined }, { key: 'unexpected' }])
    await assert.rejects(lmdbDefinition('offer', { ...spec, ...change }, undefined, elf), /Invalid/);
  await assert.rejects(lmdbDefinition('offer', spec, undefined, elf.subarray(0, 65)), /ELF/);
  await assert.rejects(lmdbDefinition('offer', { ...spec, machine: 'aarch64' }, undefined, elf), /ELF/);
  await assert.rejects(lmdbDefinition('accept', spec, { ...offer, anchor: { ...offer.anchor, height: 2 } }, elf), /public offer/);
  await assert.rejects(lmdbDefinition('revoke', spec, offer), /reviewed helper/);
});
