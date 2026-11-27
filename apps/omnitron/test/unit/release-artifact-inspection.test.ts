import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { create } from 'tar';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { DaemonStateStore } from '../../src/daemon/daemon-state-store.service.js';
import { ProjectService } from '../../src/services/project.service.js';
import { ProjectRpcService } from '../../src/services/project.rpc-service.js';
import { rehearsalCopyPlan } from '../../src/project/first-write-inspection.js';
import { checkMigrationRehearsal } from '../../src/project/rehearse-migrations.js';
import type { FirstWriteInspection, MigrationRehearsalPlan, MigrationRehearsalResult } from '../../src/shared/dto/first-write.js';
import { loadRelease } from '../../src/release/load.js';
import { inspectReleaseArtifact, writePortableArchive } from '../../src/release/archive.js';
import { CLOSURE_FILE } from '../../src/release/application-closure.js';
import { releaseTreeDigest } from '../../src/release/runtime-provenance.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';
import type { TargetRuntime } from '../../src/release/target-runtime.js';

const roots: string[] = [];
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const target: TargetRuntime = { platform: 'linux', arch: 'x64', node: 'v24.13.0', abi: '137',
  executableSha256: 'c'.repeat(64), libc: '2.39' };
const missing = (file: string) => expect(fs.lstat(file)).rejects.toMatchObject({ code: 'ENOENT' });

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});

async function fixture(bootstrap = false) {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-inspection-test-')));
  roots.push(directory);
  const source = path.join(directory, 'source'), store = path.join(directory, 'releases');
  const published = path.join(store, 'fixture'), marker = path.join(directory, 'CODE_EXECUTED');
  await fs.mkdir(source, { mode: 0o700 });
  await fs.mkdir(path.join(published, 'artifacts'), { recursive: true });
  const danger = `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'executed');throw Error('must never evaluate');`;
  const write = async (name: string, bytes: string | Buffer) => {
    await fs.mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await fs.writeFile(path.join(source, name), bytes);
  };
  await write('dist/main.js', danger);
  await write('dist/migrations.js', danger + '\nexport const migrations = [];');
  await write('dist/native/service', Buffer.from([0, 127, 69, 76, 70, 255]));
  await write('dist/native/asset.json', '{"revision":"fixture"}');
  await write('static/index.html', '<!doctype html><title>fixture</title>');
  if (bootstrap) {
    await write('node_modules/@omnitron-dev/omnitron/package.json', JSON.stringify({ name: '@omnitron-dev/omnitron', main: 'index.js' }));
    await write('node_modules/@omnitron-dev/omnitron/index.js', danger);
    await write('node_modules/@omnitron-dev/omnitron/orchestrator/bootstrap-process.js', danger);
    await write('node_modules/@omnitron-dev/titan/package.json', JSON.stringify({ name: '@omnitron-dev/titan', main: 'index.js' }));
    await write('node_modules/@omnitron-dev/titan/index.js', danger);
  }
  const closure = { protocol: 1, runtime: target, nodeOptions: '--max-old-space-size=512',
    payloadSha256: await releaseTreeDigest(source, true, false, [CLOSURE_FILE]) };
  await write(CLOSURE_FILE, JSON.stringify(closure));
  const archive = path.join(published, 'artifacts/worker-1.0.0.tar.gz');
  let manifest: ReleaseManifest = { id: 'fixture', project: { repo: 'fixture-project', commit: 'a'.repeat(40) },
    omni: { repo: 'fixture-framework', commit: 'b'.repeat(40) }, builtAt: '2026-11-05T00:00:00Z', builtBy: 'test',
    gates: [{ name: 'fixture', status: 'passed' }], builtWith: { omnitron: '0.3.1', packages: [], target },
    artifacts: [{ app: 'worker', version: '1.0.0', bytes: 1, sha256: '0'.repeat(64),
      launch: { mode: bootstrap ? 'bootstrap' : 'script', file: 'dist/main.js', closureSha256: hash(JSON.stringify(closure)) },
      packageSource: { directory: '.', manifestBlob: 'd'.repeat(40), migrations: {} } }] };
  const publish = async (value: ReleaseManifest) => {
    manifest = value;
    await fs.writeFile(path.join(published, 'manifest.json'), JSON.stringify(value));
  };
  const pack = async () => {
    await writePortableArchive(source, archive);
    const bytes = await fs.readFile(archive);
    await publish({ ...manifest, artifacts: [{ ...manifest.artifacts[0]!, bytes: bytes.length, sha256: hash(bytes) }] });
  };
  const reseal = async (changes: Record<string, unknown> = {}) => {
    const raw = JSON.stringify({ ...closure, payloadSha256: await releaseTreeDigest(source, true, false, [CLOSURE_FILE]), ...changes });
    await write(CLOSURE_FILE, raw);
    await publish({ ...manifest, artifacts: [{ ...manifest.artifacts[0]!,
      launch: { ...manifest.artifacts[0]!.launch!, closureSha256: hash(raw) } }] });
    await pack();
  };
  await pack();
  return { directory, source, store, archive, marker, write, publish, pack, reseal, get manifest() { return manifest; },
    inspect: (files?: Parameters<typeof inspectReleaseArtifact>[2]) => inspectReleaseArtifact('fixture', 'worker', { releasesRoot: store, ...files }) };
}

/** Capture actual scratch roots; require cleanup even on a refusal. No filesystem check is mocked. */
function captureScratch() {
  const created: string[] = [], original = fs.mkdtemp.bind(fs);
  vi.spyOn(fs, 'mkdtemp').mockImplementation((async (...args: Parameters<typeof fs.mkdtemp>) => {
    const result = await original(...args);
    if (String(args[0]).includes('omnitron-artifact-inspection-')) created.push(String(result));
    return result;
  }) as typeof fs.mkdtemp);
  return async () => {
    expect(created).toHaveLength(1);
    for (const directory of created) await missing(directory);
  };
}

describe('public read-only release artifact inspection', () => {
  it('consumes one confirmed private pair via the project RPC, with the exact archive and durable, reobserved outcome', async () => {
    const f = await fixture(), operationId = '6fcf0038-e3d1-43f2-a441-723ebb4b563d', verifyRunId = '0d5a6f4d-45e7-4abe-9404-e3b5b0867427';
    const scope = { project:'fixture', stack:'cold' }, input = { ...scope, release:'fixture', operationId, app:'worker' };
    const source = 'src/database/migrate.ts', entry = 'dist/database/migrate.js', payload = 'throw Error("must not execute on controller")';
    const baseline = 'src/database/migrations/001_base.ts', addition = 'src/database/migrations/002_capture.ts', final = 'src/database/migrations/003_close.ts';
    const index = 'src/database/migrations/index.ts', oldSources = {[baseline]:hash('old source'),[index]:hash('shared registry helper')};
    const names = ['001_base','002_capture','003_close'], artifact = f.manifest.artifacts[0]!, packageSource = artifact.packageSource!;
    await f.write(entry, payload);
    await f.publish({ ...f.manifest, artifacts:[{ ...artifact, packageSource: { ...packageSource,
      migrations:{ ...oldSources, [addition]:hash('new source'), [final]:hash('last source') }, migrationPrograms:[{
        mode:'script', source, sourceBlob:'c'.repeat(40), sourceSha256:hash('TS entry'), release:entry, releaseSha256:hash(payload) }] } }] });
    await f.reseal();
    const candidate = await loadRelease('fixture', f.store);
    const incumbent = { ...candidate, id:'previous', manifest:{ ...candidate.manifest,id:'previous',artifacts:[
      { ...artifact,packageSource:{ ...packageSource,migrations:oldSources } }] } };
    const admitted = { protocol:1 as const, ...scope, release:'fixture',manifestSha256:candidate.manifestSha256,
      declarationsSha256:hash('declarations'),commit:'a'.repeat(40),nodeId:'source',sshFingerprint:'source-pin',digest:hash('prepared') };
    const owner = { ...scope, nodeId:'source',definition:hash('definition'),revision:7,phase:'stopped' as const,apps:[],containers:[],
      stop:{id:'exact-native-stop',nodeOperationId:'stop-operation',observedAt:'2026-11-24T00:00:00Z'} };
    const node = { nodeId:'source',host:'192.0.2.1',sshPort:22,daemonPort:1900,registeredAt:'2026-10-01T00:00:00Z',fingerprint:'source-pin' };
    const volumes = ['postgres-data','minio-data'].map((tag,i) => ({tag,volume:tag,source:{device:'2',inode:String(i+10)},
      receiver:{device:'3',inode:String(i+12)},files:1,bytes:50,sha256:hash(tag),metadataSha256:hash('m'+tag),
      sourceGeneration:hash('s'+tag),receiverGeneration:hash('r'+tag)}));
    const cluster = {systemIdentifier:'1234',controlSha256:hash('control')};
    const inspection: FirstWriteInspection = { ...scope, protocol:1,writeAdmission:'withheld',ok:false,missing:[],owner,
      selectionDigest:hash('selection'),selectedPrepared:hash('original'),incumbent:{...admitted,release:'previous',digest:hash('old')},candidate:admitted,
      migrationHistory:{kind:'added-migrations',total:2,entries:[addition,final]}, physical:{state:'verified-closed-copy',evidence:{...scope,protocol:1,
        kind:'physical-service-data',verifyRunId,seed:'frozen-seed',sourceStop:owner.stop.id,source:node,receiver:{...node,nodeId:'receiver',host:'192.0.2.2'},
        reviewDigest:hash('physical'),definitionRevision:hash('graph'),runCompletedAt:owner.stop.observedAt,observedFrom:owner.stop.observedAt,
        verifiedAt:owner.stop.observedAt,proofDigest:hash('closed copy'),volumes,postgres:{postgres:cluster,nominatim:cluster},minio:{formatSha256:hash('format')} }} };
    const copy = rehearsalCopyPlan(inspection, operationId), receipt = {operationId,review:copy.digest,copies:volumes.map((v,i) =>
      ({tag:v.tag,device:'5',inode:String(i+20),generation:hash(v.tag)}))};
    const store = new DaemonStateStore(createNullLogger(), path.join(f.directory,'state.db'));
    try {
      const service: ProjectService = Object.assign(Object.create(ProjectService.prototype), { daemonStateStore:store, registry:{resolveStack:()=>scope},
        inspectFirstWrite:async () => inspection, releaseDeploymentSources:async () => ({
          previous:{receipt:inspection.incumbent,admitted:incumbent}, next:{receipt:admitted,admitted:candidate,opened:{
            config:{apps:[{name:'worker',script:'dist/main.js'}]},stackConfig:{type:'remote',infrastructure:{postgres:{databases:{worker:{migrate:true}}}}} }}}) });
      const rpc = new ProjectRpcService(service), baselineRows = [{name:names[0]!,checksum:hash('001'),executedAt:'2026-11-01T00:00:00.125456Z'}];
      let outcome: MigrationRehearsalResult | undefined, executions = 0;
      const native = vi.fn(async (plan: MigrationRehearsalPlan, archive: string, readOnly: boolean): Promise<MigrationRehearsalResult> => {
        expect(archive).toBe(f.archive);
        if (outcome) return outcome;
        if (readOnly) return {state:'awaiting-confirmation',writeAdmission:'withheld',plan};
        executions++;
        const after = [...baselineRows,...names.slice(1).map(name=>({name,checksum:hash(name),executedAt:'2026-11-24T12:00:00.123456Z'}))];
        outcome = {state:'verified',writeAdmission:'withheld',plan,receipt:{operationId,review:plan.digest,
          registry:after.map(({name,checksum})=>({name,checksum})),before:baselineRows,after,generations:{postgres:hash('changed'),minio:hash('minio-data')}}};
        throw Error('receiver reply lost');
      });
      service.setPhysicalRestoreInspector(async () => { throw Error('unexpected direct probe'); }, undefined, native);
      await expect(rpc.rehearseMigrations(input)).rejects.toThrow('confirmed private pair');
      store.kvSetSync('release:private-rehearsal:'+operationId,{plan:copy,receipt});
      await expect(rpc.rehearseMigrations({...input,app:'other'})).rejects.toThrow('script owner');
      await expect(rpc.rehearseMigrations({...input,path:'/input'} as typeof input)).rejects.toThrow('exact release');
      inspection.migrationHistory.entries = [addition,addition];
      await expect(rpc.rehearseMigrations(input)).rejects.toThrow('entirely to the selected application');
      inspection.migrationHistory.entries = [addition,final];
      const preview = await rpc.rehearseMigrations(input);
      expect(preview).toMatchObject({state:'awaiting-confirmation',writeAdmission:'withheld',plan:{names,added:names.slice(1),
        copy,receipt,archiveSha256:candidate.files[0]!.sha256,program:{sha256:hash(payload)}}});
      await expect(rpc.rehearseMigrations({...input,review:hash('wrong')})).rejects.toThrow('review changed');
      expect(native).not.toHaveBeenCalled();
      await expect(rpc.rehearseMigrations({...input,review:preview.plan.digest})).rejects.toThrow('reply lost');
      const complete = await rpc.rehearseMigrations(input);
      if (complete.state !== 'verified') throw Error('missing recovered receipt');
      expect(complete).toEqual(outcome);
      await expect(rpc.rehearseMigrations({...input,review:preview.plan.digest})).resolves.toEqual(complete);
      expect(native.mock.calls.map(call=>call[2])).toEqual([false,true,true]);
      expect(executions).toBe(1);
      const evidence = complete.receipt, changed = evidence.after.map((row,i)=>i===0?{...row,executedAt:'2026-11-02T00:00:00.125456Z'}:row);
      expect(() => checkMigrationRehearsal(preview.plan,{...evidence,after:changed})).toThrow('Previously applied');
      expect(() => checkMigrationRehearsal(preview.plan,{...evidence,registry:evidence.registry.slice(1)})).toThrow('Incomplete');
      expect(() => checkMigrationRehearsal(preview.plan,{...evidence,generations:{...evidence.generations,minio:hash('modified')}})).toThrow('Incomplete');
      expect(() => checkMigrationRehearsal(preview.plan,{...evidence,generations:{...evidence.generations,postgres:hash('postgres-data')}})).toThrow('Incomplete');
      outcome = {state:'awaiting-confirmation',writeAdmission:'withheld',plan:preview.plan};
      await expect(rpc.rehearseMigrations({...input,review:preview.plan.digest})).rejects.toThrow('no longer confirms');
      await fs.appendFile(f.archive,'altered');
      await expect(rpc.rehearseMigrations(input)).rejects.toThrow();
      expect(native).toHaveBeenCalledTimes(4); await missing(f.marker);
    } finally { await store.dispose(); }
  });
  it('checks foreign-target archives and arbitrary physical files without executing code or writing an installation', async () => {
    const f = await fixture(), cleaned = captureScratch();
    const before = await fs.readFile(f.archive), manifest = await fs.readFile(path.join(f.store, 'fixture/manifest.json'));
    const result = await f.inspect({ files: [{ path: 'dist/native/service' }, { path: 'dist/native/asset.json' }, { path: 'static/index.html' }] });
    expect(result.manifestSha256).toBe(hash(manifest));
    expect(result.producer).toEqual({ manifest: f.manifest, manifestSha256: hash(manifest), app: 'worker', chain: [] });
    expect(result.closure.target).toEqual(target);
    expect(result.closure.nodeOptions).toBe('--max-old-space-size=512');
    expect(result.closure.sha256).toBe(f.manifest.artifacts[0]!.launch!.closureSha256);
    expect(result.files.map(file => file.path)).toEqual(['dist/main.js', 'dist/native/service', 'dist/native/asset.json', 'static/index.html']);
    for (const file of result.files) {
      const raw = await fs.readFile(path.join(f.source, file.path));
      expect(file).toEqual({ path: file.path, sha256: hash(raw), bytes: raw.length });
    }
    expect(await fs.readFile(f.archive)).toEqual(before);
    expect(await fs.readFile(path.join(f.store, 'fixture/manifest.json'))).toEqual(manifest);
    expect(await fs.readdir(f.store)).toEqual(['fixture']);
    await missing(f.marker); await cleaned();
  });

  it('returns exact requested bytes, with the launch once and request order retained', async () => {
    const f = await fixture();
    const result = await f.inspect({ files: [{ path: 'static/index.html', includeContents: true },
      { path: 'dist/main.js', includeContents: true }, { path: 'dist/migrations.js', includeContents: true }] });
    expect(result.files.map(file => file.path)).toEqual(['dist/main.js', 'static/index.html', 'dist/migrations.js']);
    for (const file of result.files) expect(file.contents).toEqual(await fs.readFile(path.join(f.source, file.path)));
    await missing(f.marker);
  });

  it('keeps the initially requested paths and content policy when the caller mutates them during verification', async () => {
    const f = await fixture();
    const files = [{ path: 'static/index.html', includeContents: false }];
    const pending = f.inspect({ files });
    files[0]!.path = '../escape'; files[0]!.includeContents = true;
    files.push(...Array.from({ length: 65 }, (_, index) => ({ path: `${index}.bin`, includeContents: true })));
    const result = await pending;
    expect(result.files.map(file => file.path)).toEqual(['dist/main.js', 'static/index.html']);
    expect(result.files.every(file => file.contents === undefined)).toBe(true);
  });

  it('verifies an owned bootstrap adapter by resolution without evaluating application, adapter or Titan', async () => {
    const f = await fixture(true);
    expect((await f.inspect()).artifact.launch!.mode).toBe('bootstrap');
    await missing(f.marker);
  });

  it('binds an imported alias to the producer target and exact embedded manifest, not the consumer target', async () => {
    const f = await fixture();
    const original = JSON.stringify(f.manifest), originalSha = hash(original);
    const consumer = { ...f.manifest, id: 'consumer', builtWith: { ...f.manifest.builtWith,
      target: { ...target, platform: 'darwin', arch: 'arm64', executableSha256: 'e'.repeat(64), libc: null } },
      imports: [{ sha256: originalSha, manifestJson: original }], artifacts: [{ ...f.manifest.artifacts[0]!, app: 'api',
        origin: { release: 'fixture', manifestSha256: originalSha, app: 'worker' } }] };
    await fs.mkdir(path.join(f.store, 'consumer/artifacts'), { recursive: true });
    await fs.copyFile(f.archive, path.join(f.store, 'consumer/artifacts/api-1.0.0.tar.gz'));
    await fs.writeFile(path.join(f.store, 'consumer/manifest.json'), JSON.stringify(consumer));
    const result = await inspectReleaseArtifact('consumer', 'api', { releasesRoot: f.store });
    expect(result.artifact.app).toBe('api');
    expect(result.producer).toEqual({ manifest: f.manifest, manifestSha256: originalSha, app: 'worker', chain: [consumer.artifacts[0]!.origin] });
    expect(result.closure.target).toEqual(target);
    await fs.writeFile(path.join(f.store, 'consumer/manifest.json'), JSON.stringify({ ...consumer, imports: [{ sha256: originalSha, manifestJson: original + ' ' }] }));
    await expect(inspectReleaseArtifact('consumer', 'api', { releasesRoot: f.store })).rejects.toThrow('pinned digest');
  });

  it.each(['../main.js', '/etc/passwd', 'dist/../dist/main.js', 'dist\\main.js', 'dist//main.js', '', 'dist'])('refuses nonphysical or noncanonical requested member %s', async name => {
    const f = await fixture(), cleaned = captureScratch();
    await expect(f.inspect({ files: [{ path: name }] })).rejects.toThrow();
    await cleaned();
  });

  it('refuses in-tree file and parent symlink aliases as requested files', async () => {
    const f = await fixture();
    await fs.symlink('dist/main.js', path.join(f.source, 'alias.js'));
    await fs.symlink('dist', path.join(f.source, 'alias-dir'));
    await f.reseal();
    await expect(f.inspect({ files: [{ path: 'alias.js' }] })).rejects.toThrow('physical regular');
    await expect(f.inspect({ files: [{ path: 'alias-dir/main.js' }] })).rejects.toThrow('physical regular');
  });

  it('fails closed on legacy missing launch and missing closure', async () => {
    const f = await fixture();
    const { launch: _launch, ...legacy } = f.manifest.artifacts[0]!;
    const current = f.manifest;
    await f.publish({ ...current, artifacts: [legacy] });
    await expect(f.inspect()).rejects.toThrow('valid admitted compiled launch');
    await f.publish(current);
    await fs.unlink(path.join(f.source, CLOSURE_FILE)); await f.pack();
    const cleaned = captureScratch();
    await expect(f.inspect()).rejects.toThrow(); await cleaned();
  });

  it('rejects missing or incomplete recorded targets before allocating scratch', async () => {
    const f = await fixture();
    await f.publish({ ...f.manifest, builtWith: { omnitron: 'fixture', packages: [] } });
    await expect(f.inspect()).rejects.toThrow('complete recorded execution target');
    await f.publish({ ...f.manifest, builtWith: { omnitron: 'fixture', packages: [], target: {} as TargetRuntime } });
    await expect(f.inspect()).rejects.toThrow('complete recorded execution target');
  });

  it('refuses closure target mismatch and unsafe Node preloads', async () => {
    const f = await fixture();
    await f.reseal({ runtime: { ...target, arch: 'arm64' } });
    await expect(f.inspect()).rejects.toThrow('recorded release target: arch');
    await f.reseal({ nodeOptions: '--import=./dist/main.js' });
    await expect(f.inspect()).rejects.toThrow('NODE_OPTIONS permits only');
    await missing(f.marker);
  });

  it('refuses altered payload and closure even when the archive hash is honestly updated', async () => {
    const f = await fixture(), cleaned = captureScratch();
    await f.write('dist/native/asset.json', '{}'); await f.pack();
    await expect(f.inspect()).rejects.toThrow('files differ from the admitted payload');
    await cleaned();
    await fs.appendFile(path.join(f.source, CLOSURE_FILE), ' '); await f.pack();
    await expect(f.inspect()).rejects.toThrow('closure differs from the admitted manifest');
  });

  it('refuses a replaced archive between load and private copy', async () => {
    const f = await fixture(), cleaned = captureScratch(), copy = fs.copyFile.bind(fs);
    vi.spyOn(fs, 'copyFile').mockImplementation(async (source, destination, mode) => {
      await copy(source, destination, mode);
      if (String(source) === f.archive) await fs.appendFile(destination, 'changed after load');
    });
    await expect(f.inspect()).rejects.toThrow('archive changed before inspection');
    await cleaned();
  });

  it('inherits the shared extractor refusal of injected operational metadata', async () => {
    const f = await fixture();
    await f.write('.omnitron-release.json', '{"version":2}');
    await f.pack();
    await expect(f.inspect()).rejects.toThrow('Invalid release archive member');
  });

  it('inherits the shared extractor refusal of escaping archive links', async () => {
    const f = await fixture();
    await fs.symlink('../outside', path.join(f.source, 'escape'));
    await create({ file: f.archive, cwd: f.source, gzip: true }, ['dist', 'static', CLOSURE_FILE, 'escape']);
    const bytes = await fs.readFile(f.archive);
    await f.publish({ ...f.manifest, artifacts: [{ ...f.manifest.artifacts[0]!, bytes: bytes.length, sha256: hash(bytes) }] });
    await expect(f.inspect()).rejects.toThrow('link leaves its root');
  });

  it('bounds content opt-in without prohibiting streaming evidence for larger native files', async () => {
    const f = await fixture(), bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 127);
    await f.write('dist/native/service', bytes); await f.reseal();
    const result = await f.inspect({ files: [{ path: 'dist/native/service' }] });
    expect(result.files[1]).toEqual({ path: 'dist/native/service', sha256: hash(bytes), bytes: bytes.length });
    await expect(f.inspect({ files: [{ path: 'dist/native/service', includeContents: true }] })).rejects.toThrow('byte limit');
  });

  it('bounds total content and rejects duplicate or excessive file requests', async () => {
    const f = await fixture();
    const requests = Array.from({ length: 5 }, (_, index) => ({ path: `part${index}.bin`, includeContents: true }));
    for (const { path: name } of requests) await f.write(name, Buffer.alloc(4 * 1024 * 1024));
    await f.reseal();
    await expect(f.inspect({ files: requests })).rejects.toThrow('byte limit');
    await expect(f.inspect({ files: [{ path: 'dist/main.js' }, { path: 'dist/main.js' }] })).rejects.toThrow('distinct release file requests');
    await expect(f.inspect({ files: Array.from({ length: 65 }, (_, index) => ({ path: `${index}.js` })) })).rejects.toThrow('at most 64');
  });
});
