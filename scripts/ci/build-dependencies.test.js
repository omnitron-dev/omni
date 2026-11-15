import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertBuildDependencies } from '../../.xec/release-policy.mjs';

async function fixture(t, declared, installed, name = '@xec-sh/core') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-build-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const ops = path.join(root, 'node_modules/@xec-sh/ops');
  await fs.mkdir(ops, { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ devDependencies: { '@xec-sh/ops': '^0.13.0' } }));
  await fs.writeFile(path.join(ops, 'package.json'), JSON.stringify({
    name: '@xec-sh/ops', version: '0.13.0', exports: { './package.json': './package.json' },
  }));
  const app = path.join(root, 'apps/omnitron');
  const dependency = path.join(app, 'node_modules/@xec-sh/core');
  await fs.mkdir(dependency, { recursive: true });
  const ssh = path.join(app, 'node_modules/@xec-sh/ssh');
  await fs.mkdir(ssh, { recursive: true });
  await fs.writeFile(path.join(ssh, 'package.json'), JSON.stringify({
    name: '@xec-sh/ssh', version: '0.13.0', exports: { './package.json': './package.json' },
  }));
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({
    dependencies: { '@xec-sh/core': declared, '@xec-sh/ssh': '^0.13.0' },
  }));
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({
    name, version: installed, exports: { './package.json': './package.json' },
  }));
  return root;
}

test('rejects a declaration that permits the old execution contract even with a newer installed SDK', async t => {
  const root = await fixture(t, '>=0.12.0 <0.14.0', '0.13.0');
  await assert.rejects(assertBuildDependencies(root), /requires @xec-sh\/core \^0\.13\.0.*declared >=0\.12/);
});

test('rejects stale installed dependencies after changing only the manifest', async t => {
  const root = await fixture(t, '^0.13.0', '0.12.0');
  await assert.rejects(assertBuildDependencies(root), /resolves @xec-sh\/core@0\.12\.0/);
});

test('reports the compatible declared and resolved inputs without creating build state', async t => {
  const root = await fixture(t, '^0.13.0', '0.13.1');
  assert.deepEqual(await assertBuildDependencies(root), [{
    workspace: 'apps/omnitron', name: '@xec-sh/core', declared: '^0.13.0', installed: '0.13.1',
  }, {
    workspace: 'apps/omnitron', name: '@xec-sh/ssh', declared: '^0.13.0', installed: '0.13.0',
  }, { workspace: '.', name: '@xec-sh/ops', declared: '^0.13.0', installed: '0.13.0' }]);
  assert.deepEqual((await fs.readdir(root)).sort(), ['apps', 'node_modules', 'package.json']);
});

test('rejects a substituted package and an installed version outside the declaration', async t => {
  const foreign = await fixture(t, '^0.13.0', '0.13.0', '@foreign/core');
  await assert.rejects(assertBuildDependencies(foreign), /resolves @xec-sh\/core@0\.13\.0/);
  const mismatch = await fixture(t, '0.13.0', '0.13.1');
  await assert.rejects(assertBuildDependencies(mismatch), /declares 0\.13\.0/);
});

test('requires a direct declared SSH contract and refuses a stale installed client', async t => {
  const root = await fixture(t, '^0.13.0', '0.13.0');
  const manifest = path.join(root, 'apps/omnitron/package.json');
  await fs.writeFile(manifest, JSON.stringify({ dependencies: { '@xec-sh/core': '^0.13.0' } }));
  await assert.rejects(assertBuildDependencies(root), /requires @xec-sh\/ssh \^0\.13\.0.*missing/);
  await fs.writeFile(manifest, JSON.stringify({
    dependencies: { '@xec-sh/core': '^0.13.0', '@xec-sh/ssh': '^0.13.0' },
  }));
  await fs.writeFile(path.join(root, 'apps/omnitron/node_modules/@xec-sh/ssh/package.json'), JSON.stringify({
    name: '@xec-sh/ssh', version: '0.12.0', exports: { './package.json': './package.json' },
  }));
  await assert.rejects(assertBuildDependencies(root), /resolves @xec-sh\/ssh@0\.12\.0/);
});
