import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { artifactReleaseContext, artifactReleaseContexts, importedReleaseRefusal, validateReleaseOrigins } from '../../src/release/origin.js';
import { decideStackRelease, type ReleaseArtifactReference, type ReleaseManifest } from '../../src/release/manifest.js';
import { importReleaseArtifacts } from '../../src/release/import-artifacts.js';
import { loadRelease } from '../../src/release/load.js';
import { defineEcosystem } from '../../src/config/define-ecosystem.js';
import { loadEcosystemConfigFile } from '../../src/config/loader.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const content = Buffer.from('producer archive bytes, unchanged by the consumer');
const cleanup: string[] = [];
afterEach(async () => { for (const root of cleanup.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
function producer(id = 'upstream'): ReleaseManifest {
  return {
    id, project: { repo: 'https://example.invalid/upstream.git', commit: 'a'.repeat(40), onRemote: true },
    omni: { repo: 'https://example.invalid/framework.git', commit: 'b'.repeat(40), onRemote: true },
    artifacts: [{ app: 'worker', version: '1.0.0', sha256: hash(content), bytes: content.length,
      launch: { mode: 'bootstrap', file: 'dist/bootstrap.js', closureSha256: 'd'.repeat(64) },
      packageSource: { directory: 'apps/worker', manifestBlob: 'e'.repeat(40), migrations: { 'src/migrations/001.ts': 'f'.repeat(64) } } }],
    gates: [{ name: 'test', status: 'passed' }], builtAt: '2026-01-01T00:00:00Z', builtBy: 'fixture',
    builtWith: { omnitron: 'fixture', packages: [], target: { platform: 'darwin', arch: 'arm64', node: 'v24.13.0', abi: '137', executableSha256: '1'.repeat(64), libc: null } },
  };
}
function consumer(source = producer(), alias = 'collector', id = 'consumer'): ReleaseManifest {
  const raw = JSON.stringify(source, null, 2) + '\n';
  const ref = { release: source.id, manifestSha256: hash(raw), app: source.artifacts[0]!.app };
  return { ...producer(id), project: { repo: 'consumer', commit: '2'.repeat(40), onRemote: true },
    omni: { repo: 'consumer-framework', commit: '3'.repeat(40), onRemote: true },
    artifacts: [{ ...source.artifacts[0]!, app: alias, origin: ref }],
    imports: [{ sha256: ref.manifestSha256, manifestJson: raw }] };
}
async function store(manifest: ReleaseManifest) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'release-import-'));
  cleanup.push(root);
  const source = path.join(root, manifest.id);
  await fs.mkdir(path.join(source, 'artifacts'), { recursive: true });
  const raw = JSON.stringify(manifest, null, 2) + '\n';
  await fs.writeFile(path.join(source, 'manifest.json'), raw);
  for (const artifact of manifest.artifacts) await fs.writeFile(path.join(source, 'artifacts', artifact.app + '-' + artifact.version + '.tar.gz'), content);
  await fs.mkdir(path.join(root, 'consumer', 'artifacts'), { recursive: true });
  return { root, source, destination: path.join(root, 'consumer', 'artifacts'), ref: { release: manifest.id, manifestSha256: hash(raw), app: manifest.artifacts[0]!.app } };
}

describe('independent release artifact provenance', () => {
  it('retains the actual source, SDK, migration package and execution target through consumer aliases', () => {
    const upstream = producer(), release = consumer(upstream);
    const context = artifactReleaseContext(release, 'collector');
    expect(context.manifest).toEqual(upstream);
    expect(context.artifact.app).toBe('worker');
    expect(context.chain).toEqual([release.artifacts[0]!.origin]);
    expect(context.manifest.omni.commit).not.toBe(release.omni.commit);
    expect(validateReleaseOrigins(release)).toBeUndefined();
  });
  it('projects all aliases in one validated evidence operation', () => {
    const release = consumer(), duplicate = { ...release.artifacts[0]!, app: 'second' };
    const readings = artifactReleaseContexts({ ...release, artifacts: [...release.artifacts, duplicate] });
    expect(readings.map(reading => reading.app)).toEqual(['collector', 'second']);
    expect(readings[0]!.manifest).toBe(readings[1]!.manifest);
  });
  it('refuses duplicate or unknown gate outcomes in ordinary consumer admission', () => {
    expect(decideStackRelease({ ...producer(), gates: [{ name: 'test', status: 'unexpected' as never }] }, undefined, ['worker']).action).toBe('refuse');
    expect(decideStackRelease({ ...producer(), gates: [{ name: 'test', status: 'failed' }, { name: 'test', status: 'passed' }] }, undefined, ['worker']).action).toBe('refuse');
  });
  it('preserves a nested dependency chain without replacing original producer identity', () => {
    const middle = consumer(producer()), outer = consumer(middle, 'events', 'outer');
    const context = artifactReleaseContext(outer, 'events');
    expect(context.manifest.id).toBe('upstream');
    expect(context.chain.map(ref => ref.release)).toEqual(['consumer', 'upstream']);
  });
  it('preserves declared migration program provenance through aliases without inventing it for older packages', () => {
    const upstream = producer();
    const programs = [{ mode:'config' as const, source:'src/database/registry.ts', sourceBlob:'a'.repeat(40),
      sourceSha256:'b'.repeat(64), release:'dist/database/registry.js', releaseSha256:'c'.repeat(64) }];
    Object.assign(upstream.artifacts[0]!.packageSource!, { migrationPrograms:programs });
    expect(artifactReleaseContext(consumer(upstream),'collector').artifact.packageSource?.migrationPrograms).toEqual(programs);
    expect(artifactReleaseContext(consumer(),'collector').artifact.packageSource?.migrationPrograms).toBeUndefined();
  });
  it.each(['source','sourceBlob','sourceSha256','release','releaseSha256','mode','duplicate'] as const)(
    'refuses malformed declared migration provenance: %s', field => {
      const upstream = producer();
      const program: Record<string, unknown> = { mode:'config', source:'src/database/registry.ts', sourceBlob:'a'.repeat(40),
        sourceSha256:'b'.repeat(64), release:'dist/database/registry.js', releaseSha256:'c'.repeat(64) };
      if (field !== 'duplicate') program[field] = field === 'source' || field === 'release' ? '../outside.js' : [program[field]];
      Object.assign(upstream.artifacts[0]!.packageSource!, { migrationPrograms:field === 'duplicate' ? [program,program] : [program] });
      expect(() => validateReleaseOrigins(consumer(upstream))).toThrow('Invalid declared migration provenance');
    });
  it.each(['version', 'sha256', 'bytes', 'inputs', 'launch', 'packageSource'] as const)('refuses a consumer override of %s', field => {
    const release = structuredClone(consumer());
    Object.assign(release.artifacts[0]!, { [field]: 'consumer override' });
    expect(() => artifactReleaseContext(release, 'collector')).toThrow('differs from its producer');
  });
  it('refuses reserialized evidence even when it describes the same JSON object', () => {
    const release = structuredClone(consumer());
    Object.assign(release.imports![0]!, { manifestJson: JSON.stringify(producer()) });
    expect(() => validateReleaseOrigins(release)).toThrow('pinned digest');
  });
  it('refuses evidence pinned under a different release id or absent from the consumer', () => {
    const release = structuredClone(consumer());
    Object.assign(release.artifacts[0]!.origin!, { release: 'elsewhere' });
    expect(() => validateReleaseOrigins(release)).toThrow('Missing pinned producer');
    expect(() => validateReleaseOrigins({ ...consumer(), imports: [] })).toThrow('Missing pinned producer');
  });
  it('rejects oversized and duplicate evidence before traversing it', () => {
    const release = consumer();
    expect(() => validateReleaseOrigins({ ...release, imports: [...release.imports!, ...release.imports!] })).toThrow('duplicate');
    expect(() => validateReleaseOrigins({ ...release, imports: [{ sha256: 'a'.repeat(64), manifestJson: ' '.repeat(4_194_305) }] })).toThrow('Invalid');
  });
  it('requires frozen producer evidence rather than interpreting legacy archives as independently portable', () => {
    const upstream = producer();
    const { launch: _launch, ...legacy } = upstream.artifacts[0]!;
    expect(() => validateReleaseOrigins(consumer({ ...upstream, artifacts: [legacy] }))).toThrow('frozen entry');
  });
  it.each(['closureSha256', 'manifestBlob', 'migrationSha256', 'executableSha256'] as const)('refuses JSON values coerced to a valid %s digest', field => {
    const upstream = producer(), artifact = upstream.artifacts[0]!;
    if (field === 'closureSha256') Object.assign(artifact.launch!, { closureSha256: [artifact.launch!.closureSha256] });
    if (field === 'manifestBlob') Object.assign(artifact.packageSource!, { manifestBlob: [artifact.packageSource!.manifestBlob] });
    if (field === 'migrationSha256') Object.assign(artifact.packageSource!.migrations, { 'src/migrations/001.ts': ['f'.repeat(64)] });
    if (field === 'executableSha256') Object.assign(upstream.builtWith.target!, { executableSha256: [upstream.builtWith.target!.executableSha256] });
    const release = consumer(upstream);
    // Recomputed manifest pins and identical consumer metadata cannot make malformed source evidence valid.
    expect(() => validateReleaseOrigins(release)).toThrow('malformed source');
    expect(decideStackRelease(release, undefined, ['collector']).action).toBe('refuse');
  });
  it.each(['launch', 'packageSource', 'target'] as const)('requires %s to be a JSON record', field => {
    const upstream = producer();
    if (field === 'target') Object.assign(upstream.builtWith, { target: [] });
    else Object.assign(upstream.artifacts[0]!, { [field]: [] });
    expect(() => validateReleaseOrigins(consumer(upstream))).toThrow('recorded package source');
  });
  it.each(['failed', 'not-run', 'timed-out', 'killed'] as const)('does not let consumer gates hide producer status %s', status => {
    const release = consumer({ ...producer(), gates: [{ name: 'test', status }] });
    expect(decideStackRelease(release, undefined, ['collector'])).toEqual({ action: 'refuse', because: `imported release upstream: gate 'test' ${status}` });
  });
  it('requires producer gates and preserves the stack remote-source requirement', () => {
    expect(importedReleaseRefusal(consumer({ ...producer(), gates: [] }), ['collector'])).toContain('recorded no gates');
    const release = consumer({ ...producer(), project: { ...producer().project, onRemote: false } });
    expect(decideStackRelease(release, { mode: 'required', requireOnRemote: true }, ['collector']).action).toBe('refuse');
    expect(decideStackRelease(release, undefined, ['collector']).action).toBe('promote');
  });
  it('checks all intermediary producer gates and never substitutes the consumer namespace', () => {
    const middle = { ...consumer(), gates: [{ name: 'integration', status: 'not-run' as const }] };
    expect(importedReleaseRefusal(consumer(middle, 'events', 'outer'), ['events'])).toContain('integration');
    expect(decideStackRelease(consumer(), undefined, ['missing'])).toEqual({ action: 'refuse', because: "the release carries no artifact for 'missing'" });
  });
});

describe('ordinary store import and configuration', () => {
  it('copies admitted bytes and embeds exact source evidence, so the consumer remains loadable after producer removal', async () => {
    const upstream = producer(), f = await store(upstream);
    const imported = await importReleaseArtifacts([{ name: 'collector', releaseFrom: f.ref }], f.destination, f.root);
    const final = { ...consumer(upstream), artifacts: imported.artifacts, imports: imported.imports };
    await fs.writeFile(path.join(f.root, 'consumer/manifest.json'), JSON.stringify(final));
    await fs.rm(f.source, { recursive: true });
    const loaded = await loadRelease('consumer', f.root);
    expect(await fs.readFile(loaded.files[0]!.path)).toEqual(content);
    expect(artifactReleaseContext(loaded.manifest, 'collector').manifest).toEqual(upstream);
  });
  it('refuses a changed manifest, changed archive or destination overwrite', async () => {
    const f = await store(producer());
    await expect(importReleaseArtifacts([{ name: 'collector', releaseFrom: { ...f.ref, manifestSha256: '0'.repeat(64) } }], f.destination, f.root)).rejects.toThrow('pinned release');
    await importReleaseArtifacts([{ name: 'collector', releaseFrom: f.ref }], f.destination, f.root);
    await expect(importReleaseArtifacts([{ name: 'collector', releaseFrom: f.ref }], f.destination, f.root)).rejects.toThrow('EEXIST');
    await fs.writeFile(path.join(f.source, 'artifacts/worker-1.0.0.tar.gz'), Buffer.alloc(content.length));
    await expect(importReleaseArtifacts([{ name: 'other', releaseFrom: f.ref }], f.destination, f.root)).rejects.toThrow('hashes to');
  });
  it('rejects oversized outer manifests before parsing their evidence', async () => {
    const f = await store(producer());
    await fs.writeFile(path.join(f.source, 'manifest.json'), ' '.repeat(8_388_609));
    await expect(loadRelease('upstream', f.root)).rejects.toThrow('exceeds 8 MiB');
  });
  it('does not materialize a producer whose gates did not run', async () => {
    const f = await store({ ...producer(), gates: [] });
    await expect(importReleaseArtifacts([{ name: 'collector', releaseFrom: f.ref }], f.destination, f.root)).rejects.toThrow('no gates');
    expect(await fs.readdir(f.destination)).toEqual([]);
  });
  it('loads a release-only config through the ordinary loader without fabricated bootstrap paths', async () => {
    const f = await store(producer()), file = path.join(f.root, 'omnitron.config.mjs');
    await fs.writeFile(file, 'export default ' + JSON.stringify({ apps: [{ name: 'collector', releaseFrom: f.ref }] }));
    const config = await loadEcosystemConfigFile(file, 'release');
    expect(config.apps[0]!.releaseFrom).toEqual(f.ref);
    expect(config.apps[0]!.bootstrap).toBeUndefined();
    expect(config.apps[0]!.cwd).toBeUndefined();
  });
  it.each([{ script: 'local.js' }, { bootstrap: 'local.js' }, { releaseEntry: 'dist/other.js' }, { releaseRoot: '/other' }, { watch: true }])('refuses ambiguous imported entry options %j', override => {
    const ref: ReleaseArtifactReference = { release: 'upstream', app: 'worker', manifestSha256: 'a'.repeat(64) };
    expect(() => defineEcosystem({ apps: [{ name: 'collector', releaseFrom: ref, ...override } as never] })).toThrow('cannot override');
  });
});
