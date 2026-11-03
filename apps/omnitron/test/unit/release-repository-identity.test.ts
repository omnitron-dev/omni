import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readReleaseSource } from '../../src/release/build-run.js';
import { assertRepositoryIdentity, isSafeRepositoryIdentity, REPOSITORY_IDENTITY_ERROR } from '../../src/release/repository-identity.js';
import { isReadableReleaseManifest, validateReleaseOrigins } from '../../src/release/origin.js';
import { loadRelease } from '../../src/release/load.js';
import { listReleases, readArtifactSources, readReleaseDetail, readReleaseManifest } from '../../src/release/store.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';

const cleanup: string[] = [];
afterEach(() => { for (const directory of cleanup.splice(0)) fs.rmSync(directory, { force: true, recursive: true }); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function directory() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'release-repository-')));
  cleanup.push(root); return root;
}
function release(id = 'consumer'): ReleaseManifest {
  return {
    id, project: { repo: 'git@example.invalid:team/project.git', commit: 'a'.repeat(40) },
    omni: { repo: 'https://example.invalid/framework.git', commit: 'b'.repeat(40) },
    artifacts: [], gates: [{ name: 'test', status: 'passed' }],
    builtWith: { omnitron: '1.0.0', packages: [] }, builtAt: '2026-01-01T00:00:00Z', builtBy: 'fixture',
  };
}
function write(manifest: ReleaseManifest | string) {
  const root = directory(), dir = path.join(root, 'consumer'); fs.mkdirSync(dir);
  const raw = typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  const file = path.join(dir, 'manifest.json'); fs.writeFileSync(file, raw);
  return { root, file, raw };
}

describe('public repository identity', () => {
  it.each([
    'https://example.invalid/team/project.git', 'http://example.invalid:8080/project.git',
    'ssh://git@example.invalid:2222/team/project.git', 'git+ssh://git@example.invalid/project.git',
    'git://example.invalid/project.git', 'git@example.invalid:team/project.git', 'example.invalid:team/project.git',
    'git@[2001:db8::1]:team/project.git', 'ssh://git@[2001:db8::1]:2222/project.git',
    'file:///home/user/project.git', '/home/user/projects/a repo.git', './repo?name#part@local', '../project.git',
    '~/project.git', 'C:\\projects\\repo.git', 'C:/projects/repo.git', 'packages/project.git', 'packages/project:branch.git', '(no origin)',
  ])('preserves safe identity bytes: %s', repo => {
    expect(isSafeRepositoryIdentity(repo)).toBe(true);
    expect(() => assertRepositoryIdentity(repo)).not.toThrow();
  });
  it.each([
    'https://secret-token@example.invalid/project.git', 'https://user:secret-token@example.invalid/project.git',
    'https://example.invalid/project.git?token=secret-token', 'https://example.invalid/project.git#secret-token',
    'https://example.invalid/project.git?', 'https://example.invalid/project.git#',
    'ssh://git:secret-token@example.invalid/project.git', 'ssh://git:@example.invalid/project.git',
    'git:secret-token@example.invalid:project.git', 'git@example.invalid:project.git?token=secret-token',
    'git@example.invalid:project.git#secret-token', 'git+https://secret-token@example.invalid/project.git',
    'file://secret-token@example.invalid/project.git', 'https:\\secret-token@example.invalid\\project.git',
    'ext::helper secret-token', 'https://example.invalid/repo.git\nsecret-token',
    'https://example.invalid/\0secret-token', '', ' '.repeat(10), ['https://example.invalid/repo.git'],
  ])('refuses unsafe or malformed identity without echoing it: %j', repo => {
    expect(isSafeRepositoryIdentity(repo)).toBe(false);
    expect(() => assertRepositoryIdentity(repo)).toThrow(REPOSITORY_IDENTITY_ERROR);
  });
  it('reads normal Git origins exactly and rejects credential origins before recording them', async () => {
    const root = directory(); execFileSync('git', ['init', '--quiet', root]);
    const safe = 'git@example.invalid:team/project.git';
    execFileSync('git', ['config', '--local', 'remote.origin.url', safe], { cwd: root });
    expect(await readReleaseSource(root, 'a'.repeat(40))).toEqual({ repo: safe, commit: 'a'.repeat(40), onRemote: null });
    execFileSync('git', ['config', '--local', 'remote.origin.url', 'https://secret-token@example.invalid/team/project.git'], { cwd: root });
    await expect(readReleaseSource(root, 'a'.repeat(40))).rejects.toThrow(REPOSITORY_IDENTITY_ERROR);
  });
});

describe('repository admission and catalog boundary', () => {
  it.each(['project', 'omni'] as const)('refuses unsafe %s metadata without changing its pinned bytes', async field => {
    const manifest = release(); Object.assign(manifest[field], { repo: 'https://secret-token@example.invalid/repo.git' });
    const f = write(manifest);
    expect(isReadableReleaseManifest(manifest)).toBe(false);
    expect(() => validateReleaseOrigins(manifest)).toThrow(REPOSITORY_IDENTITY_ERROR);
    await expect(loadRelease('consumer', f.root)).rejects.toThrow(REPOSITORY_IDENTITY_ERROR);
    expect(readReleaseManifest('consumer', f.root)).toBeNull();
    const detail = readReleaseDetail('consumer', f.root), list = listReleases(f.root);
    expect(detail).toMatchObject({ complete: false, manifest: null, manifestSha256: null, manifestError: REPOSITORY_IDENTITY_ERROR });
    expect(list[0]).toMatchObject({ complete: false, manifestError: REPOSITORY_IDENTITY_ERROR });
    expect(JSON.stringify({ detail, list })).not.toContain('secret-token');
    expect(fs.readFileSync(f.file, 'utf8')).toBe(f.raw);
  });
  it('checks nested evidence even when no application imports it', async () => {
    const producer = release('producer'); Object.assign(producer.omni, { repo: 'ssh://git:secret-token@example.invalid/repo.git' });
    const raw = JSON.stringify(producer);
    const intermediate = { ...release('intermediate'), imports: [{ sha256: hash(raw), manifestJson: raw }] };
    const nested = JSON.stringify(intermediate);
    const manifest = { ...release(), imports: [{ sha256: hash(nested), manifestJson: nested }] };
    const f = write(manifest);
    await expect(loadRelease('consumer', f.root)).rejects.toThrow(REPOSITORY_IDENTITY_ERROR);
    expect(readReleaseDetail('consumer', f.root)).toMatchObject({ manifest: null, manifestError: REPOSITORY_IDENTITY_ERROR });
    expect(JSON.stringify(listReleases(f.root))).not.toContain('secret-token');
    expect(fs.readFileSync(f.file, 'utf8')).toBe(f.raw);
  });
  it('never reports parser excerpts from malformed embedded manifests', () => {
    const raw = '{"secret-token": broken}';
    const manifest = { ...release(), artifacts: [{ app: 'worker', version: '1.0.0', bytes: 1, sha256: 'a'.repeat(64) }],
      imports: [{ sha256: hash(raw), manifestJson: raw }] };
    expect(readArtifactSources(manifest)).toEqual([{ app: 'worker', state: 'invalid', reason: 'Imported release manifest is not valid JSON' }]);
    const f = write(manifest);
    expect(JSON.stringify(readReleaseDetail('consumer', f.root))).not.toContain('secret-token');
  });
  it('distinguishes absent metadata from rejected metadata and preserves valid raw digests', async () => {
    const f = write(release());
    expect(readReleaseDetail('consumer', f.root)).toMatchObject({ complete: true, manifestSha256: hash(f.raw) });
    expect(readReleaseDetail('consumer', f.root)).not.toHaveProperty('manifestError');
    fs.writeFileSync(f.file, '{"secret-token": broken}');
    await expect(loadRelease('consumer', f.root)).rejects.toThrow('Release manifest is not valid JSON');
    expect(readReleaseDetail('consumer', f.root)).toHaveProperty('manifestError');
    fs.unlinkSync(f.file);
    expect(readReleaseDetail('consumer', f.root)).toMatchObject({ complete: false });
    expect(readReleaseDetail('consumer', f.root)).not.toHaveProperty('manifestError');
  });
  it('reports a dangling manifest link as rejected metadata rather than an unfinished build', () => {
    const f = write(release()); fs.unlinkSync(f.file);
    fs.symlinkSync(path.join(f.root, 'missing-secret-token'), f.file);
    const detail = readReleaseDetail('consumer', f.root);
    expect(detail).toMatchObject({ complete: false, manifest: null, manifestError: 'Release metadata is invalid or unsafe; admission is refused' });
    expect(JSON.stringify(detail)).not.toContain('secret-token');
  });
});
