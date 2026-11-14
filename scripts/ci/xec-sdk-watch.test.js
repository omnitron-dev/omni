import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import nativeFs from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const sdk = new URL('../../apps/omnitron/bin/sdk.js', import.meta.url);

async function fixture() {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-watch-')));
  const source = path.join(root, 'sdk'), consumer = path.join(root, 'consumer');
  const pkg = path.join(source, 'packages/probe');
  const records = path.join(root, 'builds.ndjson'), barrier = path.join(root, 'build-barrier');
  for (const directory of [source, consumer]) {
    await fs.mkdir(path.join(directory, 'node_modules/.bin'), { recursive: true });
    await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({
      name: path.basename(directory), private: true, packageManager: 'pnpm@12.16.1',
      ...(directory === consumer && { dependencies: { '@omnitron-dev/probe': '1.0.0' } }),
    }));
    await fs.writeFile(path.join(directory, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    await fs.writeFile(path.join(directory, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\nimporters:\n  .: {}\n  packages/probe: {}\n");
    await fs.writeFile(path.join(directory, 'turbo.json'), JSON.stringify({ tasks: { build: { cache: false, outputs: ['dist/**'] } } }));
    await fs.symlink(path.join(path.dirname(require.resolve('turbo/package.json')), 'bin/turbo'), path.join(directory, 'node_modules/.bin/turbo'));
  }
  await fs.mkdir(path.join(pkg, 'src'), { recursive: true });
  await fs.mkdir(path.join(consumer, '.omnitron/dev-sdk'), { recursive: true });
  await fs.mkdir(path.join(consumer, 'node_modules/@omnitron-dev'), { recursive: true });
  await fs.symlink(pkg, path.join(consumer, 'node_modules/@omnitron-dev/probe'));
  await fs.writeFile(path.join(pkg, 'package.json'), JSON.stringify({
    name: '@omnitron-dev/probe', version: '1.0.0', type: 'module', scripts: { build: 'node build.js' },
  }));
  await fs.writeFile(path.join(pkg, 'build.js'), `import fs from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const snapshot = {};
for (const name of (await fs.readdir('src')).sort()) snapshot[name] = await fs.readFile('src/' + name, 'utf8');
await fs.appendFile(${JSON.stringify(records)}, JSON.stringify(snapshot) + '\\n');
while (await fs.stat(${JSON.stringify(barrier)}).then(() => true, () => false)) await delay(25);
await fs.mkdir('dist', {recursive:true});
await fs.writeFile('dist/index.js', 'export default ' + JSON.stringify(snapshot) + ';\\n');
`);
  await fs.writeFile(path.join(pkg, 'src/index.js'), 'initial');
  const readBuilds = async () => (await fs.readFile(records, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  })).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const output = async () => (await fs.readFile(path.join(pkg, 'dist/index.js'), 'utf8')).trim();
  return { root, source, consumer, pkg, records, barrier, readBuilds, output,
    profile: { schema: 1, root: consumer, source, links: { '@omnitron-dev/probe': pkg } } };
}

async function waitFor(check, message, budget = 12_000) {
  const until = Date.now() + budget;
  do { if (await check()) return; await delay(25); } while (Date.now() < until);
  assert.fail(message);
}

test('the ordinary SDK watcher converges when native notifications are lost, coalesces edits and closes on abort', { timeout: 60_000 }, async t => {
  // fs.watch can successfully subscribe without delivering later events. The
  // SDK must still consume real changes, not merely pass a mocked callback.
  const dropped = t.mock.method(nativeFs, 'watch', () => Object.assign(new EventEmitter(), { close() {} }));
  syncBuiltinESMExports();
  t.after(() => { dropped.mock.restore(); syncBuiltinESMExports(); });
  const { watchSdk } = await import(sdk.href);
  const f = await fixture();
  await import('node:sqlite');
  await delay(0);
  const controller = new AbortController(), messages = [], errors = [];
  t.mock.method(console, 'log', (...args) => messages.push(args.join(' ')));
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  let failure;
  const running = watchSdk(f.profile, undefined, controller.signal).catch(error => { failure = error; });
  const completed = () => messages.filter(message => /^Development SDK build /.test(message)).length;
  const assertHealthy = () => { assert.equal(failure, undefined); assert.deepEqual(errors, []); };
  t.after(async () => { controller.abort(); await running; await fs.rm(f.root, { recursive: true, force: true }); });
  await waitFor(() => completed() === 1 || failure || errors.length, 'initial SDK build did not finish');
  assertHealthy();

  nativeFs.writeFileSync(path.join(f.pkg, 'src/index.js'), 'changed');
  nativeFs.writeFileSync(path.join(f.pkg, 'src/new.css'), '.new { color: red; }');
  await waitFor(() => completed() === 2 || failure || errors.length, 'lost native events left the SDK stale');
  assertHealthy();
  assert.equal((await f.readBuilds()).length, 2, 'one edit burst must create one build');
  assert.match(await f.output(), /changed/);
  assert.match(await f.output(), /new\.css/);

  await fs.writeFile(path.join(f.pkg, 'replacement.tmp'), 'atomic replacement');
  nativeFs.renameSync(path.join(f.pkg, 'replacement.tmp'), path.join(f.pkg, 'src/index.js'));
  nativeFs.rmSync(path.join(f.pkg, 'src/new.css'));
  await waitFor(() => completed() === 3 || failure || errors.length, 'atomic replacement and deletion were not rebuilt');
  assertHealthy();
  assert.deepEqual((await f.readBuilds()).at(-1), { 'index.js': 'atomic replacement' });

  // Root config matters; generated output, dependencies, unrelated packages
  // and unrelated root files are not SDK source inputs.
  await fs.mkdir(path.join(f.pkg, 'node_modules/ignored'), { recursive: true });
  await fs.mkdir(path.join(f.source, 'packages/unselected/src'), { recursive: true });
  await fs.writeFile(path.join(f.pkg, 'node_modules/ignored/index.js'), 'ignored');
  await fs.writeFile(path.join(f.pkg, 'dist/ignored.js'), 'ignored');
  await fs.writeFile(path.join(f.source, 'packages/unselected/src/index.js'), 'ignored');
  await fs.writeFile(path.join(f.source, 'README.md'), 'ignored');
  await delay(1800);
  assert.equal((await f.readBuilds()).length, 3, 'generated and unselected paths must not trigger builds');
  await fs.writeFile(path.join(f.source, 'tsconfig.json'), '{"compilerOptions":{}}\n');
  await waitFor(() => completed() === 4 || failure || errors.length, 'SDK root configuration was not rebuilt');
  assertHealthy();
  await fs.writeFile(path.join(f.pkg, 'tsconfig.build.json'), '{"compilerOptions":{}}\n');
  await waitFor(() => completed() === 5 || failure || errors.length, 'package configuration was not rebuilt');
  assertHealthy();

  // Edits arriving while a real build is blocked must survive its completion.
  await fs.writeFile(f.barrier, 'hold only this fixture build');
  await fs.writeFile(path.join(f.pkg, 'src/index.js'), 'first generation');
  await waitFor(async () => (await f.readBuilds()).length === 6 || failure || errors.length, 'fixture build did not reach its barrier');
  assertHealthy();
  nativeFs.writeFileSync(path.join(f.pkg, 'src/index.js'), 'second generation');
  nativeFs.writeFileSync(path.join(f.pkg, 'src/last.json'), '{"complete":true}');
  await delay(1400);
  await fs.rm(f.barrier);
  await waitFor(() => completed() === 7 || failure || errors.length, 'a source edit was lost during the previous build');
  assertHealthy();
  assert.deepEqual((await f.readBuilds()).at(-1), { 'index.js': 'second generation', 'last.json': '{"complete":true}' });
  assert.match(await f.output(), /second generation/);

  controller.abort();
  await running;
  assertHealthy();
  const count = (await f.readBuilds()).length;
  await fs.writeFile(path.join(f.pkg, 'src/index.js'), 'after shutdown');
  await delay(1400);
  assert.equal((await f.readBuilds()).length, count, 'abort must close watchers and stop all scheduled builds');
});
