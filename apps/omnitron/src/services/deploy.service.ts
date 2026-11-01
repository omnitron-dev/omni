/**
 * Compatibility reader for the historical per-application deployment table.
 *
 * The former mutation path restarted the current configuration and labelled it
 * with an arbitrary version. It could neither select an artifact nor roll back.
 * Stack release deployment is the supported executor; keep old records readable
 * without allowing legacy clients to turn an unsupported operation into downtime.
 */
import type { Kysely } from 'kysely';
import { Injectable, Inject } from '@omnitron-dev/titan/decorators';
import { OMNITRON_DB_TOKEN } from '../shared/tokens.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { DeployResult, DeploymentRecord } from '../shared/dto/deploy.js';
export type { DeployResult, DeploymentRecord } from '../shared/dto/deploy.js';

export type DeployStrategy = 'rolling' | 'all-at-once' | 'blue-green' | 'canary';
export interface DeployRequest {
  app: string;
  version: string;
  strategy?: DeployStrategy | undefined;
  deployedBy?: string | undefined;
}

@Injectable()
export class DeployService {
  constructor(@Inject(OMNITRON_DB_TOKEN) private readonly db: Kysely<OmnitronDatabase>) {}

  /** No per-application artifact executor is registered. */
  async listDeployableApps(): Promise<string[]> { return []; }

  /** Refuse before database writes, module loading or application lifecycle calls. */
  async deploy(_request: DeployRequest): Promise<DeployResult> {
    throw new Error('Per-application deployment is unavailable: no artifact executor is configured. Nothing was restarted. Deploy a release with omnitron stack start <project> <stack> --release <id>, or use Releases in Console.');
  }

  async rollback(_app: string, _deployedBy?: string): Promise<DeployResult> {
    throw new Error('Per-application rollback is unavailable: no previous artifact is bound to this operation. Nothing was restarted. Select a verified previous release and deploy it with omnitron stack start <project> <stack> --release <previous-release-id>.');
  }

  /** Historical operation labels are not evidence of installed artifact versions. */
  async getHistory(app?: string, limit = 20): Promise<DeploymentRecord[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
      throw new Error('History limit must be an integer between 1 and 500');
    }
    let query = this.db
      .selectFrom('deployments')
      .selectAll()
      .orderBy('startedAt', 'desc')
      .limit(limit);

    if (app) {
      query = query.where('app', '=', app);
    }

    const rows = await query.execute();
    return rows.map((r) => ({
      id: r.id,
      app: r.app,
      version: r.version,
      previousVersion: r.previousVersion ?? null,
      strategy: r.strategy,
      status: r.status,
      startedAt: r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt),
      completedAt: r.completedAt ? (r.completedAt instanceof Date ? r.completedAt.toISOString() : String(r.completedAt)) : null,
      deployedBy: r.deployedBy ?? null,
    }));
  }

}
