/**
 * omnitron pipeline list — List CI/CD pipelines
 * omnitron pipeline run <id> — Execute a pipeline
 * omnitron pipeline status <runId> — Check run status
 */

import { createHash, randomUUID } from 'node:crypto';
import { log } from '@xec-sh/kit';
import { readFile } from 'node:fs/promises';
import type { IOmnitronPipelinesService } from '../shared/dto/services.js';
import type { PipelineDef, PipelineRun } from '../shared/dto/pipelines.js';
import { emitJson, emitError } from './output.js';
import { pipelineShellReceipt } from '../../data/operations/pipeline-shell-receipt.js';

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
async function withPipelines<T>(call: (svc: IOmnitronPipelinesService) => Promise<T>, timeout?: number): Promise<T> {
  const { createDaemonClient } = await import('../daemon/daemon-client.js');
  const client = createDaemonClient(undefined, timeout);
  try {
    return await call(await client.service<IOmnitronPipelinesService>('OmnitronPipelines'));
  } finally {
    await client.disconnect();
  }
}

export async function pipelineListCommand(): Promise<void> {
  try {
    const pipelines = await withPipelines((svc) => svc.listPipelines());
    if (emitJson({ pipelines })) return;

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
    emitError(`Failed: ${(err as Error).message}`);
    // Every catch in this file printed «Failed» and left with exit 0, so a
    // script — or an `&&` — took the failure for an answer.
    process.exitCode = 1;
  }
}

async function resolveRunTarget(svc: IOmnitronPipelinesService, reference: string, expectedRevision?: string) {
  const isId = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(reference);
  if (expectedRevision !== undefined) {
    if (!isId || !/^[a-f0-9]{64}$/.test(expectedRevision))
      throw new Error('--expected-revision requires the saved pipeline UUID and its SHA-256 revision');
    return { id: reference.toLowerCase(), revision: expectedRevision };
  }
  if (isId) {
    const pipeline = await svc.getPipeline({ id: reference });
    if (pipeline) return pipeline;
  }
  const pipelines = await svc.listPipelines();
  const byId = pipelines.find(pipeline => pipeline.id === reference);
  if (byId) return byId;
  const matches = pipelines.filter(pipeline => pipeline.name === reference);
  if (matches.length !== 1)
    throw new Error(matches.length ? `Pipeline name '${reference}' is ambiguous; use its id` : `No pipeline '${reference}'`);
  return matches[0]!;
}

export async function pipelineRunCommand(id: string, options: { paramsFile?: string; runId?: string; prepare?: boolean; expectedRevision?: string } = {}): Promise<void> {
  const runId = options.runId ?? randomUUID();
  try {
    const params = options.paramsFile ? JSON.parse(await readFile(options.paramsFile, 'utf8')) : undefined;
    const run = await withPipelines(async (svc) => {
      const target = await resolveRunTarget(svc, id, options.expectedRevision);
      const request = {
        runId,
        id: target.id,
        expectedRevision: target.revision,
        ...(params !== undefined ? { params } : {}),
      };
      const finish = (service: IOmnitronPipelinesService, prepared: PipelineRun) => options.prepare
        ? prepared : service.startRun({ runId, expectedDigest: prepared.review!.digest, params });
      let prepared: PipelineRun;
      try {
        prepared = await svc.prepareRun(request);
      } catch (error) {
        const { isRequestTimeout } = await import('../daemon/daemon-client.js');
        const { isLostRpcAcknowledgement } = await import('../shared/dto/services.js');
        if (!isRequestTimeout(error) && !isLostRpcAcknowledgement(error)) throw error;
        // The server matches the original actor, revision and private parameters before returning its receipt.
        return withPipelines(async reconnected => finish(reconnected, await reconnected.prepareRun(request)));
      }
      return finish(svc, prepared);
    });
    if (['failed', 'interrupted', 'cancelled'].includes(run.status)) process.exitCode = 1;
    if (!emitJson(run)) log.success(`Pipeline run ${run.id}: ${run.status}${run.review ? ` · review ${run.review.digest}` : ''}`);
  } catch (err) {
    emitError(`Run ${runId}: ${(err as Error).message}. Inspect pipeline status ${runId}; retain this ID when retrying.`);
    process.exitCode = 1;
  }
}

export async function pipelinePhysicalRestoreCommand(verifyRunId: string, project: string, stack: string): Promise<void> {
  try {
    const result = await withPipelines(svc => svc.inspectPhysicalRestore({ verifyRunId, project, stack }), 86_700_000);
    if (emitJson(result)) return;
    log.info(`Verified ${result.volumes.length} stopped physical volumes from ${result.source.nodeId} on ${result.receiver.nodeId} at ${result.verifiedAt}`);
    log.info(`Proof SHA-256 ${result.proofDigest}`);
  } catch (error) {
    emitError((error as Error).message);
    process.exitCode = 1;
  }
}

export async function pipelineStatusCommand(runId: string, options: { output?: boolean; shellReceipt?: true | string } = {}): Promise<void> {
  try {
    const expected = options.shellReceipt;
    if (typeof expected === 'string' && !/^[0-9a-f]{64}$/.test(expected)) throw Error('Expected shell receipt must be a SHA-256 digest');
    const run = await withPipelines((svc) => svc.getRunStatus({ runId }));
    if (!run) {
      emitError(`Run '${runId}' not found`);
      process.exitCode = 1;
      return;
    }
    if (expected !== undefined) {
      const receipt = pipelineShellReceipt(run);
      if (receipt.id !== runId || (typeof expected === 'string' && receipt.digest !== expected)) {
        throw Error('The registered Pipeline shell receipt differs from the requested run or digest');
      }
      if (!emitJson(receipt)) log.info(`Run ${runId} shell receipt SHA-256 ${receipt.digest}`);
      return;
    }
    if (['failed', 'cancelled', 'interrupted'].includes(run.status)) process.exitCode = 1;
    if (emitJson(run)) return;

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
    emitError(`Failed: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

function parseDefinition(source: string): PipelineDef {
  try {
    return JSON.parse(source);
  } catch {
    // Node's syntax error can include an excerpt of commands or environment values.
    throw new Error('Pipeline definition must be valid JSON');
  }
}

export async function pipelineSaveCommand(file: string, options: { id?: string; expectedRevision?: string } = {}): Promise<void> {
  try {
    if (options.id && !/^[a-f0-9]{64}$/.test(options.expectedRevision ?? ''))
      throw new Error('Updating requires --expected-revision <revision> from the reviewed pipeline');
    if (!options.id && options.expectedRevision)
      throw new Error('--expected-revision requires --id');
    const definition = parseDefinition(await readFile(file, 'utf8'));
    const result = await withPipelines(async (svc) => {
      if (!options.id) return svc.createPipeline(definition);
      const current = await svc.getPipeline({ id: options.id });
      if (!current) throw new Error(`Pipeline '${options.id}' not found`);
      if (!current.conditionalUpdates) throw new Error('Update the daemon to support conditional pipeline edits');
      return svc.updatePipeline({ id: options.id, definition, expectedRevision: options.expectedRevision! });
    });
    if (!emitJson(result)) log.success(`Pipeline saved: ${result.id} (${result.name})`);
  } catch (error) {
    emitError(`Failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

export async function pipelineCheckCommand(file: string): Promise<void> {
  try {
    const source = await readFile(file);
    const definition = parseDefinition(source.toString('utf8'));
    const { checkPipelineDefinition } = await import('../services/pipeline-definition.js');
    await checkPipelineDefinition(definition);
    const steps = definition.steps.map(step => ({
      name: step.name, kind: step.kind ?? 'shell', dependsOn: step.dependsOn ?? [],
    }));
    const sourceSha256 = createHash('sha256').update(source).digest('hex');
    if (!emitJson({ scope: 'definition', sourceSha256, name: definition.name, steps }))
      log.success(`Checked pipeline ${definition.name} (${steps.length} steps)`);
  } catch (error) {
    emitError(error);
    process.exitCode = 1;
  }
}

export async function pipelineCancelCommand(runId: string): Promise<void> {
  try {
    const result = await withPipelines((svc) => svc.cancelRun({ runId }));
    if (!emitJson({ runId, ...result })) log.success(`Run ${runId} is no longer executing`);
  } catch (error) {
    emitError(`Failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}

/** Start only the exact prepared request. Duplicate delivery returns its receipt. */
export async function pipelineStartCommand(runId: string, options: { expectedDigest: string; paramsFile?: string }, resume = false): Promise<void> {
  try {
    const params = options.paramsFile ? JSON.parse(await readFile(options.paramsFile, 'utf8')) : undefined;
    const run = await withPipelines(svc => svc[resume ? 'resumeRun' : 'startRun']({ runId, expectedDigest: options.expectedDigest, params }));
    if (!emitJson(run)) log.info(`Run ${run.id}: ${run.status}`);
    if (['failed', 'interrupted', 'cancelled'].includes(run.status)) process.exitCode = 1;
  } catch (error) {
    emitError(`Run ${runId}: ${(error as Error).message}. Inspect its receipt before retrying.`);
    process.exitCode = 1;
  }
}

export async function pipelineReconcileCommand(runId: string): Promise<void> {
  try {
    const run = await withPipelines(svc => svc.reconcileRun({ runId }));
    if (!emitJson(run)) log.info(`Run ${run.id}: ${run.status} · recovery ${run.recovery?.digest ?? 'unavailable'}`);
    if (run.recovery?.blocked.length) process.exitCode = 1;
  } catch (error) { emitError(`Reconciliation failed: ${(error as Error).message}`); process.exitCode = 1; }
}
