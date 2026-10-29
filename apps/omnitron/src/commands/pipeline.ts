/**
 * omnitron pipeline list — List CI/CD pipelines
 * omnitron pipeline run <id> — Execute a pipeline
 * omnitron pipeline status <runId> — Check run status
 */

import { log } from '@xec-sh/kit';
import { readFile } from 'node:fs/promises';
import { createDaemonClient } from '../daemon/daemon-client.js';
import type { IOmnitronPipelinesService } from '../shared/dto/services.js';

/**
 * One call to the daemon's pipelines service, through `client.service()` —
 * the way `secret.ts` and `audit.ts` reach theirs.
 *
 * This used to reach into the client's privates and walk the peers itself:
 * `netron.getPeers ? netron.getPeers() : []`. Netron has no `getPeers` — it
 * keeps its peers in a `peers` Map — so the guard chose `[]` every time, the
 * loop never ran, and every command in this file ended as
 *
 *     ■  Failed: OmnitronPipelines service not available
 *
 * Measured 2026-09-23 on the development daemon, whose registry lists
 * `OmnitronPipelines` (`availableServices` in its log): through
 * `client.service()` the same daemon answered `listPipelines()` and
 * `listRuns()` with `[]` — «No pipelines defined» was the true answer.
 */
async function withPipelines<T>(call: (svc: IOmnitronPipelinesService) => Promise<T>): Promise<T> {
  const client = createDaemonClient();
  try {
    return await call(await client.service<IOmnitronPipelinesService>('OmnitronPipelines'));
  } finally {
    await client.disconnect();
  }
}

export async function pipelineListCommand(): Promise<void> {
  try {
    const pipelines = await withPipelines((svc) => svc.listPipelines());

    if (pipelines.length === 0) {
      log.info('No pipelines defined');
      return;
    }

    log.info(`Found ${pipelines.length} pipeline(s):\n`);
    const header = 'ID'.padEnd(38) + ['Name', 'Steps', 'Triggers', 'Created'].map((h) => h.padEnd(22)).join('');
    log.info(header);
    log.info('-'.repeat(88));

    for (const p of pipelines) {
      const steps = Array.isArray(p.steps) ? p.steps.length : 0;
      const triggers = Array.isArray(p.triggers) ? p.triggers.length : 0;
      const created = new Date(p.createdAt).toLocaleDateString();
      log.info(
        p.id.padEnd(38) +
          [
            p.name.slice(0, 21).padEnd(22),
            String(steps).padEnd(22),
            String(triggers).padEnd(22),
            created.padEnd(22),
          ].join('')
      );
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    // Every catch in this file printed «Failed» and left with exit 0, so a
    // script — or an `&&` — took the failure for an answer.
    process.exitCode = 1;
  }
}

export async function pipelineRunCommand(id: string, options: { paramsFile?: string } = {}): Promise<void> {
  try {
    const params = options.paramsFile ? JSON.parse(await readFile(options.paramsFile, 'utf8')) : undefined;
    const run = await withPipelines(async (svc) => {
      const pipelines = await svc.listPipelines();
      const byId = pipelines.find((pipeline) => pipeline.id === id);
      const matches = byId ? [byId] : pipelines.filter((pipeline) => pipeline.name === id);
      if (matches.length !== 1)
        throw new Error(matches.length ? `Pipeline name '${id}' is ambiguous; use its id` : `No pipeline '${id}'`);
      return svc.executePipeline({
        id: matches[0]!.id,
        expectedRevision: matches[0]!.revision,
        ...(params ? { params } : {}),
      });
    });
    log.success(`Pipeline run started: ${run.id} (status: ${run.status})`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

export async function pipelineStatusCommand(
  runId: string,
  options: { json?: boolean; output?: boolean } = {}
): Promise<void> {
  try {
    const run = await withPipelines((svc) => svc.getRunStatus({ runId }));
    if (!run) {
      log.warn(`Run '${runId}' not found`);
      process.exitCode = 1;
      return;
    }
    if (['failed', 'cancelled', 'interrupted'].includes(run.status)) process.exitCode = 1;
    if (options.json) {
      console.log(JSON.stringify(run, null, 2));
      return;
    }

    log.info(`Run ${run.id}: ${run.status}`);

    if (Array.isArray(run.steps)) {
      for (const step of run.steps) {
        const icon = step.status === 'success' ? '[OK]' : step.status === 'failed' ? '[FAIL]' : '[SKIP]';
        log.info(`  ${icon} ${step.name} (${step.duration}ms)${step.error ? ` — ${step.error}` : ''}`);
        if (options.output) {
          if (step.output) console.log(step.output);
          if (step.stderr) console.error(step.stderr);
          if (step.outputTruncated) log.warn('Retained output was truncated');
        }
      }
    }

    if (run.completedAt) {
      log.info(`Completed: ${new Date(run.completedAt).toLocaleString()}`);
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

export async function pipelineSaveCommand(file: string, options: { id?: string } = {}): Promise<void> {
  try {
    const definition = JSON.parse(await readFile(file, 'utf8'));
    const result = await withPipelines((svc) =>
      options.id ? svc.updatePipeline({ id: options.id, definition }) : svc.createPipeline(definition)
    );
    log.success(`Pipeline saved: ${result.id} (${result.name})`);
  } catch (error) {
    log.error(`Failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

export async function pipelineCancelCommand(runId: string): Promise<void> {
  try {
    await withPipelines((svc) => svc.cancelRun({ runId }));
    log.success(`Run ${runId} is no longer executing`);
  } catch (error) {
    log.error(`Failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
