import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { releaseArtifactOrigins } from '../../src/release/origin.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const producer: ReleaseManifest = {
  id: 'producer',
  project: { repo: 'producer-repository', commit: 'a'.repeat(40) },
  omni: { repo: 'producer-sdk', commit: 'b'.repeat(40) },
  artifacts: [
    {
      app: 'worker',
      version: '1.0.0',
      sha256: '1'.repeat(64),
      bytes: 12,
      launch: { mode: 'bootstrap', file: 'dist/bootstrap.js', closureSha256: '2'.repeat(64) },
      packageSource: { directory: 'apps/worker', manifestBlob: 'c'.repeat(40), migrations: {} },
    },
  ],
  gates: [{ name: 'test', status: 'passed' }],
  builtAt: '2026-01-01T00:00:00Z',
  builtBy: 'fixture',
  builtWith: {
    omnitron: '1.0.0',
    packages: [],
    target: {
      node: 'v24.13.0',
      platform: 'darwin',
      arch: 'arm64',
      abi: '137',
      libc: null,
      executableSha256: '3'.repeat(64),
    },
  },
};
const wrap = (source: ReleaseManifest, id: string, app: string): ReleaseManifest => {
  const raw = JSON.stringify(source);
  return {
    ...source,
    id,
    project: { repo: id, commit: 'd'.repeat(40) },
    omni: { repo: id + '-sdk', commit: 'e'.repeat(40) },
    artifacts: [
      {
        ...source.artifacts[0]!,
        app,
        origin: { release: source.id, app: source.artifacts[0]!.app, manifestSha256: hash(raw) },
      },
    ],
    imports: [{ manifestJson: raw, sha256: hash(raw) }],
  };
};
it.each([1, 2])('keeps the original producer after %i alias import hops for both delivery paths', (depth) => {
  const middle = wrap(producer, 'middle', 'collector');
  const consumer = depth === 1 ? middle : wrap(middle, 'consumer', 'ingester');
  const digest = hash(JSON.stringify(consumer));
  const [mapped] = releaseArtifactOrigins(consumer, digest);
  expect(mapped!.origin).toEqual({
    releaseId: producer.id,
    manifestSha256: hash(JSON.stringify(producer)),
    artifactSha256: producer.artifacts[0]!.sha256,
    artifactBytes: 12,
    app: consumer.artifacts[0]!.app,
    frameworkCommit: producer.omni.commit,
    runtimeOrigin: {
      projectCommit: producer.project.commit,
      producerApp: 'worker',
      consumer: { releaseId: consumer.id, manifestSha256: digest, app: consumer.artifacts[0]!.app },
      entry: { relativeFile: 'dist/bootstrap.js', mode: 'bootstrap' },
    },
  });
  expect(mapped!.chain).toHaveLength(depth);
});
it('keeps direct origin and consumer identical without inventing an import', () => {
  const digest = hash(JSON.stringify(producer));
  const [mapped] = releaseArtifactOrigins(producer, digest);
  expect(mapped!.origin.releaseId).toBe('producer');
  expect(mapped!.origin.manifestSha256).toBe(digest);
  expect(mapped!.origin.runtimeOrigin?.consumer).toEqual({
    releaseId: 'producer',
    manifestSha256: digest,
    app: 'worker',
  });
});
it('refuses missing or altered producer evidence before creating any receipt', () => {
  const consumer = wrap(producer, 'consumer', 'alias');
  expect(() => releaseArtifactOrigins({ ...consumer, imports: [] }, hash('consumer'))).toThrow(
    'Missing pinned producer'
  );
  const changed = structuredClone(consumer);
  changed.artifacts[0]!.sha256 = '9'.repeat(64);
  expect(() => releaseArtifactOrigins(changed, hash('consumer'))).toThrow('differs from its producer');
});
