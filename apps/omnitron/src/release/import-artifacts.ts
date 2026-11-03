import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IEcosystemAppEntry } from '../config/types.js';
import { assertReleaseId, loadRelease, releasesRoot } from './load.js';
import { decideStackRelease, type ReleaseArtifact, type ReleaseManifestImport } from './manifest.js';
import { artifactReleaseContext, assertImportableArtifact, assertReleaseArtifactReference } from './origin.js';
import { sha256File } from './portable-archive.js';

/** Materialize exact admitted producer archives in the normal release directory.
 * No extraction, rebuilding, dependency installation or producer application code executes. */
export async function importReleaseArtifacts(entries: readonly IEcosystemAppEntry[], destination: string, store = releasesRoot()): Promise<{
  artifacts: ReleaseArtifact[]; imports: ReleaseManifestImport[];
}> {
  const artifacts: ReleaseArtifact[] = [], imports = new Map<string, ReleaseManifestImport>(), names = new Set<string>();
  const directory = await fs.realpath(destination);
  if (directory !== path.resolve(destination) || !(await fs.lstat(directory)).isDirectory()) throw Error('Release artifacts need a physical destination');
  for (const entry of entries) {
    if (entry.enabled === false) continue;
    assertReleaseId(entry.name);
    if (names.has(entry.name)) throw Error('Duplicate imported application: ' + entry.name);
    names.add(entry.name);
    assertReleaseArtifactReference(entry.releaseFrom);
    const ref = entry.releaseFrom;
    if (entry.bootstrap || entry.script || entry.releaseRoot || entry.releaseEntry || (entry.watch !== undefined && entry.watch !== false))
      throw Error('An imported application cannot override its release entry, boundary or watcher: ' + entry.name);
    const source = await loadRelease(ref.release, store);
    if (source.manifestSha256 !== ref.manifestSha256) throw Error('Producer manifest differs from the pinned release: ' + ref.release);
    const decision = decideStackRelease(source.manifest, undefined, [ref.app]);
    if (decision.action === 'refuse') throw Error('Cannot import ' + ref.release + '/' + ref.app + ': ' + decision.because);
    const producer = artifactReleaseContext(source.manifest, ref.app);
    assertImportableArtifact(producer.manifest, producer.artifact);
    const artifact = source.manifest.artifacts.find(item => item.app === ref.app)!;
    const file = source.files.find(item => item.app === ref.app)!;
    // Preserve the producer's bytes exactly; JSON serialization would change its admitted digest.
    const manifestJson = await fs.readFile(path.join(source.root, 'manifest.json'), 'utf8');
    if (createHash('sha256').update(manifestJson).digest('hex') !== ref.manifestSha256)
      throw Error('Producer manifest changed during import: ' + ref.release);
    if (Buffer.byteLength(manifestJson) > 4_194_304) throw Error('Producer manifest exceeds the import evidence limit');
    const temporary = await fs.mkdtemp(path.join(directory, '.import-'));
    try {
      const staged = path.join(temporary, 'artifact');
      await fs.copyFile(file.path, staged, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
      if ((await fs.stat(staged)).size !== artifact.bytes || await sha256File(staged) !== artifact.sha256)
        throw Error('Producer archive changed during import: ' + ref.app);
      // link is atomic and refuses an existing destination; rename could overwrite a local artifact.
      await fs.link(staged, path.join(directory, entry.name + '-' + artifact.version + '.tar.gz'));
    } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    artifacts.push({ ...artifact, app: entry.name, origin: { ...ref } });
    imports.set(ref.manifestSha256, { sha256: ref.manifestSha256, manifestJson });
  }
  return { artifacts, imports: [...imports.values()] };
}
