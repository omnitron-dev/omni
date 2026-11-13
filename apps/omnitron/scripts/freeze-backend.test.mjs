import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { runtimeArtifactDigest, verifyRuntimeArtifact } from '../src/shared/runtime-artifact.ts';
import { assertStandaloneNodeConfiguration, assertSystemSharedObjects, copyStandaloneNode, verifyStandaloneNodeCopy } from './standalone-node.js';

const run = promisify(execFile);
const freezer = fileURLToPath(new URL('./freeze-backend.mjs', import.meta.url));

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-freeze-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const release = path.join(root, 'release'), source = path.join(release, 'packages/0');
  const dependency = path.join(release, 'packages/1');
  await fs.mkdir(path.join(source, 'dist/shared'), { recursive: true });
  await fs.mkdir(path.join(source, 'node_modules'), { recursive: true });
  await fs.mkdir(dependency, { recursive: true });
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'fixture-backend', version: '1.0.0', type: 'module', files: ['dist'], dependencies: { 'fixture-dep': '1.0.0' } }));
  // The production verifier is used by the subprocess too, not a permissive
  // fake that would hide accidental trust in a forged manifest.
  await fs.writeFile(path.join(source, 'dist/shared/runtime-artifact.js'),
    `export * from ${JSON.stringify(new URL('../src/shared/runtime-artifact.ts', import.meta.url).href)};`);
  await fs.writeFile(path.join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-dep', version: '1.0.0', files: ['*.js', '!test/**'] }));
  await fs.writeFile(path.join(dependency, 'index.js'), 'module.exports = 42;');
  await fs.symlink('../../1', path.join(source, 'node_modules/fixture-dep'));
  const manifest = { protocol: 1, sha256: await runtimeArtifactDigest(release), platform: process.platform,
    arch: process.arch, nodeVersion: process.version, packages: 2 };
  await fs.writeFile(path.join(release, 'RUNTIME.json'), JSON.stringify(manifest));
  return { root, release, source, dependency, output: path.join(root, 'output') };
}

test('repackages a verified sealed dependency graph without reinterpreting registry publication patterns', async t => {
  const f = await fixture(t);
  const result = JSON.parse((await run(process.execPath, [freezer, f.source, f.output])).stdout);
  assert.equal(result.packages, 2);
  await verifyRuntimeArtifact(f.output, result.sha256);
  assert.equal(await fs.readFile(path.join(f.output, 'packages/1/index.js'), 'utf8'), 'module.exports = 42;');
  assert.equal(await fs.realpath(path.join(f.output, 'packages/0/node_modules/fixture-dep')), path.join(f.output, 'packages/1'));
  // Exercise the delivered interpreter after relocation, outside both its own
  // directory and the producer's prefix, without any inherited loader inputs.
  const moved = path.join(f.root, 'relocated');
  await fs.rename(f.output, moved);
  const execution = await run(path.join(moved, 'node'), ['-e',
    'console.log(require(process.argv[1]))', path.join(moved, 'packages/0/node_modules/fixture-dep')], { cwd: os.tmpdir(), env: {} });
  assert.equal(execution.stdout.trim(), '42');
  await verifyRuntimeArtifact(moved, result.sha256);
});

test('refuses a changed sealed package before creating an output artifact', async t => {
  const f = await fixture(t);
  await fs.appendFile(path.join(f.dependency, 'index.js'), '\nmodule.exports = 0;');
  await assert.rejects(run(process.execPath, [freezer, f.source, f.output]), /Runtime files or dependencies changed/);
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
});

test('a forged release path does not authorize copying an unpacked tree', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.release, 'RUNTIME.json'), JSON.stringify({ protocol: 1, sha256: '0'.repeat(64) }));
  await assert.rejects(run(process.execPath, [freezer, f.source, f.output]), /Runtime manifest does not match/);
  await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
});

const standalone = { node_shared: false, node_shared_libuv: false, node_target_type: 'executable',
  v8_enable_i18n_support: 1, icu_gyp_path: 'tools/icu/icu-generic.gyp' };

test('standalone admission rejects shared Node and every enabled optional shared dependency', () => {
  assert.doesNotThrow(() => assertStandaloneNodeConfiguration(standalone, 'linux'));
  assert.doesNotThrow(() => assertStandaloneNodeConfiguration({ ...standalone, node_shared_gtest_libraries: [] }, 'darwin'));
  for (const changes of [{ node_shared: true }, { node_shared_openssl: true }, { node_shared_new_dependency: true },
    { node_shared_libuv: 'false' }, { node_shared_gtest_libraries: ['/external/libtest.a'] }, { node_target_type: 'shared_library' }]) {
    assert.throws(() => assertStandaloneNodeConfiguration({ ...standalone, ...changes }, 'linux'), /requires a standalone Node producer/);
  }
  assert.throws(() => assertStandaloneNodeConfiguration({}, 'linux'), /node_shared/);
  assert.throws(() => assertStandaloneNodeConfiguration(standalone, 'win32'), /unsupported producer platform/);
});

test('standalone admission accounts for ICU and external built-ins outside node_shared flags', () => {
  for (const changes of [{ icu_gyp_path: 'tools/icu/icu-system.gyp' }, { icu_gyp_path: '/custom/icu.gyp' },
    { node_builtin_modules_path: '/external/builtins' }, { icu_default_data: '/external/icu' }]) {
    assert.throws(() => assertStandaloneNodeConfiguration({ ...standalone, ...changes }, 'darwin'), /requires a standalone Node producer/);
  }
  assert.doesNotThrow(() => assertStandaloneNodeConfiguration({ ...standalone, v8_enable_i18n_support: 0, icu_gyp_path: undefined }, 'linux'));
});

test('startup object admission rejects loader-relative and external dependencies even when build flags are disabled', () => {
  const executable = '/isolated/runtime/node';
  assert.doesNotThrow(() => assertSystemSharedObjects([executable, '/usr/lib/libSystem.B.dylib',
    '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation'], executable, 'darwin'));
  assert.doesNotThrow(() => assertSystemSharedObjects(['linux-vdso.so.1', '/lib/aarch64-linux-gnu/libc.so.6',
    '/usr/lib64/libstdc++.so.6'], executable, 'linux'));
  for (const dependency of ['@rpath/libnode.dylib', '/opt/homebrew/lib/libnode.dylib', '/usr/local/lib/libnode.dylib',
    '/usr/lib/../../opt/third-party.dylib', '/usr/library/libnode.dylib']) {
    assert.throws(() => assertSystemSharedObjects([executable, dependency], executable, 'darwin'), /non-system native object/);
  }
  assert.throws(() => assertSystemSharedObjects([], executable, 'linux'), /did not report/);
});

test('copied Node starts with a clean environment and rejects changed bytes or identity', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-node-copy-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'node');
  const names = ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'OMNITRON_PROBE_ENV_SENTINEL'];
  const saved = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    for (const name of names) process.env[name] = '/deliberately-unavailable-loader-input';
    await copyStandaloneNode(executable);
  } finally {
    for (const name of names) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
  const expected = { sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex'),
    version: process.version, platform: process.platform, arch: process.arch };
  await assert.rejects(verifyStandaloneNodeCopy(executable, { ...expected, version: 'v0.0.0' }), /startup identity/);
  await fs.chmod(executable, 0o700);
  await fs.appendFile(executable, 'changed');
  await assert.rejects(verifyStandaloneNodeCopy(executable, expected), /copied Node bytes differ/);
});

test('a startup timeout is distinct from a child exit and an invalid report', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'omni-node-startup-errors-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const executable = path.join(root, 'node');
  async function exercise(script, message, options) {
    const content = `#!/bin/sh\n${script}\n`;
    await fs.writeFile(executable, content, { mode: 0o700 });
    const expected = { sha256: createHash('sha256').update(content).digest('hex'),
      version: process.version, platform: process.platform, arch: process.arch };
    await assert.rejects(verifyStandaloneNodeCopy(executable, expected, options), message);
  }
  await exercise('exec /bin/sleep 10', /startup timed out after 50 ms/, { timeoutMs: 50 });
  await exercise('echo missing-library >&2\nexit 23', /startup failed \(23\).*\nmissing-library/);
  await exercise('echo malformed', /invalid diagnostic report/);
});
