import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stopPrivateFixtureStack } from './managed-owner-roundtrip.mjs';
import { applicationSdkOption } from './managed-project-runtime.mjs';

test('admits only the separately pinned installed application SDK before the owner lifecycle starts', async t => {
  const sdk = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-sdk-input-'));
  t.after(() => fs.rm(sdk, {recursive:true, force:true}));
  const application = 'a'.repeat(40), controller = 'b'.repeat(40);
  await fs.mkdir(path.join(sdk, 'dist'));
  await fs.writeFile(path.join(sdk, 'package.json'), JSON.stringify({name:'@omnitron-dev/omnitron'}));
  const stamp = path.join(sdk, 'dist/BUILD.json');
  await fs.writeFile(stamp, JSON.stringify({commit:application, dirty:false}));
  const args = ['/owner', '/controller', '--owner-roundtrip', '--application-sdk', sdk, '--application-sdk-commit'];
  assert.deepEqual(await applicationSdkOption([...args, application]), {root:await fs.realpath(sdk), commit:application});
  await assert.rejects(applicationSdkOption([...args, controller]), /independently reviewed/);
  await assert.rejects(applicationSdkOption(args), /exactly once/);
  await assert.rejects(applicationSdkOption([...args, application, '--application-sdk-commit', application]), /exactly once/);
  await fs.writeFile(stamp, JSON.stringify({commit:application, dirty:true}));
  await assert.rejects(applicationSdkOption([...args, application]), /clean sources/);
  assert.equal(await applicationSdkOption(['/owner', '/controller', '--owner-roundtrip']), undefined);
});

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
