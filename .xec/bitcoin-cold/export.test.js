import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { coldDefinition } from '../commands/bitcoin-cold.js';

const pin = (c) => 'SHA256:' + c.repeat(43);
const core = {
  id: randomUUID(),
  sourceNode: 'source',
  receiverNode: 'target',
  sourceIp: '192.0.2.2',
  receiverIp: '192.0.2.3',
  sourceFingerprint: pin('a'),
  receiverFingerprint: pin('b'),
  receiverPort: 22,
  stageParent: '/srv/stage',
  ttlMinutes: 60,
};
const spec = {
  ...core,
  rateKiB: 32768,
  dataDir: '/var/lib/bitcoind',
  blocks: '/var/lib/bitcoind/blocks',
  sourceUnit: 'bitcoind.service',
  sourceBootId: randomUUID(),
  sourceStartUsec: '1001',
  chain: 'main',
  pruneMiB: 131072,
  indexes: [],
  anchorHeight: 900000,
  anchorHash: 'c'.repeat(64),
  hotId: randomUUID(),
  hotManifest: 'd'.repeat(64),
  candidateParent: '/srv/candidate',
  targetUser: 'bitcoin',
  targetUid: 500,
  targetGid: 600,
};
const offer = {
  id: spec.id,
  format: 'bitcoin-core-public-cold-v1',
  protocol: 1,
  spec: 'a'.repeat(64),
  manifest: 'b'.repeat(64),
  bytes: 130,
  files: 12,
  reuseBytes: 48,
  reuseFiles: 2,
  issued: 1000,
  expires: 4600,
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' + 'a'.repeat(43),
};

test('cold and read-only stages declare pinned native node targets with bounded commands', async () => {
  const probe = {
    ...core,
    dataDir: spec.dataDir,
    blocks: spec.blocks,
    sourceUnit: spec.sourceUnit,
    sourceConfig: '/etc/bitcoin/bitcoin.conf',
    sourceCli: '/usr/local/bin/bitcoin-cli',
  };
  const observe = await coldDefinition('probe', probe);
  assert.deepEqual(
    observe.steps.map((s) => s.name),
    ['registered-pins', 'observe-public-chain']
  );
  for (const [phase, expected] of Object.entries({
    offer: ['check-hot-seal', 'offer'],
    copy: ['check-hot-seal', 'grant', 'send', 'seal', 'forget'],
    accept: ['seal', 'forget'],
    revoke: ['revoke', 'forget'],
    adopt: ['adopt'],
    qualify: ['qualify'],
    publish: ['publish'],
    restore: ['restore'],
  })) {
    const checked = ['copy', 'accept', 'adopt', 'qualify', 'publish', 'restore'].includes(phase);
    const graph = await coldDefinition(phase, spec, {
      offer: checked ? offer : undefined,
      installation: ['publish', 'restore'].includes(phase)
        ? { unit: 'bitcoind.service', dataDir: '/var/lib/bitcoind', previous: { kind: 'absent' } }
        : undefined,
      release: phase === 'qualify' ? { archive: '/srv/release/bitcoin.tar.gz', machine: 'x86_64' } : undefined,
    });
    const actions = graph.steps.filter((s) => !s.name.includes('helper-part'));
    assert.deepEqual(
      actions.map((s) => s.name),
      ['registered-pins', ...expected]
    );
    assert(graph.steps.every((s) => Buffer.byteLength(s.run) <= 22 * 1024));
    for (const s of actions.slice(1))
      assert.equal(s.nodeId, ['offer', 'send', 'forget'].includes(s.name) ? 'source' : 'target');
  }
});

test('scope rejects unrelated keys, unsafe paths, unsupported optional indexes and missing operator evidence', async () => {
  for (const wrong of [
    { wallet: '/srv/wallets' },
    { indexes: ['../wallets'] },
    { dataDir: '/a/../b' },
    { hotId: spec.id },
    { targetUid: 0 },
    { sourceStartUsec: '' },
  ])
    await assert.rejects(coldDefinition('offer', { ...spec, ...wrong }));
  await assert.rejects(coldDefinition('adopt', spec, { offer: { ...offer, id: randomUUID() } }));
});
