import assert from 'node:assert/strict';
import test from 'node:test';
import { stopPrivateFixtureStack } from './managed-owner-roundtrip.mjs';

const scope = { project: 'probe', stack: 'local' };
const review = () => ({ ...scope, digest: 'ab'.repeat(32), targets: [
  { node: 'local', applications: ['probe/local/counter'], containers: [] },
] });

test('counter stop uses the same digest-bound empty footprint with old and new review replies', async () => {
  for (const runtime of [undefined, scope]) {
    const evidence = review();
    if (runtime) evidence.targets[0].runtime = runtime;
    const calls = [];
    await stopPrivateFixtureStack({
      async reviewStackStop(input) { assert.deepEqual(input, scope); return evidence; },
      async stopStack(input) { calls.push(input); return { status: 'stopped', stopOperation: { phase: 'stopped' } }; },
    });
    assert.deepEqual(calls, [{ ...scope, review: evidence.digest }]);
  }
});

for (const [name, change] of [
  ['another project', value => { value.project = 'other'; }],
  ['another stack', value => { value.stack = 'other'; }],
  ['missing digest', value => { value.digest = null; }],
  ['another node', value => { value.targets[0].node = 'remote'; }],
  ['multiple targets', value => { value.targets.push({ ...value.targets[0] }); }],
  ['uncertain inventory', value => { value.targets[0].reason = 'unreachable'; }],
  ['another runtime', value => { value.targets[0].runtime = { project: 'other', stack: 'local' }; }],
  ['another application', value => { value.targets[0].applications.push('other/local/app'); }],
  ['owned infrastructure', value => { value.targets[0].containers.push('database'); }],
  ['missing infrastructure evidence', value => { delete value.targets[0].containers; }],
]) {
  test(`refuses ${name} before any stop`, async () => {
    const evidence = review(); change(evidence);
    let stopped = false;
    await assert.rejects(stopPrivateFixtureStack({
      async reviewStackStop() { return evidence; },
      async stopStack() { stopped = true; throw new Error('must not stop'); },
    }));
    assert.equal(stopped, false);
  });
}
