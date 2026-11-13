import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  verifyInstalledRuntime,
  assertArtifactIdentity,
  RuntimeOriginVerificationError,
} from '../../src/runtime/index.js';
import { assertInstalledRuntimeModule, importRuntimeModule } from '../../src/runtime/context.js';
import { BuildService } from '../../src/orchestrator/build-service.js';
import BootstrapProcess from '../../src/orchestrator/bootstrap-process.js';
import { linkFixtureDependencies } from '../helpers/installed-dependencies.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import type { InstalledReleaseReceipt } from '../../src/release/installed-origin.js';
let root: string, entry: URL, receipt: InstalledReleaseReceipt, args: string[];
let options: string | undefined, nodePath: string | undefined;
async function save() {
  await fs.writeFile(path.join(root, '.omnitron-release.json'), JSON.stringify(receipt), { mode: 0o600 });
}
beforeEach(async () => {
  args = process.execArgv;
  process.execArgv = [];
  options = process.env['NODE_OPTIONS'];
  nodePath = process.env['NODE_PATH'];
  delete process.env['NODE_OPTIONS'];
  delete process.env['NODE_PATH'];
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-origin-')));
  await fs.mkdir(path.join(root, 'dist'));
  await fs.writeFile(path.join(root, 'dist/bootstrap.js'), 'export default {};');
  await fs.writeFile(path.join(root, 'dist/other.js'), 'export default {};');
  entry = pathToFileURL(path.join(root, 'dist/bootstrap.js'));
  receipt = {
    version: 2,
    root,
    ownerPackage: '/verified/owner',
    nodeOptions: '',
    target: await targetRuntime(),
    treeSha256: await releaseTreeDigest(root),
    installedFrameworkCommit: 'a'.repeat(40),
    frameworkContentUnchanged: true,
    artifactPayloadUnchanged: true,
    origin: {
      releaseId: 'producer-1',
      manifestSha256: 'b'.repeat(64),
      artifactSha256: 'c'.repeat(64),
      artifactBytes: 12,
      app: 'alias',
      frameworkCommit: 'a'.repeat(40),
      runtimeOrigin: {
        projectCommit: 'd'.repeat(40),
        producerApp: 'original',
        consumer: { releaseId: 'consumer-1', manifestSha256: 'e'.repeat(64), app: 'alias' },
        entry: { relativeFile: 'dist/bootstrap.js', mode: 'bootstrap' },
      },
    },
  };
  await save();
});
afterEach(async () => {
  process.execArgv = args;
  for (const [key, value] of [
    ['NODE_OPTIONS', options],
    ['NODE_PATH', nodePath],
  ] as const)
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  await fs.rm(root, { recursive: true, force: true });
});
it('separates imported producer from consumer and returns deep immutable proof without owner attestation', async () => {
  const r = await verifyInstalledRuntime(entry);
  expect(r.state).toBe('verified');
  if (r.state !== 'verified') throw Error('proof');
  expect(r.producer.producerApp).toBe('original');
  expect(r.consumer.app).toBe('alias');
  expect(r.ownerAttestation).toBeNull();
  expect(r.basis).toBe('verified-installed-runtime');
  assertArtifactIdentity(r.producer);
  for (const o of [r, r.producer, r.consumer, r.entry]) expect(Object.isFrozen(o)).toBe(true);
});
it('preserves ordinary TS development when no admitted receipt exists', async () => {
  await fs.unlink(path.join(root, '.omnitron-release.json'));
  await fs.writeFile(path.join(root, 'bootstrap.ts'), 'export default {};');
  process.execArgv = ['--import', 'tsx'];
  expect((await verifyInstalledRuntime(pathToFileURL(path.join(root, 'bootstrap.ts')))).state).toBe('unavailable');
});

async function generatedWorker(source = 'export default 42') {
  await fs.unlink(path.join(root, '.omnitron-release.json'));
  const dir = path.join(root, '.omnitron-build');
  await fs.mkdir(dir);
  await fs.writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(dir, 'bootstrap.js'), 'export default {}');
  const worker = path.join(dir, 'collector.js');
  await fs.writeFile(worker, source);
  const bootstrap = pathToFileURL(path.join(dir, 'bootstrap.js'));
  return { worker, bootstrap, context: await verifyInstalledRuntime(bootstrap) };
}

it('records the generated worker file independently of installed identity and accepts a registered project symlink', async () => {
  const source = 'export default 42', { worker, context } = await generatedWorker(source);
  const alias = path.join(root, 'registered');
  await fs.symlink(root, alias, 'dir');
  const bootstrap = pathToFileURL(path.join(alias, '.omnitron-build/bootstrap.js'));
  const module = pathToFileURL(path.join(alias, '.omnitron-build/collector.js'));
  const result = await importRuntimeModule(context, bootstrap, module, 'collector');
  expect(result.moduleFile.default).toBe(42);
  expect(result.runtimeContext).toEqual({
    ...context, development: { basis: 'observed-development-module', relativeFile: '.omnitron-build/collector.js',
      sha256: createHash('sha256').update(source).digest('hex'), observedAt: expect.any(String) },
  });
  expect(result.runtimeContext).not.toHaveProperty('producer');
  expect((await importRuntimeModule(context, bootstrap, pathToFileURL(worker))).runtimeContext).toEqual(context);
});

it('preserves an unavailable legacy installation even when the caller supplies a generated process name', async () => {
  const { bootstrap, worker } = await generatedWorker();
  delete receipt.origin.runtimeOrigin;
  await save();
  const legacy = await verifyInstalledRuntime(bootstrap);
  expect(legacy).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('Legacy') });
  expect((await importRuntimeModule(legacy, bootstrap, pathToFileURL(worker), 'collector')).runtimeContext).toEqual(legacy);
});

it('rejects a different role and a linked worker instead of recording them as its generated output', async () => {
  const { bootstrap, worker, context } = await generatedWorker();
  await expect(importRuntimeModule(context, bootstrap, pathToFileURL(worker), 'server')).rejects.toThrow('BuildService entry');
  const external = path.join(root, 'other.js');
  await fs.rename(worker, external);
  await fs.symlink(external, worker);
  await expect(importRuntimeModule(context, bootstrap, pathToFileURL(worker), 'collector')).rejects.toThrow('escapes');
});

it('rejects a generated worker rewritten during import', async () => {
  const { bootstrap, worker, context } = await generatedWorker(
    'import {writeFileSync} from "node:fs"; writeFileSync(new URL(import.meta.url), "export default 7"); export default 42;'
  );
  await expect(importRuntimeModule(context, bootstrap, pathToFileURL(worker), 'collector')).rejects.toThrow('changed during import');
});

it('injects the observed working-tree build into the ordinary generated worker through Titan', async () => {
  await fs.unlink(path.join(root, '.omnitron-release.json'));
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'origin-probe', type: 'module' }));
  await linkFixtureDependencies(root, ['@omnitron-dev/titan']);
  await fs.mkdir(path.join(root, 'src'));
  const definition = { name: 'origin-probe', version: '1', processes: [{ name: 'collector', module: './collector.js' }] };
  const bootstrap = path.join(root, 'src/bootstrap.ts');
  await fs.writeFile(bootstrap, 'export default ' + JSON.stringify(definition));
  await fs.writeFile(path.join(root, 'src/collector.ts'),
    'import { Module } from "@omnitron-dev/titan"; class Collector {} Module({})(Collector); export default Collector;');
  const build = new BuildService(true), boot = new BootstrapProcess();
  try {
    const bundle = await build.buildApp('origin-probe', bootstrap, definition);
    const module = bundle.modulePaths.get('collector')!;
    await boot.init({ bootstrapPath: bundle.bootstrapPath, bundledModulePath: module, processName: 'collector' });
    const { RUNTIME_CONTEXT } = await import('../../src/runtime/context.js');
    const app = Reflect.get(boot, 'app')!;
    expect(app.container.resolve(RUNTIME_CONTEXT)).toMatchObject({
      state: 'unavailable', development: { basis: 'observed-development-module', relativeFile: '.omnitron-build/collector.js',
        sha256: createHash('sha256').update(await fs.readFile(module)).digest('hex') },
    });
  } finally {
    await boot.shutdown();
    await build.dispose();
  }
});
it('does not accept forged environment identity or upgrade a valid legacy record', async () => {
  delete receipt.origin.runtimeOrigin;
  await save();
  expect((await verifyInstalledRuntime(entry)).state).toBe('unavailable');
  await fs.unlink(path.join(root, '.omnitron-release.json'));
  const old = process.env['TITAN_WORKER_CONTEXT'];
  process.env['TITAN_WORKER_CONTEXT'] = JSON.stringify({ origin: { state: 'verified' } });
  try {
    expect((await verifyInstalledRuntime(entry)).state).toBe('unavailable');
  } finally {
    if (old === undefined) delete process.env['TITAN_WORKER_CONTEXT'];
    else process.env['TITAN_WORKER_CONTEXT'] = old;
  }
});
it('rejects wrong sibling entry, referrer directory, decorated URL and symlink entry', async () => {
  await expect(verifyInstalledRuntime(pathToFileURL(path.join(root, 'dist/other.js')))).rejects.toThrow(
    'admitted compiled entry'
  );
  await expect(verifyInstalledRuntime(pathToFileURL(path.join(root, 'dist')))).rejects.toBeInstanceOf(
    RuntimeOriginVerificationError
  );
  await expect(verifyInstalledRuntime(new URL(entry.href + '?forged=1'))).rejects.toThrow('file URL');
  await fs.symlink(path.join(root, 'dist/bootstrap.js'), path.join(root, 'alias.js'));
  await expect(verifyInstalledRuntime(pathToFileURL(path.join(root, 'alias.js')))).rejects.toThrow(
    'physical compiled file'
  );
});
it('throws on payload tamper rather than degrading to unknown', async () => {
  await fs.writeFile(path.join(root, 'dist/bootstrap.js'), 'export default { changed:true };');
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('payload changed');
});
it('rejects malformed and non-private proof', async () => {
  (receipt.origin.runtimeOrigin as unknown as { projectCommit: unknown }).projectCommit = ['d'.repeat(40)];
  await save();
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('receipt is invalid');
  await fs.chmod(path.join(root, '.omnitron-release.json'), 0o644);
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('private regular file');
});
it('rejects wrong Node, resource options, loader and module search extension', async () => {
  receipt.target!.executableSha256 = '0'.repeat(64);
  await save();
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('executable differs');
  receipt.target = await targetRuntime();
  await save();
  process.env['NODE_OPTIONS'] = '--max-old-space-size=4096';
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('binding changed');
  delete process.env['NODE_OPTIONS'];
  process.execArgv = ['--import', '/tmp/inject.mjs'];
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('command-line options');
  process.execArgv = [];
  process.env['NODE_PATH'] = '/tmp/extra';
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('NODE_PATH');
});
it('validates exact producer identity fields without JavaScript coercion', () => {
  expect(() => assertArtifactIdentity({ ...receipt.origin, projectCommit: 'd'.repeat(40) })).toThrow(
    'artifact identity'
  );
});
it('never downgrades malformed legacy target fields to unavailable', async () => {
  delete receipt.origin.runtimeOrigin;
  (receipt as unknown as { target: unknown }).target = { node: 'v24.0.0' };
  await save();
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('runtime target is invalid');
});
it('rejects nested forged receipts before loading code', async () => {
  await fs.writeFile(
    path.join(root, 'dist', '.omnitron-release.json'),
    JSON.stringify({ ...receipt, root: path.join(root, 'dist') }),
    { mode: 0o600 }
  );
  await expect(verifyInstalledRuntime(entry)).rejects.toThrow('nested');
});
it('handles deeply nested admitted entries', async () => {
  const relative = Array.from({ length: 20 }, (_, i) => 'd' + i).join('/') + '/entry.js';
  await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await fs.writeFile(path.join(root, relative), 'export default {};');
  receipt.origin.runtimeOrigin!.entry.relativeFile = relative;
  receipt.treeSha256 = await releaseTreeDigest(root);
  await save();
  expect((await verifyInstalledRuntime(pathToFileURL(path.join(root, relative)))).state).toBe('verified');
});
it('publishes one complete receipt for racing installers', async () => {
  const { writeInstalledReleaseReceipt, readInstalledReleaseReceipt } =
    await import('../../src/release/installed-origin.js');
  await fs.unlink(path.join(root, '.omnitron-release.json'));
  const result = await Promise.allSettled([
    writeInstalledReleaseReceipt(root, receipt),
    writeInstalledReleaseReceipt(root, receipt),
  ]);
  expect(result.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await readInstalledReleaseReceipt(root)).toEqual(receipt);
  expect((await verifyInstalledRuntime(entry)).state).toBe('verified');
});
it('diagnoses an application provider replacing the reserved bootstrap context', async () => {
  const { Application } = await import('@omnitron-dev/titan');
  const { Module } = await import('@omnitron-dev/titan/decorators');
  const { RUNTIME_CONTEXT } = await import('../../src/runtime/context.js');
  class InvalidModule {}
  Module({ providers: [{ provide: RUNTIME_CONTEXT, useValue: { state: 'verified', forged: true } }] })(InvalidModule);
  await expect(
    Application.create({
      modules: [InvalidModule],
      disableCoreModules: true,
      disableGracefulShutdown: true,
      providers: [[RUNTIME_CONTEXT, { useValue: await verifyInstalledRuntime(entry) }]],
    })
  ).rejects.toThrow();
});

it('does not reveal malformed receipt contents through parser errors', async () => {
  await fs.writeFile(path.join(root, '.omnitron-release.json'), '{"secret":"DO_NOT_EXPOSE", broken');
  try {
    await verifyInstalledRuntime(entry);
    throw Error('expected refusal');
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeOriginVerificationError);
    expect(String(error)).toContain('not valid JSON');
    expect(String(error)).not.toContain('DO_NOT_EXPOSE');
    expect(String((error as Error).cause)).not.toContain('DO_NOT_EXPOSE');
  }
});
it('rejects arrays decorated to imitate the wire identity record', () => {
  const decorated = Object.assign([], {
    releaseId: 'r1',
    producerApp: 'app',
    manifestSha256: 'a'.repeat(64),
    artifactSha256: 'b'.repeat(64),
    projectCommit: 'c'.repeat(40),
    frameworkCommit: 'd'.repeat(40),
  });
  expect(() => assertArtifactIdentity(decorated)).toThrow(RuntimeOriginVerificationError);
});

it('admits a compiled topology child in the closure and refuses an external bundle', async () => {
  const context = await verifyInstalledRuntime(entry);
  await expect(
    assertInstalledRuntimeModule(context, entry, pathToFileURL(path.join(root, 'dist/other.js')))
  ).resolves.toBeUndefined();
  await expect(assertInstalledRuntimeModule(context, entry, new URL(import.meta.url))).rejects.toThrow(
    'outside the installed compiled closure'
  );
  await expect(
    assertInstalledRuntimeModule({ state: 'unavailable', reason: 'development' }, entry, new URL(import.meta.url))
  ).resolves.toBeUndefined();
});
