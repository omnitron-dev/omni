import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { checkedHostReview, hostBindingsInspection, stagedUnitInspection } from '../commands/host-bindings.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const reviewed = { protocol: 1, project: 'sample', stack: 'ledger', release: 'r1', commit: 'a'.repeat(40),
  nodeId: 'registered', sshFingerprint: 'SHA256:' + 'A'.repeat(43), manifestSha256: hash('release'),
  referencesSha256: hash('public reference identities'),
  bindings: [
    ['bitcoin', 'bitcoind.service', 'bitcoin', '/etc/bitcoin/bitcoin.conf'],
    ['monero-daemon', 'monerod.service', 'monero', '/etc/monero/monerod.conf'],
    ['monero-wallet-rpc', 'monero-wallet-rpc.service', 'monero-wallet', '/etc/monero/monero-wallet-rpc.conf'],
  ].map(([name, unit, user, config], i) => ({ name, unit, user, config, chainDataDir: ['/var/lib/bitcoind', '/var/lib/monero/.bitmonero', null][i],
    unitSha256: hash(unit), templateSha256: hash(config) })) };
reviewed.digest = hash(JSON.stringify([1, reviewed.project, reviewed.stack, reviewed.release, reviewed.commit, reviewed.manifestSha256,
  reviewed.nodeId, reviewed.sshFingerprint, reviewed.referencesSha256,
  reviewed.bindings.map(b => [b.name, b.unit, b.user, b.config, b.chainDataDir, b.unitSha256, b.templateSha256])]));
const stage = '/srv/prepared/host-units-aaaaaaaa';
const expiry = '2026-01-01T09:30:00Z';
const now = Date.parse('2026-01-01T09:00:00Z');

test('accepts the CLI envelope and only exports registered passive inspection', async () => {
  const graph = await hostBindingsInspection({ ok: true, data: reviewed }, reviewed.digest, stage, expiry, now);
  assert.deepEqual(graph.steps.map(step => step.name), ['registered-pin', 'inspect-host-bindings']);
  assert.equal(graph.steps[1].nodeId, reviewed.nodeId);
  assert.ok(graph.steps.every(step => !step.retries && Buffer.byteLength(step.run) < 18000));
});

test('refuses substituted recipient, protected paths, extra supplied data, bad digest and expiry', async () => {
  assert.throws(() => checkedHostReview({ ...reviewed, nodeId: 'different' }, reviewed.digest));
  assert.throws(() => checkedHostReview({ ...reviewed, secret: 'fake' }, reviewed.digest));
  assert.throws(() => checkedHostReview({ ...reviewed, bindings: reviewed.bindings.map(b => ({ ...b, config: '/tmp/x' })) }, reviewed.digest));
  await assert.rejects(hostBindingsInspection(reviewed, '0'.repeat(64), stage, expiry, now));
  await assert.rejects(hostBindingsInspection(reviewed, reviewed.digest, '/etc/systemd/host-units-aaaaaaaa', expiry, now));
  await assert.rejects(hostBindingsInspection(reviewed, reviewed.digest, stage, expiry, now + 3600000));
});

test('legacy public artifact inspection binds every byte and never places supplied file contents in the graph', async () => {
  const artifact = { revision: reviewed.commit, units: reviewed.bindings.map(b => ({ name: b.unit, user: b.user,
    text: 'distinct-public-' + b.unit, sha256: hash('distinct-public-' + b.unit) })) };
  const bytes = Buffer.from(JSON.stringify(artifact));
  const selection = { expectArtifact: hash(bytes), nodeId: reviewed.nodeId, fingerprint: reviewed.sshFingerprint, stage, expires: expiry };
  const graph = await stagedUnitInspection(bytes, selection, now);
  const body = JSON.parse(Buffer.from(graph.steps[1].run.split(' ').at(-1), 'base64'));
  assert.equal(body.basis, 'staged-public-units');
  assert.equal(body.review.bindings.length, 3);
  assert.doesNotMatch(JSON.stringify(body), /distinct-public-|templateSha256|referencesSha256/);
  await assert.rejects(stagedUnitInspection(Buffer.concat([bytes, Buffer.from('\n')]), selection, now));
  artifact.units[0].text += 'changed';
  const switched = Buffer.from(JSON.stringify(artifact));
  await assert.rejects(stagedUnitInspection(switched, { ...selection, expectArtifact: hash(switched) }, now));
});
