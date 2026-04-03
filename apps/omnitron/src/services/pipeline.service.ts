/**
 * PipelineService — CI/CD Pipeline execution via @xec-sh/ops Pipeline
 *
 * Manages DAG-based pipeline definitions and their execution runs.
 * Pipeline definitions and run history are persisted in omnitron-pg.
 *
 * Uses dynamic import for @xec-sh/ops. Falls back to basic sequential
 * shell execution when the package is not installed.
 */

import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import type { OmnitronDatabase } from '../database/schema.js';

// =============================================================================
// Types
// =============================================================================

export interface PipelineDef {
  name: string;
  description?: string;
  steps: PipelineStep[];
  triggers?: PipelineTrigger[];
}

export interface PipelineStep {
  name: string;
  run: string;
  dependsOn?: string[];
  env?: Record<string, string>;
  timeout?: number;
  retries?: number;
  condition?: string;
}

export interface PipelineTrigger {
  type: 'cron' | 'webhook' | 'manual';
  config: Record<string, unknown>;
}

export interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  steps: PipelineStep[];
  triggers: PipelineTrigger[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineRunStepResult {
  name: string;
  status: string;
  duration: number;
  output?: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled';
  steps: PipelineRunStepResult[];
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  params: Record<string, unknown> | null;
}

// =============================================================================
// @xec-sh/ops Pipeline — loaded dynamically
// =============================================================================

import { loadXecOps } from '../shared/xec-loader.js';

// =============================================================================
// Service
// =============================================================================

export class PipelineService {
  private activeRuns = new Map<string, { cancel: () => void }>();

  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly logger: ILogger
  ) {}

  // ===========================================================================
  // Pipeline CRUD
  // ===========================================================================

  async createPipeline(def: PipelineDef): Promise<Pipeline> {
    const now = new Date();
    const row = await this.db
      .insertInto('pipelines' as any)
      .values({
        id: randomUUID(),
        name: def.name,
        description: def.description ?? null,
        steps: JSON.stringify(def.steps),
        triggers: JSON.stringify(def.triggers ?? []),
        createdAt: now,
        updatedAt: now,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.logger.info({ id: (row as any).id, name: def.name }, 'Pipeline created');
    return this.mapPipeline(row);
  }

  async getPipeline(id: string): Promise<Pipeline | null> {
    const row = await this.db
      .selectFrom('pipelines' as any)
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row ? this.mapPipeline(row) : null;
  }

  async listPipelines(): Promise<Pipeline[]> {
    const rows = await this.db
      .selectFrom('pipelines' as any)
      .selectAll()
      .orderBy('createdAt', 'desc')
      .execute();

    return rows.map((r) => this.mapPipeline(r));
  }

  async deletePipeline(id: string): Promise<void> {
    await this.db.deleteFrom('pipeline_runs' as any).where('pipelineId', '=', id).execute();
    await this.db.deleteFrom('pipelines' as any).where('id', '=', id).execute();
    this.logger.info({ id }, 'Pipeline deleted');
  }

  // ===========================================================================
  // Execution
  // ===========================================================================

  async executePipeline(id: string, params?: Record<string, unknown>, triggeredBy = 'manual'): Promise<PipelineRun> {
    const pipeline = await this.getPipeline(id);
    if (!pipeline) throw new Error(`Pipeline '${id}' not found`);

    const runId = randomUUID();
    const now = new Date();

    // Insert pending run
    await this.db
      .insertInto('pipeline_runs' as any)
      .values({
        id: runId,
        pipelineId: id,
        status: 'running',
        steps: JSON.stringify([]),
        startedAt: now,
        completedAt: null,
        triggeredBy,
        params: params ? JSON.stringify(params) : null,
      } as any)
      .execute();

    this.logger.info({ runId, pipelineId: id, triggeredBy }, 'Pipeline execution started');

    // Execute asynchronously
    const abortController = new AbortController();
    this.activeRuns.set(runId, { cancel: () => abortController.abort() });

    this.executeSteps(runId, pipeline.steps, params, abortController.signal).catch((err) => {
      this.logger.error({ runId, error: (err as Error).message }, 'Pipeline execution error');
    });

    return this.getRunStatus(runId) as Promise<PipelineRun>;
  }

  async cancelRun(runId: string): Promise<void> {
    const handle = this.activeRuns.get(runId);
    if (handle) {
      handle.cancel();
      this.activeRuns.delete(runId);
    }

    await this.db
      .updateTable('pipeline_runs' as any)
      .set({ status: 'cancelled', completedAt: new Date() } as any)
      .where('id', '=', runId)
      .execute();

    this.logger.info({ runId }, 'Pipeline run cancelled');
  }

  async getRunStatus(runId: string): Promise<PipelineRun | null> {
    const row = await this.db
      .selectFrom('pipeline_runs' as any)
      .selectAll()
      .where('id', '=', runId)
      .executeTakeFirst();

    return row ? this.mapRun(row) : null;
  }

  async listRuns(pipelineId?: string, limit = 50): Promise<PipelineRun[]> {
    let query = this.db
      .selectFrom('pipeline_runs' as any)
      .selectAll()
      .orderBy('startedAt', 'desc')
      .limit(limit);

    if (pipelineId) {
      query = query.where('pipelineId', '=', pipelineId);
    }

    const rows = await query.execute();
    return rows.map((r) => this.mapRun(r));
  }

  // ===========================================================================
  // Private — Step execution
  // ===========================================================================

  private async executeSteps(
    runId: string,
    steps: PipelineStep[],
    params: Record<string, unknown> | undefined,
    signal: AbortSignal
  ): Promise<void> {
    const xec = await loadXecOps();
    const stepResults: PipelineRunStepResult[] = [];
    let overallStatus: 'success' | 'failed' = 'success';

    // Build dependency graph — execute steps whose dependencies are met
    const completed = new Set<string>();
    const remaining = [...steps];

    while (remaining.length > 0) {
      if (signal.aborted) {
        overallStatus = 'failed';
        break;
      }

      // Find steps whose dependencies are all completed
      const ready = remaining.filter((s) =>
        !s.dependsOn?.length || s.dependsOn.every((dep) => completed.has(dep))
      );

      if (ready.length === 0) {
        // Circular dependency or unresolvable — fail remaining
        for (const s of remaining) {
          stepResults.push({ name: s.name, status: 'skipped', duration: 0, error: 'Unresolvable dependency' });
        }
        overallStatus = 'failed';
        break;
      }

      // Execute ready steps in parallel
      const results = await Promise.allSettled(
        ready.map((step) => this.executeStep(step, params, xec, signal))
      );

      for (let i = 0; i < ready.length; i++) {
        const step = ready[i]!;
        const result = results[i]!;

        if (result.status === 'fulfilled') {
          stepResults.push(result.value);
          if (result.value.status === 'failed') overallStatus = 'failed';
        } else {
          stepResults.push({
            name: step.name,
            status: 'failed',
            duration: 0,
            error: result.reason?.message ?? 'Unknown error',
          });
          overallStatus = 'failed';
        }

        completed.add(step.name);
        remaining.splice(remaining.indexOf(step), 1);
      }

      // Update run in DB with current progress
      await this.db
        .updateTable('pipeline_runs' as any)
        .set({ steps: JSON.stringify(stepResults) } as any)
        .where('id', '=', runId)
        .execute();

      // If any step failed and we don't have a condition, stop
      if (overallStatus === 'failed') {
        // Mark remaining as skipped
        for (const s of remaining) {
          stepResults.push({ name: s.name, status: 'skipped', duration: 0 });
        }
        break;
      }
    }

    // Finalize run
    await this.db
      .updateTable('pipeline_runs' as any)
      .set({
        status: overallStatus,
        steps: JSON.stringify(stepResults),
        completedAt: new Date(),
      } as any)
      .where('id', '=', runId)
      .execute();

    this.activeRuns.delete(runId);
    this.logger.info({ runId, status: overallStatus }, 'Pipeline execution completed');
  }

  private async executeStep(
    step: PipelineStep,
    _params: Record<string, unknown> | undefined,
    _xec: typeof import('@xec-sh/ops') | null,
    signal: AbortSignal
  ): Promise<PipelineRunStepResult> {
    const start = Date.now();
    const timeout = step.timeout ?? 300_000; // 5 min default
    const maxRetries = step.retries ?? 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const output = await this.runShellCommand(step.run, step.env, timeout, signal);
        return {
          name: step.name,
          status: 'success',
          duration: Date.now() - start,
          output: output.slice(0, 10_000), // Limit stored output
        };
      } catch (err) {
        if (attempt === maxRetries || signal.aborted) {
          return {
            name: step.name,
            status: 'failed',
            duration: Date.now() - start,
            error: (err as Error).message,
          };
        }
        this.logger.warn({ step: step.name, attempt, maxRetries }, 'Step failed, retrying');
      }
    }

    // Should not reach here
    return { name: step.name, status: 'failed', duration: Date.now() - start, error: 'Exhausted retries' };
  }

  private async runShellCommand(
    command: string,
    env?: Record<string, string>,
    timeout = 300_000,
    signal?: AbortSignal
  ): Promise<string> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    const shell = process.platform === 'win32' ? 'cmd' : '/bin/sh';
    const shellArgs = process.platform === 'win32' ? ['/c', command] : ['-c', command];

    const { stdout } = await execFileAsync(shell, shellArgs, {
      timeout,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, ...env },
      signal: signal as any,
    });

    return stdout;
  }

  // ===========================================================================
  // Mappers
  // ===========================================================================

  private mapPipeline(row: any): Pipeline {
    return {
      id: row.id,
      name: row.name,
      description: row.description ?? null,
      steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps ?? [],
      triggers: typeof row.triggers === 'string' ? JSON.parse(row.triggers) : row.triggers ?? [],
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
      updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
    };
  }

  private mapRun(row: any): PipelineRun {
    return {
      id: row.id,
      pipelineId: row.pipelineId,
      status: row.status,
      steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps ?? [],
      startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : String(row.startedAt),
      completedAt: row.completedAt ? (row.completedAt instanceof Date ? row.completedAt.toISOString() : String(row.completedAt)) : null,
      triggeredBy: row.triggeredBy ?? 'unknown',
      params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params ?? null,
    };
  }
}
