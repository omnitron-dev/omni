import path from 'node:path';
import type { IEcosystemAppEntry, IEcosystemConfig, RuntimeReleaseEvidence } from '../config/types.js';
import { topologyRevision } from '../project/topology-plan.js';
import type { InstalledAppBinding } from '../shared/dto/stack-execution.js';

/** Bind the entry (including environment) and the launch policy without exporting either to the controller. */
export function installedEntryRevision(entry: IEcosystemAppEntry, config: IEcosystemConfig | null | undefined, ownerCwd: string): string {
  return topologyRevision([entry, config?.supervision, config?.monitoring?.healthCheck, ownerCwd]);
}

export function installedExecutable(entry: IEcosystemAppEntry, ownerCwd: string): string {
  return entry.bootstrap ? path.resolve(entry.cwd ?? ownerCwd, entry.bootstrap)
    : path.resolve(ownerCwd, entry.cwd ?? '.', entry.script!);
}

function installedBinding(release: RuntimeReleaseEvidence, entrySha256: string): InstalledAppBinding {
  if (release.state !== 'confirmed') throw new Error(`Installed release cannot be started: ${release.reason}`);
  if (!release.treeSha256) throw new Error('Installed release has no verified content digest from its launch');
  return { entrySha256, treeSha256: release.treeSha256, releaseId: release.releaseId, manifestSha256: release.manifestSha256, artifactSha256: release.artifactSha256 };
}

export function requireInstalledBinding(actual: RuntimeReleaseEvidence, entrySha256: string, expected?: InstalledAppBinding): InstalledAppBinding {
  const observed = installedBinding(actual, entrySha256);
  if (expected && topologyRevision(observed) !== topologyRevision(expected)) {
    throw new Error('Installed entry or release changed since its verified launch');
  }
  return observed;
}
