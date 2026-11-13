import assert from 'node:assert/strict';
import test from 'node:test';
import { localStackInventory } from '../../.xec/local-stack-inventory.js';

const manifestSha256 = 'a'.repeat(64);
const scope = { project: 'source-project', stack: 'worker' };
const configuration = { name: 'imported', path: '/source', runtimeProject: scope.project, stacks: { worker: 'import' } };

function stack(name, type = 'local') {
  const runtimeScope = name === 'import' ? scope : { project: 'product', stack: name };
  return { name, type, config: { type, apps: ['api'] }, runtimeScope, status: 'running',
    apps: [{ name: 'api', handleKey: runtimeScope.project + '/' + runtimeScope.stack + '/api', status: 'online',
      generation: 'generation-' + name, pid: name === 'import' ? null : 513 }] };
}

function stopped(row) {
  row.status = 'stopped';
  row.apps = row.apps.map(app => ({ ...app, status: 'stopped', generation: undefined, pid: null }));
  return row;
}

function snapshot() {
  const dev = stack('dev');
  const imported = { ...stack('import'), selectedRelease: { id: 'release-2', manifestSha256 } };
  const stacks = [dev, imported, stopped(stack('archive')), stopped(stack('next')), stack('test', 'remote'), stack('ring', 'cluster')];
  const groups = [{ project: 'product', path: '/primary', stacks }];
  const project = { name: 'product', path: '/primary', totalStacks: stacks.length, enabledStacks: ['next', 'import', 'test'],
    configurations: [{ name: 'default', path: '/primary', runtimeProject: 'product', stacks: {} }, structuredClone(configuration)] };
  const apps = [dev, imported].map(({ apps: [app] }) => ({
    name: app.handleKey, generation: app.generation, pid: app.pid, status: app.status,
  }));
  return [{ online: true, projects: [project] }, groups, { execution: { connection: { status: 'connected' } },
    appsTotal: 2, appsOnline: 2, apps }];
}

test('batch covers running disabled and stopped enabled local stacks at their exact registered runtime scope', () => {
  const result = localStackInventory(...snapshot());
  assert.deepEqual(result.targets.map(s => [s.stack, s.enabled, s.status]), [
    ['dev', false, 'running'], ['import', true, 'running'], ['next', true, 'stopped'],
  ]);
  assert.deepEqual(result.excluded.map(s => [s.stack, s.reason]), [
    ['archive', 'disabled'], ['ring', 'remote'], ['test', 'remote'],
  ]);
  const imported = result.targets[1];
  assert.deepEqual(imported.runtimeScope, scope);
  assert.equal(imported.path, '/source');
  assert.deepEqual(imported.selection, { kind: 'release', id: 'release-2', manifestSha256 });
  assert.deepEqual(imported.apps, [
    { name: 'api', status: 'online', handleKey: 'source-project/worker/api', generation: 'generation-import', pid: null },
  ]);
  assert.deepEqual(result.targets[0].selection, { kind: 'unreported' });
  assert.deepEqual(result.targets[2].apps, [{ name: 'api', status: 'stopped', handleKey: 'product/next/api', generation: null, pid: null }]);
});

test('a zero-project online registry and an owner reporting zero processes are valid observations', () => {
  const [, , status] = snapshot();
  const input = [{ online: true, projects: [] }, [], { ...status, apps: [], appsTotal: 0, appsOnline: 0 }];
  assert.deepEqual(localStackInventory(...input), { targets: [], excluded: [] });
});

test('an old list which omits the selected release must defer to the start review even with confirmed process receipts', () => {
  const input = snapshot();
  const row = input[1][0].stacks[1];
  delete row.selectedRelease;
  row.config.watch = false;
  row.apps[0].release = { state: 'confirmed', releaseId: 'old-running-build', manifestSha256 };
  assert.deepEqual(localStackInventory(...input).targets[1].selection, { kind: 'unreported' });
});

test('a disabled stack with a live generation is included even if the stack lifecycle says stopped', () => {
  const input = snapshot();
  input[1][0].stacks[0].status = 'stopped';
  const target = localStackInventory(...input).targets.find(s => s.stack === 'dev');
  assert.equal(target.enabled, false);
  assert.equal(target.apps[0].generation, 'generation-dev');
});

test('the legacy primary project directory is only valid for identical public and runtime scopes', () => {
  const input = snapshot();
  delete input[0].projects[0].configurations;
  assert.throws(() => localStackInventory(...input), /missing configurations/);
  input[0].projects[0].enabledStacks = [];
  input[0].projects[0].totalStacks = 1;
  input[1][0].stacks.splice(1);
  input[2].apps.splice(1);
  input[2].appsTotal = input[2].appsOnline = 1;
  assert.equal(localStackInventory(...input).targets[0].path, '/primary');
});

for (const [reason, mutate, error] of [
  ['offline registry', p => { p.online = false; }, /registry is offline/],
  ['missing data', p => { delete p.projects; }, /missing registered projects/],
  ['missing project group', (p, groups) => { groups.pop(); }, /inventories disagree/],
  ['missing configured stack', (p, groups) => { groups[0].stacks.pop(); }, /incomplete stack registry/],
  ['missing enabled list', p => { delete p.projects[0].enabledStacks; }, /incomplete stack registry/],
  ['missing owner observation', (p, g, s) => { delete s.execution.connection; }, /owner is disconnected/],
  ['missing process list', (p, g, s) => { delete s.apps; }, /missing owner processes/],
  ['inconsistent process totals', (p, g, s) => { s.appsOnline = 0; }, /owner process totals/],
  ['application absent from owner', (p, g, s) => { s.apps.shift(); s.appsOnline--; s.appsTotal--; }, /process observation/],
  ['unregistered active process', (p, g, s) => { s.apps.push({ ...s.apps[0], name: 'standalone' }); s.appsOnline++; s.appsTotal++; }, /outside the local stack/],
  ['missing runtime scope', (p, [g]) => { delete g.stacks[0].runtimeScope; }, /runtime scope/],
  ['unmapped alias', p => { p.projects[0].configurations[1].stacks = {}; }, /unique configuration/],
  ['missing stack configuration', (p, [g]) => { delete g.stacks[0].config; }, /invalid stack configuration/],
  ['active recipient allocation', (p, [g]) => { g.stacks[0].config.managedOrigin = { project: 'fleet', stack: 'remote' }; }, /deployment controller/],
  ['missing app selection', (p, [g]) => { g.stacks[0].apps = []; }, /incomplete configured applications/],
  ['wrong runtime handle', (p, [g]) => { g.stacks[1].apps[0].handleKey = 'product/import/api'; }, /ambiguous application/],
  ['unknown stack', (p, [g]) => { g.stacks[0].status = 'unknown'; }, /changing lifecycle/],
  ['intermediate app state', (p, [g]) => { g.stacks[0].apps[0].status = 'starting'; }, /process observation/],
  ['changed application generation', (p, g, s) => { s.apps[0].generation = 'replacement'; }, /generation/],
  ['missing PID-less generation', (p, g, s) => { delete s.apps[1].generation; }, /generation/],
  ['changed PID', (p, g, s) => { s.apps[0].pid++; }, /process identity/],
  ['unknown release digest', (p, [g]) => { delete g.stacks[1].selectedRelease.manifestSha256; }, /invalid selected release/],
  ['malformed release', (p, [g]) => { g.stacks[1].selectedRelease = null; }, /invalid selected release/],
  ['duplicate application observation', (p, [g]) => { g.stacks[0].apps.push(g.stacks[0].apps[0]); }, /duplicate identity/],
  ['duplicate owner process', (p, g, s) => { s.apps.push(s.apps[1]); }, /duplicate identity/],
  ['ambiguous configuration', p => { p.projects[0].configurations.push(structuredClone(configuration)); }, /unique configuration/],
]) {
  test('stops on ' + reason, () => {
    const input = snapshot();
    mutate(...input);
    assert.throws(() => localStackInventory(...input), error);
  });
}
