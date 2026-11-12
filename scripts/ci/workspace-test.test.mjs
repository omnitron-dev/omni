import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, copyFile, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

async function collectionFixture(t, files, scripts = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'omni-test-collection-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const pkg = join(directory, 'packages/ui');
  await mkdir(pkg, { recursive: true });
  await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir');
  const manifest = next => writeFile(join(pkg, 'package.json'), JSON.stringify({ name: 'collection-fixture', type: 'module', scripts: next }));
  await manifest(scripts);
  for (const [name, source] of Object.entries(files)) {
    const file = join(pkg, name);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, source);
  }
  for (const args of [['init', '-q'], ['add', 'packages']]) {
    const result = spawnSync('git', args, { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  return {
    pkg, manifest,
    scan() {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../tests-nothing-runs.mjs', import.meta.url)), '--root', directory, '--json'], {
        encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
      });
      assert.ok([0, 1].includes(result.status), result.stderr || result.error?.message);
      return { status: result.status, ...JSON.parse(result.stdout) };
    },
  };
}

const collectedTest = "import { test } from '@playwright/test';\n" +
  "test.beforeAll(() => { throw new Error('Collection must not start hooks or browsers'); });\n" +
  "test('declared test', async ({ page }) => { throw new Error('Collection must not run test bodies'); });\n";

test('collection follows a direct Playwright script filter and refuses shell programs', async t => {
  const fixture = await collectionFixture(t, {
    'tests/browser/collected.spec.js': collectedTest,
    'tests/outside/orphan.spec.js': collectedTest,
  }, { 'test:browser': 'playwright test tests/browser --workers=1' });
  const filtered = fixture.scan();
  assert.equal(filtered.status, 1);
  assert.deepEqual(filtered.orphans.map(value => value.file), ['packages/ui/tests/outside/orphan.spec.js']);
  assert.deepEqual(filtered.collectionFailures, []);
  await fixture.manifest({ 'test:browser': 'playwright test tests --workers=1' });
  assert.equal(fixture.scan().status, 0);
  for (const command of ['playwright test tests && echo unsupported', 'CI=1 playwright test tests', 'playwright test tests/*.spec.js']) {
    await fixture.manifest({ 'test:browser': command });
    const refused = fixture.scan();
    assert.equal(refused.status, 1);
    assert.match(refused.collectionFailures[0].error, /shell syntax is unsupported/);
  }
});

test('Playwright collection preserves project arguments and deduplicates shared files', async t => {
  const fixture = await collectionFixture(t, {
    'browser.runner.js': "export default { projects: [" +
      "{ name: 'selected', testDir: './tests/selected' }," +
      "{ name: 'duplicate', testDir: './tests/selected' }," +
      "{ name: 'other', testDir: './tests/other' }] };\n",
    'tests/selected/a.spec.js': collectedTest,
    'tests/other/b.spec.js': collectedTest,
  }, { 'test:browser': 'playwright test --config browser.runner.js --project=selected --project=duplicate' });
  const filtered = fixture.scan();
  assert.equal(filtered.status, 1);
  assert.deepEqual(filtered.orphans.map(value => value.file), ['packages/ui/tests/other/b.spec.js']);
  assert.deepEqual(filtered.collectionFailures, []);
  await fixture.manifest({ 'test:browser': 'playwright test --config browser.runner.js --project=selected --project=duplicate --project=other' });
  assert.equal(fixture.scan().status, 0);
});

test('Playwright resolves computed config paths and collection errors remain failures', async t => {
  const fixture = await collectionFixture(t, {
    'playwright.config.js': "const directory = './tests/' + 'browser'; export default { testDir: directory, testMatch: [/\\.spec\\.js$/] };\n",
    'tests/browser/good.spec.js': collectedTest,
  });
  assert.equal(fixture.scan().status, 0);
  await fixture.manifest({ 'test:missing': 'playwright test never-collected.spec.js' });
  const missing = fixture.scan();
  assert.equal(missing.status, 1);
  assert.equal(missing.collectionFailures.length, 1, 'a passing config must not hide a refused script collection');
  assert.match(missing.collectionFailures[0].error, /No tests found/);
  assert.deepEqual(missing.orphans, []);
  await fixture.manifest({});
  await writeFile(join(fixture.pkg, 'tests/browser/good.spec.js'), "throw new Error('Declaration refused intentionally');\n");
  const refused = fixture.scan();
  assert.equal(refused.status, 1);
  assert.equal(refused.collectionFailures.length, 1);
  assert.match(refused.collectionFailures[0].error, /Declaration refused intentionally/);
  assert.deepEqual(refused.orphans, []);
});

test('collection reports structured stdout failures and stderr within a bounded diagnostic', async t => {
  const fixture = await collectionFixture(t, {
    'tests/browser/broken.spec.js': "console.error('declaration stderr context'); throw Error('declaration reason: ' + 'x'.repeat(20000));\n",
  }, { 'test:browser': 'playwright test tests/browser' });
  const result = fixture.scan();
  assert.equal(result.status, 1);
  const diagnostic = result.collectionFailures[0].error;
  assert.match(diagnostic, /status=1/);
  assert.match(diagnostic, /declaration reason:/);
  assert.match(diagnostic, /declaration stderr context/);
  assert.match(diagnostic, /\[truncated\]/);
  assert.ok(diagnostic.length <= 6000);
});

test('collection imports runtime dependencies only when its ordinary fixture executes', async t => {
  const fixture = await collectionFixture(t, {
    'tests/browser/lazy.spec.js': "import { test } from '@playwright/test';\n" +
      "test.beforeAll(async () => { await import('./not-built.js'); });\n" +
      "test('needs a built runtime', async () => {});\n",
  }, { 'test:browser': 'playwright test tests/browser' });
  const listed = fixture.scan();
  assert.equal(listed.status, 0);
  assert.deepEqual(listed.collectionFailures, []);
  const cli = createRequire(join(fixture.pkg, 'package.json')).resolve('@playwright/test/cli');
  const executed = spawnSync(process.execPath, [cli, 'test', 'tests/browser', '--reporter=json'], {
    cwd: fixture.pkg, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(executed.status, 1, 'A missing runtime must still fail execution');
  assert.match(executed.stdout, /not-built\.js/);
});

test('a failing Vitest config is not hidden by another successful runner', async t => {
  const fixture = await collectionFixture(t, {
    'vitest.config.js': "throw Error('vitest declaration refused');\n",
    'tests/browser/a.spec.js': collectedTest,
  }, { 'test:browser': 'playwright test tests/browser' });
  const result = fixture.scan();
  assert.equal(result.status, 1);
  assert.equal(result.collectionFailures.length, 1);
  assert.deepEqual(result.collectionFailures[0].configs, ['vitest.config.js']);
  assert.match(result.collectionFailures[0].error, /vitest declaration refused/);
});

test('strict Turbo mode carries the isolated test endpoints and home into the test cache key', () => {
  const turbo = createRequire(import.meta.url).resolve('turbo/bin/turbo');
  const result = spawnSync(process.execPath, [turbo, 'test', '--filter=@omnitron-dev/omnitron', '--only', '--dry=json', '--env-mode=strict'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, TEST_POSTGRES_PORT: '25432', TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:25432/test',
      OMNITRON_HOME: '/private-test-home', DOCKER_HOST: 'unix:///private-test-docker.sock' },
  });
  assert.equal(result.status, 0, result.stderr);
  const task = JSON.parse(result.stdout).tasks.find(value => value.taskId === '@omnitron-dev/omnitron#test');
  assert.equal(task.envMode, 'strict');
  for (const name of ['TEST_POSTGRES_PORT', 'TEST_DATABASE_URL', 'OMNITRON_HOME']) {
    assert.ok(task.environmentVariables.configured.some(value => value.startsWith(name + '=')), name + ' must be hashed and forwarded');
  }
  assert.ok(task.environmentVariables.passthrough.some(value => value.startsWith('DOCKER_HOST=')));
});

for (const [up, suite, down] of [[0, 0, 0], [2, 0, 0], [0, 7, 0], [0, 0, 9], [0, 7, 9]]) {
  test(`compose up=${up}, tests=${suite}, compose down=${down}`, { skip: process.platform === 'win32' }, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'omni-test-ci-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await copyFile(new URL('./workspace-test.mjs', import.meta.url), join(directory, 'test-ci.mjs'));
    const trace = join(directory, 'trace');
    const source = "const fs = require('node:fs'); fs.appendFileSync(process.env.TRACE, JSON.stringify(process.argv.slice(2)) + '\\n');";
    await writeFile(join(directory, 'docker'), '#!/usr/bin/env node\n' + source +
      `process.exit(process.argv.includes('up') ? ${up} : ${down});`, { mode: 0o755 });
    const bin = join(directory, 'node_modules/turbo/bin');
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, 'turbo'), source + `process.exit(${suite});`);
    const result = spawnSync(process.execPath, [join(directory, 'test-ci.mjs')], {
      env: { ...process.env, TRACE: trace, PATH: directory + delimiter + process.env.PATH },
      encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(result.status, up || suite || down, result.stderr);
    const calls = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.match(calls[0][2], /^omni-ci-[0-9a-f-]{36}$/);
    assert.deepEqual(calls.at(-1).slice(0, 5), calls[0].slice(0, 5));
    assert.deepEqual(calls.at(-1).slice(5), ['down', '-v']);
    assert.deepEqual(calls.slice(1, -1), up ? [] : [['test', '--continue=dependencies-successful']]);
  });
}
