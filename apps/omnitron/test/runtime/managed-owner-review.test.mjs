import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { stopPrivateFixtureStack, upgradePrivateFixtureBackend } from './managed-owner-roundtrip.mjs';
import { applicationSdkOption } from './managed-project-runtime.mjs';
import { preparationOption, prepareFixture, claimPreparedFixture, verifyPreparedFixture,
  assertPreparedFixtureIdle } from './fixture-preparation.mjs';

const managementDist = fileURLToPath(new URL('../../dist/', import.meta.url));
const execute = promisify(execFile);
const fixtureDirectory = fileURLToPath(new URL('.', import.meta.url));

test('backend replacement passes the installed dist to both CLI phases for rollback and restore', async () => {
  for (const commit of ['b'.repeat(40), 'c'.repeat(40)]) {
    const runtimeRoot = path.join(os.tmpdir(), 'omnitron-handoff-contract', 'runtime/releases', commit.padEnd(64, '0'));
    const directory = path.join(runtimeRoot, 'packages/0/dist');
    const calls = [];
    let pid = 101;
    const result = await upgradePrivateFixtureBackend({ runtimeRoot, commit, status: async () => ({ pid }),
      cli: async (...args) => {
        calls.push(args);
        assert.equal(args[2], directory, 'backend upgrade accepts dist, unlike backend install');
        if (args.includes('--check')) return { checked: true, build: { commit } };
        pid = 202;
        return { pid, build: { commit } };
      },
    });
    assert.deepEqual(calls, [['backend', 'upgrade', directory, '--check'], ['backend', 'upgrade', directory]]);
    assert.equal(result.before.pid, 101); assert.equal(result.changed.pid, 202);
    assert.equal(result.changed.build.commit, commit);
  }
});

for (const failure of ['not checked', 'wrong backend commit', 'changed running backend']) {
  test(`backend replacement refuses ${failure} before the CLI mutation`, async () => {
    const commit = 'b'.repeat(40), calls = [];
    let pid = 101;
    await assert.rejects(upgradePrivateFixtureBackend({
      runtimeRoot: path.join(os.tmpdir(), 'omnitron-handoff-contract'), commit, status: async () => ({ pid }),
      cli: async (...args) => {
        calls.push(args);
        assert.ok(args.includes('--check'), 'Failed admission must not reach backend replacement');
        if (failure === 'changed running backend') pid = 202;
        return { checked: failure !== 'not checked', build: { commit: failure === 'wrong backend commit' ? 'a'.repeat(40) : commit } };
      },
    }));
    assert.equal(calls.length, 1);
  });
}

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

async function preparedInstallation(t) {
  const { RuntimeInstallation } = await import(pathToFileURL(path.join(managementDist, 'daemon/runtime-installation.js')).href);
  const { runtimeArtifactDigest } = await import(pathToFileURL(path.join(managementDist, 'shared/runtime-artifact.js')).href);
  const workspace = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'omni-preparation-test-')));
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const root = path.join(workspace, 'private');
  for (const directory of [root, path.join(root, 'i'), path.join(root, 'e')]) await fs.mkdir(directory, { mode: 0o700 });
  const inputs = {};
  for (const [role, commit] of [['owner', 'a'], ['backend', 'b'], ['candidate', 'c']]) {
    const source = path.join(workspace, 'omnitron-handoff-' + role), dist = path.join(source, 'packages/0/dist');
    for (const directory of ['daemon', 'cli', 'database/migrations']) await fs.mkdir(path.join(dist, directory), { recursive: true, mode: 0o700 });
    const build = { commit: commit.repeat(40), dirty: false, builtAt: '2026-01-01T00:00:00.000Z', timeBasis: 'source' };
    await fs.writeFile(path.join(dist, 'BUILD.json'), JSON.stringify(build));
    await fs.writeFile(path.join(dist, 'daemon/daemon-entry.js'), 'export {};');
    await fs.writeFile(path.join(dist, 'cli/installed.js'), 'export {};');
    // As in runtime-installation.test.ts, this tiny executable supplies only the
    // preflight wire response. The real installation/digest/SQLite APIs run here.
    await fs.writeFile(path.join(source, 'node'), `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify({ protocol: 1, build })}'\n`, { mode: 0o700 });
    const sha256 = await runtimeArtifactDigest(source);
    await fs.writeFile(path.join(source, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256,
      platform: process.platform, arch: process.arch, nodeVersion: process.version, packages: 1 }));
    inputs[role] = source;
  }
  inputs.guardian = inputs.owner;
  const ordered = { owner: inputs.owner, backend: inputs.backend, guardian: inputs.guardian, candidate: inputs.candidate };
  const events = [];
  const prepared = await prepareFixture({ root, id: randomUUID(), inputs: ordered, RuntimeInstallation,
    fixtureDirectory, mark: event => events.push(event) });
  const claim = overrides => claimPreparedFixture({ file: prepared.file, inputs: ordered, fixtureDirectory, ...overrides });
  return { workspace, root, inputs: ordered, prepared, RuntimeInstallation, events, claim };
}

test('prepares all exact roles without services and reopens verified installed copies without copying again', async t => {
  const fixture = await preparedInstallation(t);
  const { prepared, inputs, RuntimeInstallation, claim, events } = fixture;
  assert.equal(prepared.receipt.scenario, 'ordinary');
  assert.deepEqual(Object.keys(prepared.receipt.inputs), ['owner', 'backend', 'guardian', 'candidate']);
  assert.equal(prepared.receipt.inputs.guardian.sha256, prepared.receipt.inputs.owner.sha256);
  assert.equal(events.filter(event => event.stage === 'runtime-install-complete' && !event.reused).length, 3);
  assert.equal(prepared.receipt.selection.current, prepared.receipt.inputs.backend.sha256);
  const installed = prepared.artifacts.candidate.runtimeRoot;
  const before = await fs.lstat(path.join(installed, 'node'));
  await fs.writeFile(path.join(inputs.candidate, 'node'), 'source changed after private installation');
  const claimed = await claim();
  const copy = t.mock.method(fs, 'cp', async () => { throw new Error('Execution cannot copy a runtime'); });
  const verified = await verifyPreparedFixture(claimed, RuntimeInstallation);
  assert.equal(copy.mock.callCount(), 0);
  assert.equal(verified.candidate.runtimeHash, prepared.receipt.inputs.candidate.sha256);
  assert.equal((await fs.lstat(path.join(installed, 'node'))).ino, before.ino);
  assert.deepEqual(await fs.readdir(path.join(fixture.root, 'e')), []);
  assert.deepEqual(await fs.readdir(path.join(fixture.root, 'i')), ['runtime']);
  await assert.rejects(claim({ fixtureDirectory: '/missing-helper-directory' }), /already claimed/);
});

test('a full installed digest failure consumes execution and cannot be retried as a fresh fixture', async t => {
  const fixture = await preparedInstallation(t), claimed = await fixture.claim();
  await fs.writeFile(path.join(fixture.prepared.artifacts.candidate.runtimeRoot, 'node'), 'corrupt installed bytes');
  await assert.rejects(verifyPreparedFixture(claimed, fixture.RuntimeInstallation), /changed after sealing/);
  assert.ok((await fs.lstat(path.join(fixture.root, 'execute.started'))).isFile());
  await assert.rejects(fixture.claim(), /already claimed/);
});

test('only one simultaneous execution can claim a prepared fixture', async t => {
  const fixture = await preparedInstallation(t);
  const results = await Promise.allSettled([fixture.claim(), fixture.claim()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.equal(JSON.parse(await fs.readFile(path.join(fixture.root, 'execute.started'), 'utf8')).id, fixture.prepared.receipt.id);
});

for (const [name, change] of [
  ['source role', async value => ({ inputs: { ...value.inputs, backend: value.inputs.owner } })],
  ['root identity', async value => {
    const receipt = JSON.parse(await fs.readFile(value.prepared.file, 'utf8')); receipt.root.ino++;
    await fs.writeFile(value.prepared.file, JSON.stringify(receipt)); return {};
  }],
  ['helper identity', async value => {
    const receipt = JSON.parse(await fs.readFile(value.prepared.file, 'utf8')); receipt.fixture.sha256 = '0'.repeat(64);
    await fs.writeFile(value.prepared.file, JSON.stringify(receipt)); return {};
  }],
  ['socket state', async value => { await fs.writeFile(path.join(value.root, 'i/daemon.sock'), 'leftover'); return {}; }],
  ['execution state', async value => { await fs.writeFile(path.join(value.root, 'e/owner.json'), '{}'); return {}; }],
  ['staging state', async value => { await fs.mkdir(path.join(value.root, 'i/runtime/releases/.install-leftover')); return {}; }],
  ['symlink receipt', async value => {
    await fs.rename(value.prepared.file, value.prepared.file + '.original');
    await fs.symlink(value.prepared.file + '.original', value.prepared.file); return {};
  }],
  ['symlink root', async value => {
    const link = path.join(value.workspace, 'alias'); await fs.symlink(value.root, link);
    return { file: path.join(link, 'preparation.json') };
  }],
]) {
  test(`rejects changed ${name} before execution is claimed`, async t => {
    const fixture = await preparedInstallation(t);
    await assert.rejects(fixture.claim(await change(fixture)));
    await assert.rejects(fs.access(path.join(fixture.root, 'execute.started')), error => error.code === 'ENOENT');
  });
}

for (const state of ['lease', 'activation', 'selection']) {
  test(`refuses an unsettled or changed ${state} after claiming, without repairing the registry`, async t => {
    const fixture = await preparedInstallation(t), claimed = await fixture.claim();
    const store = await fixture.RuntimeInstallation.open(path.join(fixture.root, 'i'), { existing: true });
    try {
      await store.exclusive(async () => {
        if (state === 'activation') store.beginActivation(fixture.prepared.artifacts.candidate.runtimeHash,
          fixture.prepared.artifacts.backend.runtimeHash, path.join(fixture.root, 'pending.json'));
        if (state === 'selection') await store.select(fixture.prepared.artifacts.owner.runtimeHash, 1);
        if (state === 'lease') await assert.rejects(verifyPreparedFixture(claimed, fixture.RuntimeInstallation), /unsettled/);
      });
      if (state !== 'lease') await assert.rejects(verifyPreparedFixture(claimed, fixture.RuntimeInstallation), /unsettled|selection changed/);
    } finally { await store.close(); }
    await assert.rejects(fixture.claim(), /already claimed/);
  });
}

test('native absence guard inspects only its UUID units and exact execution paths, never stops them', async () => {
  const prepared = { root: '/private-isolated-fixture', receipt: { id: randomUUID() } }, calls = [];
  const observed = async (command, args) => {
    calls.push({ command, args });
    if (command === 'systemctl') return { stdout: 'not-found\n' };
    if (command === '/bin/launchctl') {
      const label = args[1].split('/').at(-1);
      throw Object.assign(new Error('Absent'), { code: 113, stderr: `Could not find service "${label}"` });
    }
    assert.equal(command, '/bin/ps');
    return { stdout: '100 node /another-fixture/i/node\n200 node --prepared /private-isolated-fixture/preparation.json\n' };
  };
  await assertPreparedFixtureIdle(prepared, observed);
  assert.equal(calls.length, 3);
  assert.ok(calls.every(call => !call.args.some(arg => ['kill', 'stop', 'bootout', 'start', 'bootstrap'].includes(arg))));
  await assert.rejects(assertPreparedFixtureIdle(prepared, async (command, args, options) => command === '/bin/ps'
    ? { stdout: '300 /private-isolated-fixture/i/runtime/releases/hash/node daemon-entry.js' } : observed(command, args, options)), /process still references/);
  await assert.rejects(assertPreparedFixtureIdle(prepared, async () => ({ stdout: 'loaded\n' })), /already exists|Missing expected rejection/);
});

test('prepared options reject mixed scenarios, ambient live selectors and duplicate or incomplete flags', () => {
  const input = ['/tmp/omnitron-handoff-owner/dist', '/tmp/omnitron-handoff-candidate/dist'];
  assert.deepEqual(preparationOption([...input, '--prepare-only'], {}), { mode: 'prepare' });
  assert.deepEqual(preparationOption([...input, '--prepared', '/tmp/private/preparation.json'], {}),
    { mode: 'execute', receipt: '/tmp/private/preparation.json' });
  for (const flags of [['--prepare-only', '--prepare-only'], ['--prepared'], ['--prepared', '/tmp/not-a-receipt'],
    ['--prepare-only', '--prepared', '/tmp/private/preparation.json'], ['--prepare-only', '--owner-roundtrip'],
    ['--prepare-only', '--master-scenario', '/tmp/scenario.mjs'], ['--prepare-only', '--unknown']]) {
    assert.throws(() => preparationOption([...input, ...flags], {}));
  }
  for (const variable of ['OMNITRON_HOME', 'OMNITRON_SOCKET', 'OMNITRON_DATABASE_URL']) {
    assert.throws(() => preparationOption([...input, '--prepare-only'], { [variable]: '' }), /must not override/);
  }
});
