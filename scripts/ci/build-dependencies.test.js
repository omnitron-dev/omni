import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertBuildDependencies } from '../../.xec/release-policy.mjs';

async function fixture(t, declared, installed, name = '@xec-sh/core') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-build-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'apps/omnitron');
  const dependency = path.join(app, 'node_modules/@xec-sh/core');
  await fs.mkdir(dependency, { recursive: true });
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({ dependencies: { '@xec-sh/core': declared } }));
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
  }]);
  assert.deepEqual(await fs.readdir(root), ['apps']);
});

test('rejects a substituted package and an installed version outside the declaration', async t => {
  const foreign = await fixture(t, '^0.13.0', '0.13.0', '@foreign/core');
  await assert.rejects(assertBuildDependencies(foreign), /resolves @xec-sh\/core@0\.13\.0/);
  const mismatch = await fixture(t, '0.13.0', '0.13.1');
  await assert.rejects(assertBuildDependencies(mismatch), /declares 0\.13\.0/);
});
