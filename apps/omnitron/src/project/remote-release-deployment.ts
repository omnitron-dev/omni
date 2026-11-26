import type { ReleaseManifest } from '../release/manifest.js';
import { changedImportedMigrations, changedReleasedMigrations, releaseMigrationSources } from '../release/migrations.js';
import type { IStackInfo, RemoteDeploymentPhase, RemoteReleaseDeployment, SelectedRelease } from '../shared/dto/project.js';
import { readStackRelease, readStackStart } from '../shared/release-reading.js';

/** Only immutable identities and native operation receipts belong in the controller journal. */
export interface RemoteDeploymentOperation {
  review: RemoteReleaseDeployment;
  priorSelection: string;
  priorStop: string | null;
  phase: RemoteDeploymentPhase | 'confirmed';
  stopId?: string;
  selectionDigest?: string;
}

/** Older archives may omit the inventory. Both immutable Git checkouts are already required for placement. */
type ReleaseSource = { manifest: ReleaseManifest; root: string };
async function migrations(source: ReleaseSource) {
  return source.manifest.migrations ?? (await releaseMigrationSources(source.root, source.manifest.project.commit, [])).migrations;
}

export async function verifyDeploymentMigrations(previous: ReleaseSource, next: ReleaseSource, apps: string[]): Promise<void> {
  const [before, after] = await Promise.all([migrations(previous), migrations(next)]);
  const forward = [...changedReleasedMigrations(before, after), ...changedImportedMigrations(previous.manifest, next.manifest, apps)];
  if (forward.length) throw Error('The candidate changes existing migration history: ' + forward.slice(0, 5).join(', '));
  const reverse = [...changedReleasedMigrations(after, before), ...changedImportedMigrations(next.manifest, previous.manifest, apps)];
  if (reverse.length) throw Error('The return release cannot preserve candidate migration history: ' + reverse.slice(0, 5).join(', '));
}

export function confirmsRelease(info: IStackInfo, selection: SelectedRelease): boolean {
  const { runningRelease, releaseEvidence } = readStackRelease(info);
  const [actual] = releaseEvidence.releases;
  return info.apps.length > 0 && readStackStart(info).confirmed && runningRelease === 'confirmed' &&
    releaseEvidence.releases.length === 1 && actual?.releaseId === selection.id && actual.manifestSha256 === selection.manifestSha256;
}

/** A missing app can be recovered only when the pinned owner accounted for every remaining process. */
export function accountsForPartialStart(info: IStackInfo, selection: SelectedRelease, nodeKey: string): boolean {
  const [node] = info.placements ?? [];
  if (info.placements?.length !== 1 || node?.nodeKey !== nodeKey || !node.appsObserved || !node.apps.length) return false;
  if (node.apps.some(app => !app.expected)) return false;
  const active = node.apps.filter(({ process }) => process &&
    !(['stopped', 'errored', 'crashed'].includes(process.status) && process.pid === null &&
      !process.processes?.some(child => child.pid !== null || !['stopped', 'errored', 'crashed'].includes(child.status))));
  if (!active.length) return true;
  if (active.some(app => app.process?.status !== 'online')) return false;
  const { runningRelease, releaseEvidence } = readStackRelease({ ...info, placements: [{ ...node, apps: active }] });
  return runningRelease === 'confirmed' && releaseEvidence.verified === active.length &&
    releaseEvidence.releases.length === 1 && releaseEvidence.releases[0]?.releaseId === selection.id &&
    releaseEvidence.releases[0].manifestSha256 === selection.manifestSha256;
}
