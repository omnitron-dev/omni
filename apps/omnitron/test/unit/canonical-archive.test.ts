import { createHash } from 'node:crypto';
import { renameSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { create } from 'tar';
import { checkCanonicalArchivesCommand, receiveCanonicalArchives, stageCanonicalArchivesCommand } from '../../src/release/canonical-archive.js';
import { loadRelease } from '../../src/release/load.js';
import type { ReleaseManifest } from '../../src/release/manifest.js';
import { MAX_RELEASE_MANIFEST_BYTES, releaseArtifactOrigins } from '../../src/release/origin.js';
import { readReleaseManifest } from '../../src/release/store.js';
import type { ApplicationRuntime } from '../../src/services/host-upgrade.js';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const readers = { readReleaseManifest, releaseArtifactOrigins, maxManifestBytes: MAX_RELEASE_MANIFEST_BYTES };
const version = '1.2.3', project = 'fixture';
let root: string, store: string, destinations: string, archiveDir: string, raw: Buffer, manifest: ReleaseManifest;
type Member = Parameters<typeof receiveCanonicalArchives>[0]['members'][number];
let members: Member[];
const target = (app: string) => path.join(destinations, project, app, 'fresh');
const archive = (directory: string, app: string) => path.join(directory, app + '-' + version + '.tar.gz');
const stage = () => receiveCanonicalArchives({ project, members }, store, destinations, readers);
const presence = () => receiveCanonicalArchives({ members: members.map(({ version, origin }) => ({ version, origin })) }, store, destinations, readers);

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'canonical-archive-')));
  store = path.join(root, 'releases'); destinations = path.join(root, 'install');
  archiveDir = path.join(store, 'consumer', 'artifacts');
  await fs.mkdir(archiveDir, { mode: 0o700, recursive: true });
  await fs.writeFile(path.join(root, 'main.js'), 'throw Error("An archive transport cannot execute me")');
  await create({ cwd: root, file: path.join(root, 'fixture.tar.gz'), gzip: true }, ['main.js']);
  raw = await fs.readFile(path.join(root, 'fixture.tar.gz'));
  const artifact = { app: 'worker', version, sha256: hash(raw), bytes: raw.length,
    launch: { mode: 'script' as const, file: 'main.js', closureSha256: 'c'.repeat(64) },
    packageSource: { directory: 'worker', manifestBlob: 'a'.repeat(40), migrations: {} } };
  const producer: ReleaseManifest = { id: 'producer', project: { repo: 'fixture', commit: 'c'.repeat(40) },
    omni: { repo: 'fixture-sdk', commit: 'a'.repeat(40) }, builtAt: '2026-01-01T00:00:00Z', builtBy: 'fixture',
    builtWith: { omnitron: '0.4.0', packages: [], target: { arch: 'x64', platform: 'linux', node: 'v22.1.0', abi: '127', libc: '2.43', executableSha256: 'd'.repeat(64) } },
    artifacts: [artifact], gates: [{ name: 'test', status: 'passed' }] };
  const producerBytes = JSON.stringify(producer);
  manifest = { ...producer, id: 'consumer', project: { repo: 'consumer', commit: 'e'.repeat(40) },
    artifacts: [{ ...artifact, app: 'alias', origin: { release: 'producer', app: 'worker', manifestSha256: hash(producerBytes) } }, { ...artifact, app: 'direct' }],
    imports: [{ manifestJson: producerBytes, sha256: hash(producerBytes) }] };
  await fs.writeFile(path.join(store, manifest.id, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const { app } of manifest.artifacts) {
    await fs.writeFile(archive(archiveDir, app), raw, { mode: 0o600 });
    await fs.mkdir(target(app), { recursive: true, mode: 0o700 });
  }
  const admitted = await loadRelease(manifest.id, store);
  members = releaseArtifactOrigins(admitted.manifest, admitted.manifestSha256).map(({ app, origin }) => ({ version, origin, directory: target(app) }));
});

afterEach(async () => {
  vi.restoreAllMocks(); syncBuiltinESMExports();
  await fs.rm(root, { recursive: true, force: true });
});

it('stages a native-admitted consumer archive under its alias and leaves both canonical files intact', async () => {
  expect(members[0]!.origin).toMatchObject({ releaseId: 'producer', runtimeOrigin: { producerApp: 'worker', consumer: { releaseId: 'consumer' } } });
  expect((await presence()).state).toBe('present');
  const result = await stage();
  expect(result.state).toBe('staged');
  for (const { app, file, bytes, sha256 } of result.files) {
    expect(file).toBe(archive(target(app), app));
    expect(await fs.readdir(target(app))).toEqual([path.basename(file)]);
    expect((await fs.stat(file)).nlink).toBe(1);
    expect(bytes).toBe(raw.length);
    expect(hash(await fs.readFile(file))).toBe(sha256);
    expect(await fs.readFile(archive(archiveDir, app))).toEqual(raw);
  }
  await expect(stage()).rejects.toThrow('must be fresh');
});

it('separates inexpensive availability from verification of the selected bytes and cleans earlier staged files on refusal', async () => {
  const changed = Buffer.from(raw); changed[0] = changed[0]! ^ 1;
  await fs.writeFile(archive(archiveDir, 'direct'), changed);
  expect((await presence()).files).toHaveLength(2);
  await expect(stage()).rejects.toThrow('archive digest differs');
  expect(await fs.readdir(target('alias'))).toEqual([]);
  expect(await fs.readdir(target('direct'))).toEqual([]);
  expect((await receiveCanonicalArchives({ project, members: [members[0]!] }, store, destinations, readers)).files).toHaveLength(1);
});

it('refuses a missing canonical release before staging any file', async () => {
  await fs.rename(path.join(store, 'consumer'), path.join(store, 'unrelated'));
  await expect(presence()).rejects.toThrow('has not been delivered');
  await expect(stage()).rejects.toThrow('has not been delivered');
  expect(await fs.readdir(target('alias'))).toEqual([]);
});

it('binds the exact admitted manifest bytes, the original producer and the consumer alias', async () => {
  await fs.appendFile(path.join(store, 'consumer', 'manifest.json'), '\n');
  await expect(stage()).rejects.toThrow('manifest digest differs');
  await fs.writeFile(path.join(store, 'consumer', 'manifest.json'), JSON.stringify(manifest, null, 2));
  const origin = { ...members[0]!.origin, frameworkCommit: 'f'.repeat(40) };
  await expect(receiveCanonicalArchives({ project, members: [{ ...members[0]!, origin }] }, store, destinations, readers)).rejects.toThrow('producer origin');
  expect(await fs.readdir(target('alias'))).toEqual([]);
});

it('refuses a replaced manifest even when the native reader returned the initially admitted content', async () => {
  const file = path.join(store, 'consumer', 'manifest.json');
  const changedReaders = { ...readers, readReleaseManifest(id: string, dir?: string) {
    const result = readReleaseManifest(id, dir);
    renameSync(file, file + '.previous'); writeFileSync(file, JSON.stringify(manifest, null, 2));
    return result;
  } };
  await expect(receiveCanonicalArchives({ project, members }, store, destinations, changedReaders)).rejects.toThrow('metadata changed');
  expect(await fs.readdir(target('alias'))).toEqual([]);
});

it.each(['published archive', 'canonical source'])('refuses a change to the %s at exclusive publication', async which => {
  const link = fs.link.bind(fs), destination = archive(target('alias'), 'alias'), source = archive(archiveDir, 'alias');
  let changed = false;
  vi.spyOn(fs, 'link').mockImplementation(async (temporary, file) => {
    await link(temporary, file);
    if (file !== destination) return;
    if (which === 'published archive') {
      const altered = Buffer.from(raw); altered[0] = altered[0]! ^ 1;
      await fs.writeFile(file, altered);
    } else {
      await fs.rename(source, source + '.previous'); await fs.writeFile(source, raw);
    }
    changed = true;
  });
  syncBuiltinESMExports();
  await expect(stage()).rejects.toThrow('Published canonical archive digest or identity differs');
  expect(changed).toBe(true);
  expect(await fs.readdir(target('alias'))).toEqual([]);
  expect(await fs.readdir(target('direct'))).toEqual([]);
});

it('rejects aliased sources, foreign destination paths and writable parents', async () => {
  const source = archive(archiveDir, 'alias');
  await fs.rename(source, source + '.real'); await fs.symlink(source + '.real', source);
  await expect(stage()).rejects.toThrow('physical service-owned');
  await fs.unlink(source); await fs.rename(source + '.real', source);
  await expect(receiveCanonicalArchives({ project, members: [{ ...members[0]!, directory: target('direct') }] }, store, destinations, readers)).rejects.toThrow('outside');
  await fs.chmod(path.dirname(target('alias')), 0o777);
  await expect(stage()).rejects.toThrow('trusted physical directory');
  expect(await fs.readdir(target('alias'))).toEqual([]);
});

it('builds compact commands from the checked artifact and resident execution binding', () => {
  const release = members[0]!.origin, artifact = { app: 'alias', version, release, size: raw.length, tarballSha256: hash(raw) };
  const owner: ApplicationRuntime = { root: '/runtime/packages/0', executable: '/runtime/node', commit: 'a'.repeat(40), target: manifest.builtWith.target!,
    execution: { mode: 'resident', protocol: 1, ownerId: 'fixture-owner', epoch: 1, pid: 123 } };
  expect(checkCanonicalArchivesCommand([artifact], owner, owner.root)).toContain("'/runtime/node'");
  expect(Buffer.byteLength(stageCanonicalArchivesCommand(project, [{ artifact, directory: target('alias') }], owner, owner.root))).toBeLessThan(24 * 1024);
  expect(() => checkCanonicalArchivesCommand([{ ...artifact, size: 1 }], owner, owner.root)).toThrow('checked application origin');
  expect(() => checkCanonicalArchivesCommand([artifact], { ...owner, root: '/symbolic/../runtime' }, owner.root)).toThrow('physical installed runtime');
});
