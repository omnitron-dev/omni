/**
 * omnitron pipeline list — List CI/CD pipelines
 * omnitron pipeline run <id> — Execute a pipeline
 * omnitron pipeline status <runId> — Check run status
 */

import { log } from '@xec-sh/kit';
import { createDaemonClient } from '../daemon/daemon-client.js';

async function invokeRpc(method: string, data?: any): Promise<any> {
  const client = createDaemonClient();
  try {
    await (client as any).ensureConnected();
    const netron = (client as any).netron;
    const peers = netron.getPeers ? netron.getPeers() : [];
    for (const peer of peers) {
      try {
        const svc = await peer.queryInterface('OmnitronPipelines');
        if (svc && typeof svc[method] === 'function') {
          return data ? await svc[method](data) : await svc[method]();
        }
      } catch {
        continue;
      }
    }
    throw new Error('OmnitronPipelines service not available');
  } finally {
    await client.disconnect();
  }
}

export async function pipelineListCommand(): Promise<void> {
  try {
    const pipelines: any[] = await invokeRpc('listPipelines');

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
  }
}

export async function pipelineRunCommand(id: string): Promise<void> {
  try {
    const run: any = await invokeRpc('executePipeline', { id });
    log.success(`Pipeline run started: ${run.id} (status: ${run.status})`);
  } catch (err) {
    log.error(`Failed: ${(err as Error).message}`);
  }
}

export async function pipelineStatusCommand(runId: string): Promise<void> {
  try {
    const run: any = await invokeRpc('getRunStatus', { runId });
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
  }
}
