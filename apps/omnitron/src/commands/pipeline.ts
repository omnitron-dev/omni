/**
 * omnitron pipeline list — List CI/CD pipelines
 * omnitron pipeline run <id> — Execute a pipeline
 * omnitron pipeline status <runId> — Check run status
 */

import { log } from '@xec-sh/kit';
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
    const header = ['Name', 'Steps', 'Triggers', 'Created'].map((h) => h.padEnd(22)).join('');
    log.info(header);
    log.info('-'.repeat(88));

    for (const p of pipelines) {
      const steps = Array.isArray(p.steps) ? p.steps.length : 0;
      const triggers = Array.isArray(p.triggers) ? p.triggers.length : 0;
      const created = new Date(p.createdAt).toLocaleDateString();
      log.info([
        p.name.slice(0, 21).padEnd(22),
        String(steps).padEnd(22),
        String(triggers).padEnd(22),
        created.padEnd(22),
      ].join(''));
    }
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    // Every catch in this file printed «Failed» and left with exit 0, so a
    // script — or an `&&` — took the failure for an answer.
    process.exitCode = 1;
  }
}

export async function pipelineRunCommand(id: string): Promise<void> {
  try {
    const run = await withPipelines((svc) => svc.executePipeline({ id }));
    log.success(`Pipeline run started: ${run.id} (status: ${run.status})`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

export async function pipelineStatusCommand(runId: string): Promise<void> {
  try {
    const run = await withPipelines((svc) => svc.getRunStatus({ runId }));
    if (!run) {
      log.warn(`Run '${runId}' not found`);
      return;
    }

    log.info(`Run ${run.id}: ${run.status}`);

    if (Array.isArray(run.steps)) {
      for (const step of run.steps) {
        const icon = step.status === 'success' ? '[OK]' : step.status === 'failed' ? '[FAIL]' : '[SKIP]';
        log.info(`  ${icon} ${step.name} (${step.duration}ms)${step.error ? ` — ${step.error}` : ''}`);
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
