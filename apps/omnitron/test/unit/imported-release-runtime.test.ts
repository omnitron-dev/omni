import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { refuseReleaseOwners, type ReleaseOwnerAnswer } from '../../src/release/owner-admission.js';
import { changedImportedMigrations } from '../../src/release/migrations.js';
import { installedReleaseCandidates } from '../../src/release/installed-release.js';
import type { ReleaseManifest, ReleaseArtifact } from '../../src/release/manifest.js';
import type { IStackConfig } from '../../src/config/types.js';

const sdk = 'a'.repeat(40), otherSdk = 'b'.repeat(40);
const artifact = (app: string): ReleaseArtifact => ({ app, version: '1.0.0', sha256: 'c'.repeat(64), bytes: 42,
  launch: { mode: 'bootstrap', file: 'dist/bootstrap.js', closureSha256: 'd'.repeat(64) },
  packageSource: { directory: 'apps/api', manifestBlob: 'e'.repeat(40), migrations: { 'src/migrations/001.ts': 'f'.repeat(64) } } });
const producer = (commit = sdk): ReleaseManifest => ({ id: 'producer-1',
  project: { repo: 'https://example.test/producer', commit: '1'.repeat(40) },
  omni: { repo: 'https://example.test/framework', commit, registry: { packages: [] } },
  artifacts: [artifact('api')], gates: [{ name: 'unit', status: 'passed' }],
  builtWith: { omnitron: '0.3.1', packages: [], target: { platform: 'darwin', arch: 'arm64', node: 'v24.13.0', abi: '137', executableSha256: '2'.repeat(64), libc: null } },
  builtAt: '2026-11-03T00:00:00Z', builtBy: 'test',
});
function consumer(source = producer()): ReleaseManifest {
  const manifestJson = JSON.stringify(source), sha256 = createHash('sha256').update(manifestJson).digest('hex');
  return { ...producer(otherSdk), id: 'consumer-1', artifacts: [{ ...source.artifacts[0]!, app: 'imported', origin: { release: source.id, manifestSha256: sha256, app: 'api' } }], imports: [{ sha256, manifestJson }] };
}
const node = (host: string, commit: string, port = 9700): ReleaseOwnerAnswer => ({ host, port,
  runtime: { root: '/runtime/packages/0', executable: '/runtime/node', commit, target: producer().builtWith.target!,
    execution: { mode: 'resident', protocol: 1, ownerId: 'owner', pid: 42, epoch: 9 } } });

describe('runtime identity of imported artifacts', () => {
  it('checks the producer target on its exact placement, independent of all SDK commits and cache nodes', () => {
    const imported = consumer(); const release = { ...imported, artifacts: [...imported.artifacts, artifact('own')] };
    const stack = { type: 'cluster', nodes: [{ host: 'same.test', port: 9700, apps: ['imported'] }, { host: 'same.test', port: 9701, apps: ['own'] }, { host: 'cache.test', role: 'cache' }] } as IStackConfig;
    const entries = [{ name: 'imported' }, { name: 'own' }];
    expect(refuseReleaseOwners(release, stack, entries, [node('same.test', sdk), node('same.test', otherSdk, 9701)])).toBeNull();
    expect(refuseReleaseOwners(release, stack, entries, [node('same.test', otherSdk), node('same.test', sdk, 9701)])).toBeNull();
    const wrong = node('same.test', sdk);
    wrong.runtime!.target = { ...wrong.runtime!.target!, abi: 'unsupported' };
    expect(refuseReleaseOwners(release, stack, entries, [wrong, node('same.test', sdk, 9701)])).toContain('imported on same.test:9700');
    expect(refuseReleaseOwners(release, stack, entries, [node('same.test', sdk)])).toContain('same.test:9701 has no unique');
    expect(refuseReleaseOwners(release, stack, entries, [node('same.test', sdk), node('same.test', sdk), node('same.test', otherSdk, 9701)])).toContain('no unique');
  });

  it('compares a retained archive to the producer SDK and never infers live-process confirmation', () => {
    const release = consumer(), file = release.artifacts[0]!;
    const observed = { app: 'consumer/dev/imported', state: 'observed' as const, observedAt: '2026-11-03T00:00:00Z', pid: 10, startedAt: '2026-11-03T00:00:00Z',
      entrySha256: 'f'.repeat(64), frameworkCommit: sdk,
      archives: [{ sha256: file.sha256, bytes: file.bytes, entrySha256: 'f'.repeat(64) }], reasons: [] };
    const catalog = { complete: true, reasons: [], releases: [{ manifest: release, sha256: '3'.repeat(64) }] };
    expect(installedReleaseCandidates(observed, catalog)[0]?.state).toBe('entry-matches');
    expect(installedReleaseCandidates({ ...observed, frameworkCommit: otherSdk }, catalog)[0]?.state).toBe('modified');
    expect(installedReleaseCandidates({ ...observed, frameworkCommit: sdk.slice(0, 12) }, catalog)[0]?.state).toBe('incomplete');
    catalog.releases[0]!.manifest = { ...release, imports: [{ ...release.imports![0]!, manifestJson: '{}' }] };
    expect(installedReleaseCandidates(observed, catalog)[0]?.state).toBe('incomplete');
  });

  it('preserves migration history at the producer package instead of comparing consumer paths', () => {
    const old = consumer(); let next = producer();
    next = { ...next, artifacts: [ { ...next.artifacts[0]!, packageSource: { ...next.artifacts[0]!.packageSource!, migrations: { ...next.artifacts[0]!.packageSource!.migrations, 'src/migrations/002.ts': '4'.repeat(64) } } }] };
    expect(changedImportedMigrations(old, consumer(next), ['imported'])).toEqual([]);
    next = { ...next, artifacts: [{ ...next.artifacts[0]!, packageSource: { ...next.artifacts[0]!.packageSource!, migrations: { 'src/migrations/001.ts': '5'.repeat(64) } } }] };
    expect(changedImportedMigrations(old, consumer(next), ['imported'])).toEqual(['imported/src/migrations/001.ts']);
    next = { ...next, artifacts: [{ ...next.artifacts[0]!, packageSource: { ...next.artifacts[0]!.packageSource!, directory: 'apps/another' } }] };
    expect(changedImportedMigrations(old, consumer(next), ['imported'])).toEqual(['imported: the package that owns existing migrations changed']);
  });
});
