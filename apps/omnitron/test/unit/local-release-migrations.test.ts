import 'reflect-metadata';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { create } from 'tar';
import { afterEach, expect, it, vi } from 'vitest';
import { ExecutionEngine } from '@xec-sh/core';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { inspectLocalReleaseInstallation } from '../../src/release/local-installation.js';
import { targetRuntime } from '../../src/release/target-runtime.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import { sha256File } from '../../src/release/portable-archive.js';
import { COMPILED_MIGRATION_ENTRY, localMigrationTargets, migrationDatabaseEnvironment } from '../../src/services/migration-target.js';
import { executeLocalMigration } from '../../src/services/migration-process.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';
import type { IEcosystemAppEntry } from '../../src/config/types.js';
import type { LoadedRelease } from '../../src/release/load.js';

class MigrationHeartbeat {
  ping() { return 'alive'; }
}
Public()(MigrationHeartbeat.prototype, 'ping', Object.getOwnPropertyDescriptor(MigrationHeartbeat.prototype, 'ping')!);
Service({ name: 'MigrationHeartbeat' })(MigrationHeartbeat);

const cleanup: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of cleanup.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture(body?: string, imported = false) {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'local-migration-'))); cleanup.push(tmp);
  const releaseRoot = path.join(tmp, 'release'), payload = path.join(tmp, 'payload'), dev = path.join(tmp, 'dev');
  await fs.mkdir(releaseRoot); await fs.mkdir(path.join(payload, 'dist/database'), { recursive: true });
  await fs.mkdir(path.join(dev, 'apps/main/src/database'), { recursive: true });
  await fs.writeFile(path.join(payload, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(payload, 'dist/main.js'), '');
  if (body !== undefined) await fs.writeFile(path.join(payload, COMPILED_MIGRATION_ENTRY), body);
  await fs.writeFile(path.join(dev, 'apps/main/src/database/migrate.ts'), "throw Error('primary source must not run');");
  const runtime = await targetRuntime();
  const closure = path.join(payload, '.omnitron-closure.json');
  await fs.writeFile(closure, JSON.stringify({ protocol: 1, runtime, nodeOptions: '', payloadSha256: await releaseTreeDigest(payload, true, false, ['.omnitron-closure.json']) }));
  const archive = path.join(releaseRoot, 'main.tar.gz');
  await create({ gzip: true, file: archive, cwd: payload, portable: true }, ['dist', 'package.json', '.omnitron-closure.json']);
  const artifact = { app: 'main', version: '1', sha256: await sha256File(archive), bytes: (await fs.stat(archive)).size,
    launch: { mode: 'script' as const, file: 'dist/main.js', closureSha256: await sha256File(closure) } };
  let manifest: ReleaseManifest = { id: 'release', project: { repo: '/fixture', commit: 'a'.repeat(40) }, omni: { repo: '/framework', commit: 'b'.repeat(40) },
    artifacts: [artifact], gates: [], builtWith: { omnitron: '1', packages: [], target: runtime }, builtAt: '', builtBy: '' };
  let reference: { release: string; manifestSha256: string; app: string } | undefined;
  if (imported) {
    const producer: ReleaseManifest = { ...manifest, id: 'producer', artifacts: [{ ...artifact, app: 'collector',
      packageSource: { directory: 'apps/collector', manifestBlob: 'c'.repeat(40), migrations: {} } }] };
    const raw = JSON.stringify(producer);
    reference = { release: producer.id, manifestSha256: createHash('sha256').update(raw).digest('hex'), app: 'collector' };
    manifest = { ...manifest, artifacts: [{ ...producer.artifacts[0]!, app: 'main', origin: reference }],
      imports: [{ sha256: reference.manifestSha256, manifestJson: raw }] };
  }
  const release: LoadedRelease = { id: 'release', root: releaseRoot, manifest,
    manifestSha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
    files: [{ ...artifact, path: archive, inputs: '' }], staticsDir: null };
  const configured: IEcosystemAppEntry[] = [{ name: 'main', cwd: dev, ...(reference ? { releaseFrom: reference } : { script: 'src/main.ts' }) }];
  const options = { ownerPid: process.pid, ownerPackage: tmp };
  const entries = await inspectLocalReleaseInstallation(release, 'dev', configured, { ...options, prepare: true });
  const verify = (apps: readonly string[]) => inspectLocalReleaseInstallation(release, 'dev', configured, {
    ...options, requiredFiles: Object.fromEntries(apps.map(app => [app, [COMPILED_MIGRATION_ENTRY]])),
  });
  return { tmp, release, entries, verify, dev, root: entries[0]!.releaseRoot! };
}

it('runs the compiled member inside its admitted closure, without source tsx or an inherited bootstrap preload', async () => {
  const f = await fixture(`import assert from 'node:assert/strict';
    assert.equal(process.cwd(), new URL('../..', import.meta.url).pathname.replace(/[/]$/, ''));
    assert.equal(process.env.NODE_PATH, ''); assert.equal(process.env.NODE_OPTIONS, '');
    assert.equal(process.env.MAIN__DATABASE__DATABASE, 'main'); console.log('sealed migrator');`);
  const [target] = await localMigrationTargets(['main'], f.entries, f.dev, f.verify);
  const db = migrationDatabaseEnvironment('main', 'postgres://u:p@127.0.0.1:5432/main', 'main');
  const result = await executeLocalMigration(target!, { ...db.env, NODE_OPTIONS: '--import /does/not/exist.js', NODE_PATH: '/outside' });
  expect(result.stdout.trim()).toBe('sealed migrator');
});

it('executes an imported migration with its original producer prefix and consumer database', async () => {
  const f = await fixture(`import assert from 'node:assert/strict';
    assert.equal(process.env.COLLECTOR__DATABASE__DATABASE, 'main');
    assert.equal(process.env.MAIN__DATABASE__DATABASE, undefined); console.log('producer preserved');`, true);
  const [target] = await localMigrationTargets(['main'], f.entries, f.dev, f.verify);
  expect(target!.environmentApp).toBe('collector');
  const database = migrationDatabaseEnvironment(target!.environmentApp, 'postgres://u:p@127.0.0.1/main', 'main');
  expect((await executeLocalMigration(target!, database.env)).stdout.trim()).toBe('producer preserved');
});

it('refuses a missing compiled member even when the developer checkout has a migrator', async () => {
  const f = await fixture();
  await expect(localMigrationTargets(['main'], f.entries, f.dev, f.verify)).rejects.toThrow('Requested release file is unavailable');
});

it('refuses changed payload, receipt, escaping symlink and unverified releaseRoot', async () => {
  const f = await fixture('');
  await expect(localMigrationTargets(['main'], f.entries, f.dev)).rejects.toThrow('canonical installation verification');
  await fs.writeFile(path.join(f.root, COMPILED_MIGRATION_ENTRY), 'changed');
  await expect(localMigrationTargets(['main'], f.entries, f.dev, f.verify)).rejects.toThrow(/origin changed|admitted payload/);
  await fs.rm(path.join(f.root, COMPILED_MIGRATION_ENTRY));
  await fs.symlink(path.join(f.dev, 'apps/main/src/database/migrate.ts'), path.join(f.root, COMPILED_MIGRATION_ENTRY));
  await expect(localMigrationTargets(['main'], f.entries, f.dev, f.verify)).rejects.toThrow();
});

it.each(['timeout', 'abort'] as const)('waits for process exit after %s and never retries a migration', async mode => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'migration-pid-'))); cleanup.push(tmp);
  const marker = path.join(tmp, 'pid');
  // A separately sealed fixture writes its PID outside its immutable payload, as a real migration writes its DB.
  const timed = await fixture(`import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000);`);
  const [actual] = await localMigrationTargets(['main'], timed.entries, timed.dev, timed.verify);
  expect(actual!.sealed).toBe(true);
  const abort = new AbortController();
  const running = executeLocalMigration(actual!, {}, { timeoutMs: mode === 'timeout' ? 800 : 5000, signal: abort.signal });
  const verdict = expect(running).rejects.toThrow('outcome may be unknown');
  for (let i = 0; i < 100 && !await fs.stat(marker).then(() => true, () => false); i++) await new Promise(resolve => setTimeout(resolve, 20));
  const pid = Number(await fs.readFile(marker, 'utf8'));
  if (mode === 'abort') abort.abort();
  await verdict;
  expect(() => process.kill(pid, 0)).toThrow();
});

it('validates exact PostgreSQL schemes, rejects unsupported options and keeps producer prefixes', () => {
  const db = migrationDatabaseEnvironment('collector', 'postgresql://u%40x:p%2Fq@[::1]:5555/collector', 'collector');
  expect(db).toMatchObject({ host: '::1', port: 5555, database: 'collector', env: { COLLECTOR__DATABASE__USER: 'u@x', COLLECTOR__DATABASE__PASSWORD: 'p/q' } });
  expect(() => migrationDatabaseEnvironment('collector', 'postgres://u:p@localhost/collector?sslmode=require')).toThrow('refuses DATABASE_URL options');
  expect(() => migrationDatabaseEnvironment('main', 'postgres-malicious://u:secret@localhost/main')).toThrow('requires its resolved PostgreSQL');
});

it('does not report success when cancellation races with a zero exit code', async () => {
  const controller = new AbortController();
  vi.spyOn(ExecutionEngine.prototype, 'execute').mockImplementation(async () => {
    controller.abort();
    return { exitCode: 0, stdout: 'applied', stderr: '' } as never;
  });
  await expect(executeLocalMigration({ app: 'main', environmentApp: 'main', sealed: true,
    script: '/not-executed.js', cwd: '/', nodeOptions: '' }, {}, { signal: controller.signal })).rejects.toThrow('outcome may be unknown');
});

it('continues serving actual Netron RPC while a sealed migration child is running', async () => {
  const { Netron } = await import('@omnitron-dev/titan/netron');
  const { HttpTransport } = await import('@omnitron-dev/titan/netron/transport/http');
  const logger = { info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {}, child() { return this; }, isLevelEnabled: () => false };
  const server = new Netron(logger as never, { id: crypto.randomUUID() });
  server.registerTransport('http', () => new HttpTransport());
  server.registerTransportServer('http', { name: 'migration-rpc', options: { host: '127.0.0.1', port: 0 } });
  await server.start(); await server.peer.exposeService(new MigrationHeartbeat());
  try {
    const f = await fixture("import fs from 'node:fs'; fs.writeFileSync(process.env.MIGRATION_STARTED, 'started'); await new Promise(resolve => setTimeout(resolve,2000));");
    const [target] = await localMigrationTargets(['main'], f.entries, f.dev, f.verify);
    const marker = path.join(f.tmp, 'started');
    let finished = false;
    const running = executeLocalMigration(target!, { MIGRATION_STARTED: marker }).finally(() => { finished = true; });
    try {
      for (let i = 0; i < 100 && !await fs.stat(marker).then(() => true, () => false); i++) await new Promise(resolve => setTimeout(resolve, 20));
      expect(await fs.readFile(marker, 'utf8')).toBe('started');
      const port = server.transportServers.get('http')!.port!;
      const response = await fetch(`http://127.0.0.1:${port}/netron/invoke`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), service: 'MigrationHeartbeat', method: 'ping', input: [] }),
      });
      const answer = await response.json();
      expect(answer, JSON.stringify(answer)).toMatchObject({ success: true, data: 'alive' });
      expect(finished).toBe(false);
    } finally { await running; }
  } finally { await server.stop(); }
});
