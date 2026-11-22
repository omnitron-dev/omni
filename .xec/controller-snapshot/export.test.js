import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controllerSnapshotDefinition, snapshotConsent, snapshotSpecDigest } from '../commands/controller-snapshot.js';

const id = '2a111111-1111-4111-8111-111111111111';
const spec = {
  id,
  sourceNode: 'before',
  receiverNode: 'vault',
  sourceIp: '192.0.2.10',
  receiverIp: '192.0.2.11',
  sourceFingerprint: 'SHA256:' + 'a'.repeat(43),
  receiverFingerprint: 'SHA256:' + 'b'.repeat(43),
  receiverPort: 22,
  stageParent: '/srv/backup',
  sourceUid: 0,
  ownerReceipt: '/root/.omnitron/execution/managed-owner.json',
  ttlMinutes: 120,
  maxBytes: 20 * 1024 ** 3,
  sourceReserveBytes: 4 * 1024 ** 3,
  receiverReserveBytes: 8 * 1024 ** 3,
  rateKiB: 20480,
};
const offer = {
  id,
  protocol: 1,
  format: 'omnitron-controller-sqlite-v1',
  issued: 1700000000,
  expires: 1700007200,
  spec: 'a'.repeat(64),
  manifest: 'b'.repeat(64),
  publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI' + 'B'.repeat(43),
};

test('capture and separately reviewed in-place restore use registered nodes and bounded management commands', async () => {
  for (const [phase, actions] of Object.entries({
    offer: ['offer'],
    warm: ['grant', 'warm'],
    cold: ['grant', 'cold', 'seal', 'forget'],
    accept: ['seal', 'forget'],
    revoke: ['revoke', 'forget'],
    restore: ['grant', 'export', 'restore', 'revoke', 'forget'],
    release: ['release'],
  })) {
    const restoring = phase === 'restore' || phase === 'release';
    const input = restoring
      ? { ...spec, id: '3a111111-1111-4111-8111-111111111111', restore: { id, sha256: '3'.repeat(64) } }
      : spec;
    const token = ['warm', 'cold', 'accept', 'restore'].includes(phase)
      ? { ...offer, id: input.id, spec: snapshotSpecDigest(input) }
      : undefined;
    const graph = await controllerSnapshotDefinition(phase, input, token);
    assert.equal(graph.steps[0].name, 'registered-pins');
    assert.deepEqual(
      graph.steps.filter((s) => s.nodeId && !s.name.includes('-helper-')).map((s) => s.name),
      actions
    );
    for (const step of graph.steps.slice(1)) {
      assert.ok(step.timeout >= 120000 && step.retries === 0);
      assert.ok(Buffer.byteLength(step.run) <= 22 * 1024);
      assert.ok(['before', 'vault'].includes(step.nodeId));
    }
  }
  await assert.rejects(() => controllerSnapshotDefinition('restore', spec, offer));
  await assert.rejects(() => controllerSnapshotDefinition('warm', { ...spec, paths: ['/'] }, offer));
  await assert.rejects(() => controllerSnapshotDefinition('offer', { ...spec, ownerReceipt: '/root/keys' }));
});

test('independent local approvals bind the full specification and the exact public source key', () => {
  const now = Math.floor(Date.now() / 1000),
    expires = now + 150;
  const token = { ...offer, spec: snapshotSpecDigest(spec), issued: now, expires: now + spec.ttlMinutes * 60 };
  assert.deepEqual(snapshotConsent('source', spec, expires), { schema: 1, side: 'source', spec: token.spec, expires });
  assert.equal(snapshotConsent('receiver', spec, expires, token).key, token.publicKey);
  assert.throws(() => snapshotConsent('receiver', spec, expires));
  assert.throws(() => snapshotConsent('receiver', { ...spec, sourceReserveBytes: 10 }, expires, token));
  assert.throws(() => snapshotConsent('source', spec, now - 5));
});
