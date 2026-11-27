import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { loadRelease, type LoadedRelease } from '../release/load.js';
import { verifyRemoteSourceTree } from '../release/remote-source.js';
import type { RecoveryReleaseStore, RecoveryReleaseStores, RuntimeStackScope } from '../shared/dto/project.js';
import { readRecoveryQualificationProbe, readRecoveryQualificationRelease } from '../services/recovery-qualification.js';
import { verifyPostWriteRecoveryMigrations } from './remote-release-deployment.js';

type Source = { release: LoadedRelease; root: string };

/** Both issuance-time rehearsal and live deployment reconstruct the same content-bound request. */
export async function recoveryQualificationInputs(scope: RuntimeStackScope, nodeId: string, root: string, probeCommit: string,
  incumbent: Source, candidate: Source, recovery: Source) {
  if (!/^[a-f0-9]{40}$/.test(probeCommit)) throw Error('An exact qualification probe commit is required');
  const migrations = (s: Source) => ({ root: s.root, manifest: s.release.manifest });
  const addedMigrations = await verifyPostWriteRecoveryMigrations(migrations(incumbent), migrations(candidate),
    migrations(recovery), candidate.release.files.map(file => file.app), root);
  const read = (s: Source) => readRecoveryQualificationRelease(s.release, s.root);
  const [probe, previous, next, fallback] = await Promise.all([
    readRecoveryQualificationProbe(root, candidate.release.manifest.project.commit, probeCommit),
    read(incumbent), read(candidate), read(recovery),
  ]);
  return { ...scope, nodeId, incumbent: previous, candidate: next, recovery: fallback, probe, addedMigrations };
}

export async function loadIssuedRecoverySources(stores: RecoveryReleaseStores, registeredRoot: string,
  selected: { release: string; manifestSha256: string }, candidate: string, recovery: string): Promise<[Source, Source, Source]> {
  if (!stores || Object.keys(stores).sort().join(',') !== 'candidate,incumbent,recovery' ||
      stores.incumbent?.manifestSha256 !== selected.manifestSha256 ||
      new Set([selected.release, candidate, recovery]).size !== 3)
    throw Error('Three distinct issued releases including the selected manifest are required');
  async function read(id: string, input: RecoveryReleaseStore) {
    if (!input || Object.keys(input).sort().join(',') !== 'manifestSha256,sourceRoot,storeRoot' ||
        typeof input.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.manifestSha256) ||
        ![input.storeRoot, input.sourceRoot].every(dir => typeof dir === 'string' && path.isAbsolute(dir)) ||
        await realpath(input.storeRoot) !== input.storeRoot || await realpath(input.sourceRoot) !== input.sourceRoot)
      throw Error('An exact manifest digest, physical release store and physical source checkout are required');
    const release = await loadRelease(id, input.storeRoot);
    if (release.manifestSha256 !== input.manifestSha256) throw Error('The issued release manifest changed: ' + id);
    await verifyRemoteSourceTree(input.sourceRoot, registeredRoot, release.manifest.project.commit, release.manifest.project.directory);
    return { release, root: input.sourceRoot };
  }
  return [await read(selected.release, stores.incumbent), await read(candidate, stores.candidate), await read(recovery, stores.recovery)];
}
