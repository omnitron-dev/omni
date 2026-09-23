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

import { deploymentsAnswer, type DeploymentsAnswer } from '@omnitron-dev/omnitron/release-reading';

import { audit, releases } from './client';

/** A summary with every later field present — `null` / empty meaning «this daemon did not report it». */
export type ReleaseSummaryView = ReleaseSummary;

export interface ReleaseDetailView extends ReleaseSummaryView {
  readonly manifest: ReleaseDetail['manifest'];
  readonly logs: ReleaseDetail['logs'];
  readonly root: string;
  readonly attestations: readonly StoredAttestation[];
}

/** The machine reading is optional: an older daemon does not take one. */
export interface ReleasePreflightView extends Omit<ReleasePreflightDto, 'load' | 'cpus'> {
  readonly load: readonly [number, number, number] | null;
  readonly cpus: number | null;
}

/**
 * The two commits a release id names: `<project>-<stamp>-<project8>-<omni8>`.
 *
 * An unfinished build has no manifest to read them from, but its id was made
 * from them — so a row can still say which commits it was building instead
 * of «— + —».
 */
function commitsFromId(id: string): { project: string | null; omni: string | null } {
  const m = /-\d{12}-([0-9a-f]{8})-([0-9a-f]{8})$/.exec(id);
  return { project: m?.[1] ?? null, omni: m?.[2] ?? null };
}

function summary(r: Partial<ReleaseSummary> & { id: string }): ReleaseSummaryView {
  const fromId = commitsFromId(r.id);
  return {
    id: r.id,
    project: r.project ?? r.id.replace(/-\d{12}-[0-9a-f]{8}-[0-9a-f]{8}$/, ''),
    complete: r.complete ?? false,
    builtAt: r.builtAt ?? null,
    builtBy: r.builtBy ?? null,
    builtWith: r.builtWith ?? null,
    projectCommit: r.projectCommit ?? fromId.project,
    omniCommit: r.omniCommit ?? fromId.omni,
    projectRepo: r.projectRepo ?? null,
    omniRepo: r.omniRepo ?? null,
    onRemote: r.onRemote ?? { project: null, omni: null },
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
      root: p.root,
      canBuild: p.canBuild,
      missingTools: p.missingTools ?? [],
      path: p.path ?? [],
      load: Array.isArray(p.load) && p.load.length === 3 ? p.load : null,
      cpus: typeof p.cpus === 'number' && p.cpus > 0 ? p.cpus : null,
    };
  },

  /**
   * Which release each stack runs, or why this daemon cannot say. The
   * answer is its `stack.start` audit rows, and a daemon without its audit
   * trail serves them as `[]` — the shape of «no stack has taken a release».
   * The CLI asks the trail first (70b988a6); so does this.
   */
  async deployments(limit = 200): Promise<DeploymentsAnswer> {
    const [trail, rows] = await Promise.all([audit.available().catch(() => null), releases.deployments({ limit })]);
    const deployments: ReleaseDeploymentDto[] = (rows ?? []).map((d) => ({ ...d, releaseUnnamed: d.releaseUnnamed ?? false }));
    return deploymentsAnswer(trail?.available === true, deployments);
  },
};
