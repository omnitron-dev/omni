import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertBuildDependencies } from '../../.xec/release-policy.mjs';

async function fixture(t, declared, installed, name = '@xec-sh/core') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-build-contract-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({
    devDependencies: { '@xec-sh/cli': '0.13.2', '@xec-sh/ops': '0.13.2' },
  }));
  for (const dependency of ['cli', 'ops']) {
    const directory = path.join(root, 'node_modules/@xec-sh', dependency);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({
      name: '@xec-sh/' + dependency, version: '0.13.2', exports: { './package.json': './package.json' },
    }));
  }
  const app = path.join(root, 'apps/omnitron');
  const dependency = path.join(app, 'node_modules/@xec-sh/core');
  await fs.mkdir(dependency, { recursive: true });
  const ssh = path.join(app, 'node_modules/@xec-sh/ssh');
  await fs.mkdir(ssh, { recursive: true });
  await fs.writeFile(path.join(ssh, 'package.json'), JSON.stringify({
    name: '@xec-sh/ssh', version: '0.13.2', exports: { './package.json': './package.json' },
  }));
  await fs.writeFile(path.join(app, 'package.json'), JSON.stringify({
    dependencies: { '@xec-sh/core': declared, '@xec-sh/ssh': '^0.13.2' },
  }));
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({
    name, version: installed, exports: { './package.json': './package.json' },
  }));
  return root;
}

test('rejects a declaration that permits the old execution contract even with a newer installed SDK', async t => {
  const root = await fixture(t, '^0.13.0', '0.13.2');
  await assert.rejects(assertBuildDependencies(root), /requires @xec-sh\/core \^0\.13\.2.*declared \^0\.13\.0/);
});

test('rejects stale installed dependencies after changing only the manifest', async t => {
  const root = await fixture(t, '^0.13.2', '0.13.1');
  await assert.rejects(assertBuildDependencies(root), /resolves @xec-sh\/core@0\.13\.1/);
});

test('reports the compatible declared and resolved inputs without creating build state', async t => {
  const root = await fixture(t, '^0.13.2', '0.13.3');
  assert.deepEqual(await assertBuildDependencies(root), [{
    workspace: 'apps/omnitron', name: '@xec-sh/core', declared: '^0.13.2', installed: '0.13.3',
  }, {
    workspace: 'apps/omnitron', name: '@xec-sh/ssh', declared: '^0.13.2', installed: '0.13.2',
  }, { workspace: '.', name: '@xec-sh/cli', declared: '0.13.2', installed: '0.13.2' },
  { workspace: '.', name: '@xec-sh/ops', declared: '0.13.2', installed: '0.13.2' }]);
  assert.deepEqual((await fs.readdir(root)).sort(), ['apps', 'node_modules', 'package.json']);
});

test('rejects a substituted package and an installed version outside the declaration', async t => {
  const foreign = await fixture(t, '^0.13.2', '0.13.2', '@foreign/core');
  await assert.rejects(assertBuildDependencies(foreign), /resolves @xec-sh\/core@0\.13\.2/);
  const mismatch = await fixture(t, '0.13.2', '0.13.3');
  await assert.rejects(assertBuildDependencies(mismatch), /declares 0\.13\.2/);
});

test('requires a direct declared SSH contract and refuses a stale installed client', async t => {
  const root = await fixture(t, '^0.13.2', '0.13.2');
  const manifest = path.join(root, 'apps/omnitron/package.json');
  await fs.writeFile(manifest, JSON.stringify({ dependencies: { '@xec-sh/core': '^0.13.2' } }));
  await assert.rejects(assertBuildDependencies(root), /requires @xec-sh\/ssh \^0\.13\.2.*missing/);
  await fs.writeFile(manifest, JSON.stringify({
    dependencies: { '@xec-sh/core': '^0.13.2', '@xec-sh/ssh': '^0.13.2' },
  }));
  await fs.writeFile(path.join(root, 'apps/omnitron/node_modules/@xec-sh/ssh/package.json'), JSON.stringify({
    name: '@xec-sh/ssh', version: '0.12.0', exports: { './package.json': './package.json' },
  }));
  await assert.rejects(assertBuildDependencies(root), /resolves @xec-sh\/ssh@0\.12\.0/);
});

test('refuses an older repository CLI even when runtime libraries are current', async t => {
  const root = await fixture(t, '^0.13.2', '0.13.2');
  await fs.writeFile(path.join(root, 'node_modules/@xec-sh/cli/package.json'), JSON.stringify({
    name: '@xec-sh/cli', version: '0.13.1', exports: { './package.json': './package.json' },
  }));
  await assert.rejects(assertBuildDependencies(root), /resolves @xec-sh\/cli@0\.13\.1/);
});
