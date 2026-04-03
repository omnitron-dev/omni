/**
 * DeployService — Application deployment with strategies
 *
 * Wraps @xec-sh/ops Deployer for multi-strategy deployments:
 * - rolling: restart apps one by one with health verification
 * - all-at-once: restart all at once (current behavior, fast but risky)
 * - blue-green: start new, verify, switch, stop old (via xec)
 * - canary: deploy to one instance, verify, roll out (via xec)
 *
 * When @xec-sh/ops is not installed, falls back to basic orchestrator restart
 * without strategy execution or health verification (Phase 1 behavior).
 *
 * Records deployment history in omnitron-pg for audit trail.
 */

import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OmnitronDatabase } from '../database/schema.js';
import type { OrchestratorService } from '../orchestrator/orchestrator.service.js';
import type { HealthCheckService } from './health-check.service.js';

// =============================================================================
// Types
// =============================================================================

export type DeployStrategy = 'rolling' | 'all-at-once' | 'blue-green' | 'canary';

export interface DeployRequest {
  /** App to deploy (or '*' for all) */
  app: string;
  /** Version label (git sha, tag, or custom) */
  version: string;
  /** Deployment strategy */
  strategy?: DeployStrategy | undefined;
  /** Who initiated the deployment */
  deployedBy?: string | undefined;
}

export interface DeployResult {
  id: string;
  app: string;
  version: string;
  previousVersion: string | null;
  strategy: string;
  status: 'success' | 'failed' | 'rolled_back';
  duration: number;
  error?: string | undefined;
}

export interface DeploymentRecord {
  id: string;
  app: string;
  version: string;
  previousVersion: string | null;
  strategy: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  deployedBy: string | null;
}

// =============================================================================
// @xec-sh/ops Deployer — loaded dynamically
// =============================================================================

import { loadXecOps } from '../shared/xec-loader.js';

// =============================================================================
// Service
// =============================================================================

export class DeployService {
  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly orchestrator: OrchestratorService,
    private readonly logger: ILogger,
    private readonly healthCheck?: HealthCheckService | undefined
  ) {}

  /**
   * Deploy an application with the specified strategy.
   */
  async deploy(request: DeployRequest): Promise<DeployResult> {
    const strategy = request.strategy ?? 'all-at-once';
    const startTime = Date.now();

    // Record deployment start
    const deployment = await this.db
      .insertInto('deployments')
      .values({
        app: request.app,
        version: request.version,
        strategy,
        status: 'deploying',
        deployedBy: request.deployedBy ?? null,
        startedAt: new Date(),
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.logger.info(
      { app: request.app, version: request.version, strategy, deploymentId: deployment.id },
      'Deployment started'
    );

    try {
      let previousVersion: string | null = null;

      const xec = await loadXecOps();

      if (xec) {
        // Use @xec-sh/ops Deployer with full strategy execution + health verification
        previousVersion = await this.deployWithXec(xec, request.app, request.version, strategy);
      } else {
        // Fallback: basic deployment without @xec-sh/ops
        switch (strategy) {
          case 'all-at-once':
            previousVersion = await this.deployAllAtOnce(request.app);
            break;
          case 'rolling':
            previousVersion = await this.deployRolling(request.app);
            break;
          default:
            throw new Error(`Strategy '${strategy}' requires @xec-sh/ops (not installed)`);
        }
      }

      // Record success
      await this.db
        .updateTable('deployments')
        .set({
          status: 'success',
          previousVersion,
          completedAt: new Date(),
        } as any)
        .where('id', '=', deployment.id)
        .execute();

      const duration = Date.now() - startTime;
      this.logger.info(
        { app: request.app, version: request.version, duration },
        'Deployment succeeded'
      );

      return {
        id: deployment.id,
        app: request.app,
        version: request.version,
        previousVersion,
        strategy,
        status: 'success',
        duration,
      };
    } catch (err) {
      // Record failure
      await this.db
        .updateTable('deployments')
        .set({
          status: 'failed',
          completedAt: new Date(),
          metadata: JSON.stringify({ error: (err as Error).message }) as any,
        } as any)
        .where('id', '=', deployment.id)
        .execute();

      const duration = Date.now() - startTime;
      this.logger.error(
        { app: request.app, version: request.version, error: (err as Error).message, duration },
        'Deployment failed'
      );

      return {
        id: deployment.id,
        app: request.app,
        version: request.version,
        previousVersion: null,
        strategy,
        status: 'failed',
        duration,
        error: (err as Error).message,
      };
    }
  }

  /**
   * Rollback to previous version (restart with previous config).
   */
  async rollback(app: string, deployedBy?: string): Promise<DeployResult> {
    // Find last successful deployment
    const lastSuccess = await this.db
      .selectFrom('deployments')
      .selectAll()
      .where('app', '=', app)
      .where('status', '=', 'success')
      .orderBy('startedAt', 'desc')
      .limit(1)
      .executeTakeFirst();

    if (!lastSuccess?.previousVersion) {
      throw new Error(`No previous version found for app '${app}'`);
    }

    return this.deploy({
      app,
      version: lastSuccess.previousVersion,
      strategy: 'all-at-once',
      deployedBy,
    });
  }

  /**
   * Get deployment history for an app.
   */
  async getHistory(app?: string, limit = 20): Promise<DeploymentRecord[]> {
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

  // ===========================================================================
  // Private — @xec-sh/ops Deployer Integration
  // ===========================================================================

  /**
   * Deploy using @xec-sh/ops Deployer with strategy execution,
   * health verification, and automatic rollback on failure.
   */
  private async deployWithXec(
    xec: typeof import('@xec-sh/ops'),
    app: string,
    version: string,
    strategy: string
  ): Promise<string | null> {
    const targets = app === '*'
      ? this.orchestrator.list().map((a) => a.name)
      : [app];

    const deployer = xec.Deployer.create({
      name: `deploy-${app}-${version}`,
      targets,
      strategy: strategy as import('@xec-sh/ops').DeployStrategy,
      hooks: {
        beforeDeploy: async (_ctx) => {
          this.logger.info({ app, strategy }, 'Starting deployment for target');
        },

        deploy: async (ctx) => {
          await this.orchestrator.restartApp(ctx.target);
        },

        verify: async (ctx) => {
          if (!this.healthCheck) return true;

          // Wait a moment for the app to initialize
          await new Promise((r) => setTimeout(r, 2000));

          const handle = this.orchestrator.getHandle(ctx.target);
          const port = handle?.port ?? null;
          const report = await this.healthCheck.checkApp(ctx.target, port);
          return report.overall === 'healthy';
        },

        rollback: async (ctx) => {
          this.logger.warn({ app: ctx.target }, 'Rolling back deployment');
          await this.orchestrator.restartApp(ctx.target);
        },

        afterDeploy: async (ctx) => {
          this.logger.info({ app: ctx.target }, 'Deployment verified and complete');
        },
      },
    });

    const result = await deployer.deploy(version);

    if (!result.success) {
      const failedTargets = result.targets
        .filter((r) => !r.success)
        .map((r) => `${r.target}: ${r.error ?? 'unknown error'}`);
      throw new Error(`Deployment failed for: ${failedTargets.join(', ')}`);
    }

    return null; // Version tracking via git — no app-level version yet
  }

  // ===========================================================================
  // Private — Fallback Strategies (without @xec-sh/ops)
  // ===========================================================================

  /**
   * All-at-once: stop app, start app. Simple but causes downtime.
   */
  private async deployAllAtOnce(app: string): Promise<string | null> {
    await this.orchestrator.restartApp(app);

    // Basic health verification if available
    if (this.healthCheck) {
      await new Promise((r) => setTimeout(r, 2000));
      const handle = this.orchestrator.getHandle(app);
      const port = handle?.port ?? null;
      const report = await this.healthCheck.checkApp(app, port);
      if (report.overall === 'unhealthy') {
        this.logger.warn({ app }, 'App is unhealthy after deployment — consider rollback');
      }
    }

    return null; // Version tracking via git — no app-level version yet
  }

  /**
   * Rolling: for multi-instance apps, restart one at a time with health checks.
   * Falls back to all-at-once for single-instance apps.
   */
  private async deployRolling(app: string): Promise<string | null> {
    const handle = this.orchestrator.getHandle(app);
    if (!handle) throw new Error(`Unknown app: ${app}`);

    // Single-instance apps cannot do rolling — fall back to all-at-once
    if (!handle.supervisor || handle.instanceCount <= 1) {
      return this.deployAllAtOnce(app);
    }

    const childNames = handle.supervisor.getChildNames();
    this.logger.info(
      { app, instances: childNames.length },
      'Rolling deployment — restarting instances one at a time'
    );

    for (const childName of childNames) {
      this.logger.info({ app, child: childName }, 'Restarting instance');
      await handle.supervisor.restartChild(childName);

      // Wait for the restarted instance to become healthy
      if (this.healthCheck) {
        await new Promise((r) => setTimeout(r, 2000));
        const port = handle.port ?? null;
        const report = await this.healthCheck.checkApp(app, port);
        if (report.overall === 'unhealthy') {
          throw new Error(
            `Rolling deployment aborted: instance '${childName}' unhealthy after restart`
          );
        }
      }

      this.logger.info({ app, child: childName }, 'Instance restarted and healthy');
    }

    return null;
  }
}
