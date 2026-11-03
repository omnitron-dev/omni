import { constants } from 'node:fs';
import { open, opendir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ReleaseManifest } from './manifest.js';
import { projectOfId } from './store.js';
import type { InstalledArtifactObservation, InstalledReleaseCandidate, InstalledReleaseInspection } from '../shared/dto/installed-release.js';

export interface InstalledReleaseCatalog {
  complete: boolean;
  reasons: string[];
  releases: Array<{ manifest: ReleaseManifest; sha256: string }>;
}

export async function installedReadDeadline<T>(read: () => Promise<T>, timeout = 55_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Installed-file inspection timed out')), timeout); })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function boundedInstalledNodeRead(read: () => Promise<unknown>): Promise<InstalledArtifactObservation[]> {
  const value = await installedReadDeadline(read);
  const digest = (input: unknown): boolean => typeof input === 'string' && /^[a-f0-9]{64}$/.test(input);
  if (!Array.isArray(value) || value.length > 32 || value.some(item => !item || typeof item.app !== 'string' || item.app.length > 256 ||
    !['observed', 'unavailable', 'changed-during-inspection'].includes(item.state) || typeof item.observedAt !== 'string' ||
    !(item.entrySha256 === null || digest(item.entrySha256)) || !(item.frameworkCommit === null || typeof item.frameworkCommit === 'string' && /^[a-f0-9]{7,40}$/.test(item.frameworkCommit)) ||
    !Array.isArray(item.archives) || item.archives.length > 8 || item.archives.some((archive: InstalledArtifactObservation['archives'][number]) => !archive || !digest(archive.sha256) || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0 || !(archive.entrySha256 === null || digest(archive.entrySha256))) ||
    !Array.isArray(item.reasons) || item.reasons.length > 32 || item.reasons.some((reason: unknown) => typeof reason !== 'string' || reason.length > 1024))) throw new Error('Invalid inspection response');
  return value as InstalledArtifactObservation[];
}

export function installedNodeFailure(error: unknown): string {
  const value = error as { code?: unknown; message?: unknown } | null;
  if (value?.code === 'METHOD_NOT_FOUND' || value?.code === 404 || typeof value?.message === 'string' && /not a function|method.*(not found|does not exist|unknown)|unknown.*method/i.test(value.message)) return 'Node backend does not support installed-file inspection; update its backend. Applications were not changed';
  if (typeof value?.message === 'string' && /timed out/i.test(value.message)) return 'Node did not finish installed-file inspection within the time limit';
  return 'Node inspection is unavailable or busy; applications were not changed';
}

/** Only bounded manifest reads; neither audit rows nor directory names establish an installed release. */
export async function installedReleaseCatalog(root: string, project: string): Promise<InstalledReleaseCatalog> {
  const catalog: InstalledReleaseCatalog = { complete: true, reasons: [], releases: [] };
  try {
    let scanned = 0;
    for await (const directory of await opendir(root)) {
      if (++scanned > 2048) throw new Error('Release catalog exceeds the inspection limit');
      if (!directory.isDirectory() || projectOfId(directory.name) !== project) continue;
      const handle = await open(path.join(root, directory.name, 'manifest.json'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          catalog.complete = false;
          catalog.reasons.push(`Release ${directory.name} manifest is unreadable`);
        }
        return null;
      });
      // Incomplete build directories do not participate in the release catalog.
      if (!handle) continue;
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('Invalid release manifest');
        const bytes = await handle.readFile();
        const after = await handle.stat();
        if (stat.size !== after.size || stat.ctimeMs !== after.ctimeMs) throw new Error('Release manifest changed while being read');
        const manifest = JSON.parse(bytes.toString('utf8')) as ReleaseManifest;
        if (manifest.id !== directory.name || !Array.isArray(manifest.artifacts) || manifest.artifacts.length > 256 ||
          typeof manifest.omni?.commit !== 'string' || !/^[a-f0-9]{7,40}$/.test(manifest.omni.commit) ||
          manifest.artifacts.some(a => typeof a.app !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256) || !Number.isSafeInteger(a.bytes) || a.bytes <= 0)) throw new Error('Invalid release manifest');
        catalog.releases.push({ manifest, sha256: createHash('sha256').update(bytes).digest('hex') });
      } catch {
        catalog.complete = false;
        catalog.reasons.push(`Release ${directory.name} has an invalid or changing manifest`);
      } finally { await handle.close(); }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      catalog.complete = false;
      catalog.reasons.push('Release catalog could not be read completely within its inspection limits');
    }
  }
  return catalog;
}

/** Every hash-and-byte match is reported; a reused artifact cannot silently choose a release. */
export function installedReleaseCandidates(observation: InstalledArtifactObservation, catalog: InstalledReleaseCatalog): InstalledReleaseCandidate[] {
  if (observation.state !== 'observed') return [];
  const app = observation.app.split('/').at(-1);
  return catalog.releases.flatMap(({ manifest, sha256 }) => {
    const matches = manifest.artifacts.filter(artifact => artifact.app === app).flatMap(artifact => observation.archives.filter(archive => archive.sha256 === artifact.sha256 && archive.bytes === artifact.bytes));
    if (!matches.length) return [];
    const reasons: string[] = [];
    let modified = false;
    let incomplete = false;
    for (const match of matches) {
      if (!match.entrySha256 || !observation.entrySha256) {
        incomplete = true;
        reasons.push('Entry point could not be compared with the retained archive');
      } else if (match.entrySha256 !== observation.entrySha256) {
        modified = true;
        reasons.push('Installed entry point differs from the retained release archive');
      }
    }
    if (!observation.frameworkCommit) {
      incomplete = true;
      reasons.push('Installed framework build identity is unavailable');
    } else if (!manifest.omni.commit.startsWith(observation.frameworkCommit) && !observation.frameworkCommit.startsWith(manifest.omni.commit)) {
      modified = true;
      reasons.push(`Installed framework reports ${observation.frameworkCommit}; release records ${manifest.omni.commit}`);
    } else if ((manifest.omni.registry || manifest.omni.reproduced) && (observation.frameworkCommit.length !== 40 || observation.frameworkCommit !== manifest.omni.commit)) {
      incomplete = true;
      reasons.push('An archive-backed release requires the full framework commit for an exact comparison');
    }
    return [{ releaseId: manifest.id, manifestSha256: sha256, state: modified ? 'modified' as const : incomplete ? 'incomplete' as const : 'entry-matches' as const, reasons: [...new Set(reasons)] }];
  });
}

export function installedReleaseReport(project: string, stack: string, catalog: InstalledReleaseCatalog,
  nodes: Array<{ node: string; observations?: InstalledArtifactObservation[]; error?: string }>): InstalledReleaseInspection {
  return { project, stack, observedAt: new Date().toISOString(), catalogComplete: catalog.complete, catalogReasons: catalog.reasons,
    apps: nodes.flatMap(node => (node.observations ?? []).map(observation => ({ ...observation, node: node.node, candidates: installedReleaseCandidates(observation, catalog) }))),
    nodes: nodes.filter(node => node.error).map(node => ({ node: node.node, error: node.error! })),
    limitations: ['Installed files were inspected now; this does not prove what a running process loaded.',
      'Archive matches require SHA-256 and byte count. All matching catalog releases are shown; multiple matches are ambiguous.',
      'Only the entry point and reported framework build are compared. A matching entry is not a full installation integrity check.'] };
}
