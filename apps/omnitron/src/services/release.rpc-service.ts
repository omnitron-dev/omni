/**
 * Release RPC Service — what the console can ask about releases.
 *
 * Master-only, like the builds themselves: a release is built from two
 * checkouts, and only the master has both. A slave exposes nothing here
 * rather than exposing methods that would refuse.
 *
 * The split of roles follows what each call DOES. Reading what was built is
 * a viewer's business; starting or stopping a fifteen-minute build that will
 * be deployed is an operator's; deleting one is an administrator's, because
 * it is the only call that destroys evidence.
 */

import { Service, Public } from '@omnitron-dev/titan/decorators';

import { buildEnv, missingTools } from '../release/build-run.js';
import type { ReleaseDetail, ReleaseSummary } from '../release/store.js';
import { ADMIN_ROLES, OPERATOR_ROLES, VIEWER_ROLES } from '../shared/roles.js';
import type { AuditService } from './audit.service.js';
import type { BuildRecord, ReleaseService } from './release.service.js';
import type { IOmnitronReleaseService, ReleaseDeploymentDto, ReleasePreflightDto, ReleasePruneAnswer } from '../shared/dto/services.js';

/** The most builds or rows one call may ask for. */
const MAX_DEPLOYMENTS = 200;

@Service({ name: 'OmnitronRelease' })
export class ReleaseRpcService implements IOmnitronReleaseService {
  constructor(
    private readonly releases: ReleaseService,
    private readonly audit?: AuditService | undefined,
    /** The transport to a stack's node, for attestations run there. */
    private readonly projects?: import('./project.service.js').ProjectService | undefined,
  ) {}

  /**
   * Whether this master can build at all, before anyone presses Build.
   *
   * A daemon started by launchd has the system PATH, and `pnpm` is not on
   * it. Answering that here turns a fifteen-minute failure into a disabled
   * button with a reason on it.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async preflight(): Promise<ReleasePreflightDto> {
    // The PATH a build would actually run with, not the daemon's own: the
    // two differ, and answering from the daemon's would disable the button
    // over a tool the build would have found.
    const env = buildEnv(process.env);
    const missing = missingTools(env);
    const os = await import('node:os');
    return {
      root: this.releases.root(),
      canBuild: missing.length === 0,
      missingTools: missing,
      path: (env['PATH'] ?? '').split(':').filter(Boolean),
      // Read BEFORE anyone presses Build. Tonight three builds of one commit
      // went red three different ways on a machine at load 38-56 on 16 cores,
      // and each cost a quarter of an hour to find out. The console shows
      // this beside the button; it refuses nothing — the operator may know
      // the load is about to drop.
      load: os.loadavg() as [number, number, number],
      cpus: os.cpus().length,
    };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async list(): Promise<{ releases: ReleaseSummary[]; root: string }> {
    return { releases: this.releases.list(), root: this.releases.root() };
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async get(data: { id: string }): Promise<ReleaseDetail> {
    return this.releases.get(data.id);
  }

  /**
   * The tail of one of a build's logs.
   *
   * Operator, not viewer: these are the raw outputs of installs and gates,
   * and a project's test output is not something a read-only console account
   * is given by default.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async getLog(data: { id: string; name: string; lines?: number }): Promise<{ name: string; bytes: number; tail: string }> {
    return this.releases.log(data.id, data.name, data.lines);
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async builds(): Promise<BuildRecord[]> {
    return this.releases.builds();
  }

  @Public({ auth: { roles: VIEWER_ROLES } })
  async getBuild(data: { buildId: string }): Promise<BuildRecord | null> {
    return this.releases.build(data.buildId);
  }

  /**
   * Start a build. Returns as soon as it has started, with the id to watch.
   *
   * `env` carries what the gates need and the daemon does not have — daos's
   * want `TEST_DATABASE__PORT`. The names are checked and the values never
   * recorded: the audit row keeps the keys, which is what an operator needs
   * to see when a gate fails for want of one.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async build(data: {
    project: string;
    projectCommit?: string;
    omniCommit?: string;
    forStack?: string;
    skipGates?: boolean;
    keepSource?: boolean;
    env?: Record<string, string>;
  }): Promise<BuildRecord> {
    if (!data?.project || typeof data.project !== 'string') throw new Error('A build needs a project name');
    const { currentActor } = await import('./audit.service.js');
    const actor = currentActor();
    const record = this.releases.start(data, actor.actorId);
    await this.audit?.record({
      action: 'release.build',
      resourceType: 'release',
      resourceId: record.buildId,
      details: {
        project: data.project,
        ...(data.projectCommit ? { projectCommit: data.projectCommit } : {}),
        ...(data.omniCommit ? { omniCommit: data.omniCommit } : {}),
        ...(data.forStack ? { forStack: data.forStack } : {}),
        ...(data.skipGates ? { skipGates: true } : {}),
        envKeys: Object.keys(data.env ?? {}).sort().join(',') || '(none)',
      },
    });
    return record;
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async stopBuild(data: { buildId: string }): Promise<BuildRecord> {
    const record = this.releases.stop(data.buildId);
    await this.audit?.record({
      action: 'release.stop',
      resourceType: 'release',
      resourceId: data.buildId,
      details: { project: record.request.project, release: record.releaseId ?? '(not yet named)', percent: record.percent },
    });
    return record;
  }

  /**
   * Remove all but the newest `keep`, and never a release a stack runs.
   *
   * `apply` is what deletes; without it this answers what WOULD go, which is
   * what the console shows before asking.
   *
   * Which releases the stacks run is decided HERE, from this daemon's own
   * audit trail (`deploymentProtection`). It used to be whatever the caller
   * sent as `protect`: the console built that list from `deployments()`,
   * which answers `[]` on a daemon with no audit trail — so the console sent
   * `protect: []` and its second click removed the release a stack was
   * running; a direct call with admin rights and no `protect` did the same.
   * `protect` from the caller now only ADDS to the daemon's list. When the
   * daemon cannot know — no trail, or a stack that took a release whose name
   * was not recorded — `apply` is refused unless the caller says, with
   * `allowUnprotected`, that it accepts removing without knowing.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async prune(data: {
    keep?: number;
    apply?: boolean;
    protect?: string[];
    allowUnprotected?: boolean;
  }): Promise<ReleasePruneAnswer> {
    const known = await this.deploymentProtection();
    if (data?.apply && known.unknown && data.allowUnprotected !== true) {
      throw new Error(
        `Refusing to remove releases: ${known.unknown}. Pass allowUnprotected to remove them without knowing which a stack runs.`,
      );
    }
    const protect = [...new Set([...known.protect, ...(data?.protect ?? [])])];
    const result = this.releases.prune({
      ...(data?.keep !== undefined ? { keep: data.keep } : {}),
      ...(data?.apply ? { apply: true } : {}),
      protect,
    });
    if (data?.apply && result.removed.length > 0) {
      await this.audit?.record({
        action: 'release.prune',
        resourceType: 'release',
        resourceId: null,
        details: { removed: result.removed.join(','), kept: result.kept, megabytes: Math.round(result.freedBytes / 1024 / 1024) },
      });
    }
    return { ...result, protectedByDeployment: known.protect, unknown: known.unknown };
  }

  /**
   * The releases the stacks run, by this daemon's own trail — and, when it
   * cannot say, why not.
   */
  private async deploymentProtection(): Promise<{ protect: string[]; unknown: string | null }> {
    if (!this.audit?.available) {
      return { protect: [], unknown: 'this daemon has no audit trail, so it cannot say which releases the stacks run' };
    }
    const protect: string[] = [];
    const unnamed: string[] = [];
    for (const d of await this.deployments()) {
      if (d.release) protect.push(d.release);
      else if (d.releaseUnnamed) unnamed.push(`${d.project}/${d.stack}`);
    }
    return {
      protect,
      unknown: unnamed.length > 0 ? `${unnamed.join(', ')} took a release whose name was not recorded` : null,
    };
  }

  /**
   * Take an attestation a stack produced about this release.
   *
   * The caller hands over what the producer printed, whole; this side
   * decides whether to keep it (`release/attest.ts`), and refuses in four
   * named ways. The one refusal that needs this layer is freshness: «older
   * than the deployment it claims to be about» can only be checked against
   * the audit trail, which is here and not in the file that does the rest.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async attest(data: { release: string; stack: string; stdout: string }): Promise<import('../shared/dto/services.js').AttestStored> {
    if (!data?.release || !data?.stack || typeof data.stdout !== 'string') {
      throw new Error('An attestation needs a release, a stack, and what the producer printed');
    }
    const { storeAttestation } = await import('../release/attest.js');
    const deployedAt = await this.lastDeployedAt(data.release, data.stack);
    const stored = await storeAttestation(data.release, data.stack, data.stdout, {
      ...(deployedAt ? { deployedAt } : {}),
    });
    const passed = stored.attestation.gates.filter((g) => g.status === 'passed').length;
    await this.audit?.record({
      action: 'release.attest',
      resourceType: 'release',
      resourceId: data.release,
      details: {
        stack: data.stack,
        probes: stored.attestation.gates.length,
        passed,
        at: stored.attestation.at,
        onNode: stored.attestation.onNode.matched === null ? 'unconfirmed' : String(stored.attestation.onNode.matched),
      },
    });
    return {
      path: stored.path,
      gates: stored.attestation.gates.length,
      passed,
      ...(stored.attestation.cleanup ? { cleanup: stored.attestation.cleanup } : {}),
      ...(stored.attestation.legalTextsUnread ? { legalTextsUnread: stored.attestation.legalTextsUnread } : {}),
    };
  }

  /**
   * Run this release's probes on the node of the stack carrying it, and keep
   * the result if it is one to keep.
   *
   * Exit 0 and exit 1 are both stored — a probe that refused is a fact about
   * the release on that stack, and dropping it would let the next run look
   * like the first. Exit 2 is the producer failing to measure anything, and
   * its own words are the refusal. The four refusals of the door itself
   * (`release/attest.ts`) apply on top, freshness included.
   *
   * Long by nature — an upload and a probe suite over SSH — and the console
   * reaches the daemon through a gateway that cuts a request at 120 s, so the
   * console calls this with a deadline and says so while it waits.
   */
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async attestOnNode(data: { release: string; stack: string }): Promise<import('../shared/dto/services.js').AttestStored & {
    node: string;
    scriptsFrom: 'release' | 'history';
    sourceFiles: number;
    accounts: 'provisioned' | 'not-declared' | 'producer-cannot';
  }> {
    if (!data?.release || !data?.stack) throw new Error('An attestation needs a release and a stack');
    if (!this.projects) throw new Error('This daemon has no project service to reach a node with');
    const { projectOfId } = await import('../release/store.js');
    const { interpretRun } = await import('../release/attest-on-node.js');
    const run = await this.projects.attestOnNode(projectOfId(data.release), data.stack, data.release);
    const verdict = interpretRun(run);
    if (!verdict.keep) throw new Error(`Nothing stored for ${data.release} on ${data.stack} (${run.node}): ${verdict.because}`);
    const stored = await this.attest({ release: data.release, stack: data.stack, stdout: verdict.stdout });
    return { ...stored, node: run.node, scriptsFrom: run.scriptsFrom, sourceFiles: run.sourceFiles, accounts: run.accounts };
  }

  /** When this stack last took this exact release, from the trail. */
  private async lastDeployedAt(release: string, stack: string): Promise<string | null> {
    if (!this.audit) return null;
    const rows = await this.audit.list({ action: 'stack.start', limit: MAX_DEPLOYMENTS });
    for (const row of rows) {
      if (!row.resourceId?.endsWith(`/${stack}`)) continue;
      if ((row.details ?? {})['release'] !== release) continue;
      return row.createdAt;
    }
    return null;
  }

  /**
   * What each stack was last started with, from the audit trail.
   *
   * The running state lives in memory and a daemon restart empties it; the
   * `stack.start` rows do not. So «which release is test running» is
   * answered by the last recorded deployment of it, and the console says
   * exactly that rather than implying it read the node.
   */
  @Public({ auth: { roles: VIEWER_ROLES } })
  async deployments(_data?: { limit?: number }): Promise<ReleaseDeploymentDto[]> {
    if (!this.audit) return [];
    // The newest `stack.start` of EVERY stack, however long ago — not the
    // newest 200 rows (see `AuditService.latestPerResource`). `limit` is
    // kept for callers that still send it; one row per stack needs none.
    const rows = await this.audit.latestPerResource('stack.start');
    const latest = new Map<string, ReleaseDeploymentDto>();
    for (const row of rows) {
      const details = row.details ?? {};
      // `project` and `stack` are NOT in `details` — measured on the live
      // trail, where every `stack.start` row carries them only in
      // `resourceId`, as `<project>/<stack>`. Reading a key the writer never
      // writes made this method answer «nothing has ever been deployed» for
      // a stack that had been deployed forty minutes earlier.
      const slash = (row.resourceId ?? '').indexOf('/');
      const project = slash > 0 ? row.resourceId!.slice(0, slash) : null;
      const stack = slash > 0 ? row.resourceId!.slice(slash + 1) : null;
      if (!project || !stack) continue;
      const key = `${project}/${stack}`;
      // Rows are newest first: the first one seen for a stack is its latest.
      if (latest.has(key)) continue;
      latest.set(key, {
        project,
        stack,
        at: row.createdAt,
        actorId: row.actorId,
        source: typeof details['source'] === 'string' ? details['source'] : null,
        // Rows written before the audit trail learned to flatten this field
        // hold the literal `[object]` — `scrubDetails` replaces a nested
        // object with that word. It is not an id, and showing it as one
        // would put a release on the screen that does not exist.
        release: typeof details['release'] === 'string' && details['release'] !== '[object]' ? details['release'] : null,
        releaseUnnamed: details['release'] === '[object]',
        projectCommit: typeof details['releaseProjectCommit'] === 'string' ? details['releaseProjectCommit'] : null,
        omniCommit: typeof details['releaseOmniCommit'] === 'string' ? details['releaseOmniCommit'] : null,
      });
    }
    return [...latest.values()];
  }
}
