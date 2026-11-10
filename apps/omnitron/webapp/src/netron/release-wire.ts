/**
 * Release data as the console receives it — normalised at the one door.
 *
 * The console and the daemon it talks to are not the same build. A remote
 * master runs whatever version it was installed with, and even this master
 * spends the seconds of every restart answering from the previous dist. The
 * release contract grew all day (`gateList`, `keptSource`, `machine`,
 * `verified`, `attestations`, the preflight's `load`), and a console built
 * against the newest shape crashed the whole Releases page — «Cannot read
 * properties of undefined (reading 'map')» — the moment it met a daemon that
 * had not been restarted since the field was added. Measured on this master.
 *
 * So every release response passes through here and every field added after
 * the first shipped contract gets an explicit «not reported» value. The
 * pages read the normalised shape and cannot trip over an absent field; a
 * daemon too old to report something shows as «not reported», never as a
 * blank page.
 */

import type {
  BuildRecord,
  ReleaseDeploymentDto,
  ReleaseDetail,
  ReleasePreflightDto,
  ReleaseSummary,
  StoredAttestation,
} from '@omnitron-dev/omnitron/dto/services';

import { deploymentsAnswer, readReleaseId, type DeploymentsAnswer } from '@omnitron-dev/omnitron/release-reading';

import { audit, releases } from './client';

const deploymentReads = new Map<number, Promise<DeploymentsAnswer>>();

/** A summary with every later field present — `null` / empty meaning «this daemon did not report it». */
export type ReleaseSummaryView = ReleaseSummary;

export interface ReleaseDetailView extends ReleaseSummaryView {
  readonly manifest: ReleaseDetail['manifest'];
  readonly manifestSha256: string | null;
  readonly artifactSources: NonNullable<ReleaseDetail['artifactSources']> | null;
  readonly logs: ReleaseDetail['logs'];
  readonly root: string;
  readonly attestations: readonly StoredAttestation[];
}

/** The machine reading is optional: an older daemon does not take one. */
export interface ReleasePreflightView extends Omit<ReleasePreflightDto, 'load' | 'cpus'> {
  readonly load: readonly [number, number, number] | null;
  readonly cpus: number | null;
}

function summary(r: Partial<ReleaseSummary> & { id: string }): ReleaseSummaryView {
  const fromId = readReleaseId(r.id);
  return {
    id: r.id,
    project: r.project ?? fromId.project,
    complete: r.complete ?? false,
    ...(r.manifestError && { manifestError: r.manifestError }),
    builtAt: r.builtAt ?? null,
    builtBy: r.builtBy ?? null,
    builtWith: r.builtWith ?? null,
    projectCommit: r.projectCommit ?? fromId.projectCommit,
    omniCommit: r.omniCommit ?? fromId.omniCommit,
    projectRepo: r.projectRepo ?? null,
    omniRepo: r.omniRepo ?? null,
    onRemote: { project: r.onRemote?.project ?? null, omni: r.onRemote?.omni ?? null },
    gates: r.gates ?? { total: 0, passed: 0, failed: 0, notRun: 0 },
    gateList: r.gateList ?? [],
    artifacts: r.artifacts ?? { count: 0, bytes: 0, apps: [], failed: [] },
    statics: r.statics ?? null,
    bytes: r.bytes ?? 0,
    keptSource: r.keptSource ?? false,
    machine: r.machine ?? null,
    verified: r.verified ?? [],
  };
}

function build(b: BuildRecord): BuildRecord {
  return {
    ...b,
    history: b.history ?? [],
    gates: b.gates ?? [],
    request: b.request ?? { project: '(unknown)' },
  };
}

/** The release service, with every answer normalised. Mutations pass through. */
export const releaseApi = {
  async list(): Promise<{ releases: ReleaseSummaryView[]; root: string }> {
    const answer = await releases.list();
    return { root: answer?.root ?? '', releases: (answer?.releases ?? []).map(summary) };
  },

  async get(id: string): Promise<ReleaseDetailView> {
    const d = await releases.get({ id });
    return {
      ...summary(d),
      manifest: d.manifest ?? null,
      manifestSha256: d.manifestSha256 ?? null,
      artifactSources: d.artifactSources ?? null,
      logs: d.logs ?? [],
      root: d.root ?? '',
      attestations: d.attestations ?? [],
    };
  },

  async builds(): Promise<BuildRecord[]> {
    return ((await releases.builds()) ?? []).map(build);
  },

  async preflight(): Promise<ReleasePreflightView> {
    const p = await releases.preflight();
    return {
      ...(p.publish === 1 ? { publish: 1 as const } : {}),
      ...(p.store && { store: p.store }),
      ...(p.buildSlots && { buildSlots: p.buildSlots }),
      ...(p.frameworkSource === 1 ? { frameworkSource: 1 as const } : {}),
      root: p.root,
      canBuild: p.canBuild,
      missingTools: p.missingTools ?? [],
      path: p.path ?? [],
      load: Array.isArray(p.load) && p.load.length === 3 ? p.load : null,
      cpus: typeof p.cpus === 'number' && p.cpus > 0 ? p.cpus : null,
    };
  },

  /** Shared in-flight read of audit history; this does not identify running artifacts. */
  async deployments(limit = 200): Promise<DeploymentsAnswer> {
    const pending = deploymentReads.get(limit);
    if (pending) return pending;
    const read = Promise.all([audit.available().catch(() => null), releases.deployments({ limit })]).then(([trail, rows]) => {
      const deployments: ReleaseDeploymentDto[] = (rows ?? []).map((d) => ({ ...d, releaseUnnamed: d.releaseUnnamed ?? false }));
      return deploymentsAnswer(trail?.available === true, deployments);
    }).finally(() => { if (deploymentReads.get(limit) === read) deploymentReads.delete(limit); });
    deploymentReads.set(limit, read);
    return read;
  },
};
