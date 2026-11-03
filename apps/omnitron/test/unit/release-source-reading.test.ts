import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readArtifactSources, readReleaseDetail } from '../../src/release/store.js';
import { MAX_RELEASE_MANIFEST_BYTES } from '../../src/release/origin.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const source: ReleaseManifest = {
  id: 'producer', project: { repo: 'producer-repository', commit: 'a'.repeat(40) },
  omni: { repo: 'producer-sdk', commit: 'b'.repeat(40) },
  artifacts: [{ app: 'worker', version: '1.0.0', sha256: '1'.repeat(64), bytes: 12,
    launch: { mode: 'bootstrap', file: 'dist/bootstrap.js', closureSha256: '2'.repeat(64) },
    packageSource: { directory: 'apps/worker', manifestBlob: 'c'.repeat(40), migrations: {} },
  }],
  gates: [{ name: 'test', status: 'passed' }], builtAt: '2026-01-01T00:00:00Z', builtBy: 'fixture',
  builtWith: { omnitron: '1.0.0', packages: [], target: {
    node: 'v24.13.0', platform: 'darwin', arch: 'arm64', abi: '137', libc: null, executableSha256: '3'.repeat(64),
  } },
};
const raw = JSON.stringify(source), ref = { release: source.id, app: 'worker', manifestSha256: hash(raw) };
const consumer: ReleaseManifest = {
  ...source, id: 'consumer', project: { repo: 'consumer', commit: 'd'.repeat(40) },
  omni: { repo: 'consumer-sdk', commit: 'e'.repeat(40) },
  artifacts: [{ ...source.artifacts[0]!, app: 'collector', origin: ref }],
  imports: [{ sha256: ref.manifestSha256, manifestJson: raw }],
};
const temporary: string[] = [];
afterEach(() => { for (const root of temporary.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function store() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'source-reading-')));
  temporary.push(root); fs.mkdirSync(path.join(root, 'consumer'));
  return { root, file: path.join(root, 'consumer', 'manifest.json') };
}
describe('per-application source presentation', () => {
  it('reports the actual producer SDK and source in the same detail read used by Console', () => {
    const f = store(); fs.writeFileSync(f.file, JSON.stringify(consumer));
    const detail = readReleaseDetail('consumer', f.root);
    expect(detail.manifestSha256).toBe(hash(JSON.stringify(consumer)));
    expect(detail.artifactSources).toEqual([{
      app: 'collector', state: 'recorded', releaseId: 'producer', producerApp: 'worker',
      project: source.project, framework: source.omni, target: source.builtWith.target,
      packageDirectory: 'apps/worker', via: [ref],
    }]);
    expect(detail.manifest?.omni).toEqual(consumer.omni);
  });
  it('reports invalid evidence without attributing it to the consumer SDK', () => {
    const readings = readArtifactSources({ ...consumer, imports: [] });
    expect(readings).toEqual([{ app: 'collector', state: 'invalid', reason: expect.stringContaining('Missing pinned producer') }]);
    expect(readings[0]).not.toHaveProperty('framework');
  });
  it('continues to describe a legacy artifact without invented imported evidence', () => {
    const legacy = { ...source, artifacts: [{ app: 'worker', version: '1.0.0', bytes: 12, sha256: '1'.repeat(64) }] };
    expect(readArtifactSources(legacy)[0]).toMatchObject({ app: 'worker', state: 'recorded', via: [], framework: source.omni });
    expect(readArtifactSources(legacy)[0]).not.toHaveProperty('packageDirectory');
  });
  it('refuses an oversized manifest, a linked manifest, and malformed arrays without crashing the catalog', () => {
    const f = store(); fs.writeFileSync(f.file, JSON.stringify(consumer) + ' '.repeat(MAX_RELEASE_MANIFEST_BYTES));
    expect(readReleaseDetail('consumer', f.root).manifest).toBeNull();
    fs.unlinkSync(f.file); fs.writeFileSync(path.join(f.root, 'outside.json'), JSON.stringify(consumer));
    fs.symlinkSync(path.join(f.root, 'outside.json'), f.file);
    expect(readReleaseDetail('consumer', f.root).manifest).toBeNull();
    fs.unlinkSync(f.file); fs.writeFileSync(f.file, JSON.stringify({ ...consumer, artifacts: null }));
    expect(readReleaseDetail('consumer', f.root).manifest).toBeNull();
  });
  it('does not identify a different release as the requested catalog entry', () => {
    const f = store(); fs.writeFileSync(f.file, JSON.stringify(source));
    const detail = readReleaseDetail('consumer', f.root);
    expect(detail).toMatchObject({ complete: false, manifest: null, manifestSha256: null, artifactSources: [] });
  });
});
