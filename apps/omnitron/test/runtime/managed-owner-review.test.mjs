import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stopPrivateFixtureStack } from './managed-owner-roundtrip.mjs';
import { applicationSdkOption } from './managed-project-runtime.mjs';

const managementDist = fileURLToPath(new URL('../../dist/', import.meta.url));
const execute = promisify(execFile);

async function applicationProject(t) {
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-sdk-input-'));
  t.after(() => fs.rm(checkout, {recursive:true, force:true}));
  await fs.writeFile(path.join(checkout, 'package.json'), JSON.stringify({name:'consumer', version:'1.0.0'}));
  const dependencies = {};
  for (const name of ['@omnitron-dev/omnitron', '@omnitron-dev/titan', '@omnitron-dev/titan-storage']) {
    const root = path.join(checkout, 'node_modules', name);
    await fs.mkdir(path.join(root, 'dist'), {recursive:true});
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({name, version:'1.0.0'}));
    dependencies[name] = await fs.realpath(root);
  }
  return {project:await fs.realpath(checkout), checkout:await fs.realpath(checkout), root:dependencies['@omnitron-dev/omnitron'], dependencies};
}

test('admits only the separately pinned installed application SDK before the owner lifecycle starts', async t => {
  const project = await applicationProject(t), sdk = project.root;
  const application = 'a'.repeat(40), controller = 'b'.repeat(40);
  const stamp = path.join(sdk, 'dist/BUILD.json');
  await fs.writeFile(stamp, JSON.stringify({commit:application, dirty:false}));
  const args = ['/owner', '/controller', '--owner-roundtrip', '--application-project', project.checkout, '--application-sdk-commit'];
  assert.deepEqual(await applicationSdkOption([...args, application], managementDist), {...project, commit:application});
  await assert.rejects(applicationSdkOption([...args, controller], managementDist), /independently reviewed/);
  await assert.rejects(applicationSdkOption(args, managementDist), /exactly once/);
  await assert.rejects(applicationSdkOption([...args, application, '--application-sdk-commit', application], managementDist), /exactly once/);
  await fs.writeFile(stamp, JSON.stringify({commit:application, dirty:true}));
  await assert.rejects(applicationSdkOption([...args, application], managementDist), /clean sources/);
  assert.equal(await applicationSdkOption(['/owner', '/controller', '--owner-roundtrip']), undefined);
  await assert.rejects(applicationSdkOption(['--application-sdk', sdk]), /installed consumer checkout/);
});

test('loads the native fixture without a built source checkout and uses only its explicit artifact', async t => {
  const project = await applicationProject(t), commit = 'c'.repeat(40);
  await fs.writeFile(path.join(project.root, 'dist/BUILD.json'), JSON.stringify({commit, dirty:false}));
  const helper = path.join(project.checkout, 'fixture.mjs');
  await fs.copyFile(new URL('./managed-project-runtime.mjs', import.meta.url), helper);
  const moduleUrl = pathToFileURL(helper).href;
  const args = ['--owner-roundtrip', '--application-project', project.checkout, '--application-sdk-commit', commit];
  const code = `
    import assert from 'node:assert/strict';
    const {applicationSdkOption} = await import(${JSON.stringify(moduleUrl)});
    assert.equal(await applicationSdkOption(['/old', '/new']), undefined);
    await assert.rejects(applicationSdkOption(${JSON.stringify(args)}), /reviewed management artifact/);
    const inspected = await applicationSdkOption(${JSON.stringify(args)}, ${JSON.stringify(managementDist)});
    assert.equal(inspected.commit, ${JSON.stringify(commit)});
    assert.equal(inspected.project, ${JSON.stringify(project.project)});
  `;
  await execute(process.execPath, ['--input-type=module', '--eval', code], {
    cwd: project.checkout, timeout: 30_000,
  });
});

test('refuses a missing workload dependency before creating native services', async t => {
  const project = await applicationProject(t);
  await fs.rm(project.dependencies['@omnitron-dev/titan-storage'], {recursive:true});
  await assert.rejects(applicationSdkOption(['--owner-roundtrip', '--application-project', project.checkout,
    '--application-sdk-commit', 'a'.repeat(40)], managementDist), /must provide @omnitron-dev\/titan-storage/);
});

test('accepts virtual-store siblings inside the consumer workspace', async t => {
  const project = await applicationProject(t);
  await fs.writeFile(path.join(project.checkout, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  const app = path.join(project.checkout, 'apps/consumer');
  await fs.mkdir(path.join(app, 'node_modules/@omnitron-dev'), {recursive:true});
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({name:'app', version:'1.0.0'}));
  for (const [name, root] of Object.entries(project.dependencies)) await fs.symlink(root, path.join(app, 'node_modules', name), 'dir');
  await fs.writeFile(path.join(project.root, 'dist/BUILD.json'), JSON.stringify({commit:'a'.repeat(40), dirty:false}));
  assert.deepEqual(await applicationSdkOption(['--owner-roundtrip', '--application-project', app,
    '--application-sdk-commit', 'a'.repeat(40)], managementDist), {...project, project:app, commit:'a'.repeat(40)});
});

test('refuses transitive dependencies outside the reviewed consumer installation', async t => {
  const project = await applicationProject(t), external = await applicationProject(t);
  const sdk = project.root;
  await fs.writeFile(path.join(sdk, 'package.json'), JSON.stringify({name:'@omnitron-dev/omnitron', version:'1.0.0', dependencies:{escape:'1.0.0'}}));
  await fs.mkdir(path.join(sdk, 'node_modules'));
  await fs.symlink(external.root, path.join(sdk, 'node_modules/escape'), 'dir');
  await assert.rejects(applicationSdkOption(['--owner-roundtrip', '--application-project', project.checkout,
    '--application-sdk-commit', 'a'.repeat(40)], managementDist), /escapes the frozen checkouts/);
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
