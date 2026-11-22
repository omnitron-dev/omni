import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { checkedDeclaration, compareOriginal } from './legacy.mjs';

const id = char => char.repeat(64);
const release = { protocol: 1, project: 'site', stack: 'local', release: 'release-1', manifestSha256: id('1') };
const spec = { name: 'site-local-store', image: 'example:1', environment: { SERVICE_PASSWORD: { binding: 'site:store' } },
  labels: { 'omnitron.managed': 'true', 'omnitron.project': 'site', 'omnitron.stack': 'local', 'omnitron.service': 'store' } };
const subject = { ...release, services: [{ originalId: id('a'), imageId: 'sha256:' + id('c'), spec }] };
const secret = 'synthetic-control-value';
const fingerprint = d => createHash('sha256').update(JSON.stringify(d.environment)).digest('hex').slice(0, 16);
const old = fingerprint({ environment: { SERVICE_PASSWORD: secret } });
function inventory({ other = false, tagMoved = false, schema = false } = {}) {
  const argsSeen = [];
  return { argsSeen, read(args) {
    argsSeen.push(args);
    if (args[0] === 'image') return 'sha256:' + id(tagMoved ? 'd' : 'c');
    assert.equal(args[0], 'ps');
    assert(args.includes('--no-trunc'));
    if (args.some(x => x === 'label=omnitron.spec-hash-schema')) return schema ? id('a') : '';
    if (args.some(x => x.startsWith('label=omnitron.spec-hash='))) return args.includes('label=omnitron.spec-hash=' + old) ? id('a') : '';
    return args.includes('--all') && other ? [id('a'), id('b')].join('\n') : id('a');
  } };
}
test('matches the same immutable original without placing an environment value on a command or in a receipt', () => {
  const target = inventory();
  const result = compareOriginal(subject, { docker: args => target.read(args), fingerprint, bindings: { 'site:store': secret } });
  assert.equal(result.eligible, true);
  assert.equal(result.services.store, 'matched');
  assert(!JSON.stringify([result, target.argsSeen]).includes(secret));
  assert(!JSON.stringify(result).includes(old));
});
test('an unavailable or changed binding makes equality ineligible', () => {
  const target = inventory();
  assert.equal(compareOriginal(subject, { docker: target.read, fingerprint }).services.store, 'binding-required');
  const review = compareOriginal(subject, { docker: target.read, fingerprint, bindings: { 'site:store': 'changed' } });
  assert.equal(review.eligible, false);
  assert.equal(review.services.store, 'different');
  assert.throws(() => compareOriginal(subject, { docker: target.read, fingerprint, bindings: { unexpected: secret } }));
});
test('rejects a stopped foreign object, changed image identity, versioned creation or ambiguous original', () => {
  for (const mismatch of [{ other: true }, { tagMoved: true }, { schema: true }])
    assert.throws(() => compareOriginal(subject, { docker: inventory(mismatch).read, fingerprint }));
  assert.throws(() => checkedDeclaration({ ...subject, services: [...subject.services, ...subject.services] }));
});
