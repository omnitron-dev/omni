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
import type { PruneResult, ReleaseDetail, ReleaseSummary } from '../release/store.js';
import { ADMIN_ROLES, OPERATOR_ROLES, VIEWER_ROLES } from '../shared/roles.js';
import type { AuditService } from './audit.service.js';
import type { BuildRecord, ReleaseService } from './release.service.js';
import type { IOmnitronReleaseService, ReleaseDeploymentDto, ReleasePreflightDto } from '../shared/dto/services.js';

/** The most builds or rows one call may ask for. */
const MAX_DEPLOYMENTS = 200;

@Service({ name: 'OmnitronRelease' })
export class ReleaseRpcService implements IOmnitronReleaseService {
  constructor(
    private readonly releases: ReleaseService,
    private readonly audit?: AuditService | undefined,
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
    return {
      root: this.releases.root(),
      canBuild: missing.length === 0,
      missingTools: missing,
      path: (env['PATH'] ?? '').split(':').filter(Boolean),
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
   * Remove all but the newest `keep`.
   *
   * `apply` is what deletes; without it this answers what WOULD go, which is
   * what the console shows before asking. `protect` keeps named releases
   * whatever their age — the console passes the ones its stacks are running.
   */
  @Public({ auth: { roles: ADMIN_ROLES } })
  async prune(data: { keep?: number; apply?: boolean; protect?: string[] }): Promise<PruneResult> {
    const result = this.releases.prune({
      ...(data?.keep !== undefined ? { keep: data.keep } : {}),
      ...(data?.apply ? { apply: true } : {}),
      ...(data?.protect ? { protect: data.protect } : {}),
    });
    if (data?.apply && result.removed.length > 0) {
      await this.audit?.record({
        action: 'release.prune',
        resourceType: 'release',
        resourceId: null,
        details: { removed: result.removed.join(','), kept: result.kept, megabytes: Math.round(result.freedBytes / 1024 / 1024) },
      });
    }
    return result;
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
  async deployments(data?: { limit?: number }): Promise<ReleaseDeploymentDto[]> {
    if (!this.audit) return [];
    const limit = Math.min(MAX_DEPLOYMENTS, Math.max(1, Math.floor(data?.limit ?? MAX_DEPLOYMENTS)));
    const rows = await this.audit.list({ action: 'stack.start', limit });
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
