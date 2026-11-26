import path from 'node:path';
import type { ReleaseManifest } from '../release/manifest.js';
import { importedMigrationDifferences, changedReleasedMigrations, releaseMigrationSources } from '../release/migrations.js';
import type { IStackInfo, ReleaseMigrationHistory, RemoteDeploymentPhase, RemoteReleaseDeployment, SelectedRelease } from '../shared/dto/project.js';
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

type ReleaseSource = { manifest: ReleaseManifest; root: string };

/** Use the same Git inputs as the builder. A present but incomplete inventory cannot authorize a return. */
async function migrations(source: ReleaseSource) {
  const { manifest } = source;
  const packages = manifest.artifacts.flatMap(artifact => artifact.packageSource && !artifact.origin
    ? [path.posix.relative(manifest.project.directory ?? '.', artifact.packageSource.directory) || '.'] : []);
  const observed = (await releaseMigrationSources(source.root, manifest.project.commit, packages)).migrations;
  if (manifest.migrations) {
    const differences = [...changedReleasedMigrations(observed, manifest.migrations), ...changedReleasedMigrations(manifest.migrations, observed)];
    if (differences.length) throw new DeploymentMigrationRefusal('provenance-unavailable', differences,
      'The release migration inventory differs from its exact Git source');
  }
  return observed;
}

export class DeploymentMigrationRefusal extends Error {
  readonly history: ReleaseMigrationHistory;
  constructor(kind: ReleaseMigrationHistory['kind'], entries: string[], message: string) {
    const distinct = [...new Set(entries)].sort();
    super(message + ': ' + distinct.slice(0, 5).join(', '));
    this.history = { kind, total: distinct.length, entries: distinct.slice(0, 20) };
  }
}

/** A working-tree placement has no immutable producer archive. Its Git objects can only attest this workspace. */
export async function verifyRegisteredDeploymentMigrations(registered: { root: string; commit: string | null },
  release: ReleaseSource, apps: string[], returning: boolean): Promise<void> {
  if (!registered.commit) throw new DeploymentMigrationRefusal('provenance-unavailable', ['registered source'],
    'An exact clean registered source is required to compare migration history');
  const external = release.manifest.artifacts.filter(a => a.origin && apps.includes(a.app));
  if (external.length) {
    throw new DeploymentMigrationRefusal('provenance-unavailable', external.map(a => a.app),
      'The registered working tree has no immutable producer migration history. Select its exact immutable release');
  }
  // A raw registration has no package manifest proving which workspace packages its applications used.
  // Cover every conventionally named migration in both workspaces, including removed packages outside apps/.
  const [registeredFiles, releaseFiles] = await Promise.all([
    releaseMigrationSources(registered.root, registered.commit, [], [], 'whole-workspace'),
    releaseMigrationSources(release.root, release.manifest.project.commit, [], [], 'whole-workspace'),
  ]);
  if (release.manifest.migrations) await migrations(release);
  const before = returning ? releaseFiles : registeredFiles, after = returning ? registeredFiles : releaseFiles;
  compareWorkspaceHistory(before.migrations, after.migrations);
}

function compareWorkspaceHistory(before: Record<string, string>, after: Record<string, string>,
  imported: string[] = [], returned: string[] = []): void {
  const forward = [...changedReleasedMigrations(before, after), ...imported];
  if (forward.length) throw new DeploymentMigrationRefusal('existing-history-changed', forward, 'The candidate changes existing migration history');
  const reverse = [...changedReleasedMigrations(after, before), ...returned];
  if (reverse.length) throw new DeploymentMigrationRefusal('added-migrations', reverse, 'The return release cannot preserve candidate migration history');
}

export async function verifyDeploymentMigrations(previous: ReleaseSource, next: ReleaseSource, apps: string[]): Promise<void> {
  const [before, after] = await Promise.all([migrations(previous), migrations(next)]);
  const imports = importedMigrationDifferences(previous.manifest, next.manifest, apps);
  const returns = importedMigrationDifferences(next.manifest, previous.manifest, apps);
  const unknown = [...imports, ...returns].filter(change => change.kind === 'provenance').map(change => change.detail);
  if (unknown.length) throw new DeploymentMigrationRefusal('provenance-unavailable', unknown, 'Migration producer history cannot be proved');
  compareWorkspaceHistory(before, after, imports.map(change => change.detail), returns.map(change => change.detail));
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
