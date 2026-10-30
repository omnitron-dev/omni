/** Durable control-plane state over Xec's execution, graph and cancellation contracts. */
import { randomUUID, createHash } from 'node:crypto';
import type { Kysely, Selectable } from 'kysely';
import type { Command, SSHAdapterOptions } from '@xec-sh/core';
import type { PipelineEvent, PreparedScript } from '@xec-sh/ops';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import type { OmnitronDatabase, PipelinesTable, PipelineRunsTable } from '../database/schema.js';
import type { NodeManagerService } from './node-manager.service.js';
import {
  PIPELINE_LIMITS,
  pipelineCondition,
  stepEnvironment,
  validatePipeline,
  validatePipelineParams,
} from './pipeline-definition.js';
import type {
  PipelineDef,
  Pipeline,
  PipelineRunStepResult,
  PipelineRun,
  PipelineRunSummary,
} from '../shared/dto/pipelines.js';
export type {
  PipelineDef,
  PipelineStep,
  Pipeline,
  PipelineRunStepResult,
  PipelineRun,
  PipelineRunSummary,
} from '../shared/dto/pipelines.js';

interface ActiveRun {
  pipelineId: string;
  abort: AbortController;
  done: Promise<void>;
}
type Nodes = Pick<NodeManagerService, 'getNode' | 'nodeToSshTarget'>;
const live = ['pending', 'running', 'cancelling'];
const secretKey = /password|passphrase|secret|token|credential|private.?key|api.?key/i;

/** Incomplete known secrets are withheld across stream chunk boundaries. */
export class PipelineOutput {
  private text = '';
  private privateKeyOpen = false;
  private privateKeyTail = '';
  received = false;
  truncated = false;
  constructor(private readonly secrets: string[]) {}
  append(text: string) {
    this.received = true;
    if (this.privateKeyOpen) {
      const pending = this.privateKeyTail + text;
      const end = /-----END [^-]*PRIVATE KEY-----/.exec(pending);
      if (!end) {
        this.privateKeyTail = pending.slice(-100);
        return;
      }
      this.privateKeyOpen = false;
      this.privateKeyTail = '';
      text = pending.slice(end.index + end[0].length);
    }
    this.text += text;
    this.text = this.text.replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      (key) => {
        if (!/-----END [^-]*PRIVATE KEY-----$/.test(key)) {
          this.privateKeyOpen = true;
          this.privateKeyTail = key.slice(-100);
        }
        return '[redacted private key]';
      }
    );
    for (const secret of this.secrets) this.text = this.text.split(secret).join('***');
    const bound = PIPELINE_LIMITS.outputBytes + Math.max(0, ...this.secrets.map((value) => Buffer.byteLength(value)));
    if (Buffer.byteLength(this.text) > bound) {
      this.text = Buffer.from(this.text)
        .subarray(-bound)
        .toString('utf8')
        .replace(/^\uFFFD/, '');
      this.truncated = true;
    }
  }
  snapshot(final = false) {
    let value = this.text;
    for (const secret of this.secrets) value = value.split(secret).join('***');
    value = value.replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g,
      '[redacted private key]'
    );
    if (!final) {
      const hold = Math.max(0, ...this.secrets.map((secret) => secret.length - 1));
      value = value.slice(0, Math.max(0, value.length - hold));
      value = value.slice(0, value.lastIndexOf('\n') + 1);
    }
    const lines = value.split('\n');
    if (lines.some((line) => line.length > 2048)) this.truncated = true;
    const encoded = Buffer.from(lines.map((line) => redactDiagnosticText(line)).join('\n'));
    if (encoded.length > PIPELINE_LIMITS.outputBytes) this.truncated = true;
    return encoded
      .subarray(-PIPELINE_LIMITS.outputBytes)
      .toString('utf8')
      .replace(/^\uFFFD/, '');
  }
}

export class PipelineService {
  activeRunCount(): number { return this.activeRuns.size; }
  private readonly activeRuns = new Map<string, ActiveRun>();
  private initialization?: Promise<void>;
  private stopped = false;
  private nodes?: Nodes;
  private observe: ((status: PipelineRun['status'], duration: number) => void) | undefined;
  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly logger: ILogger
  ) {}

  configure(nodes: Nodes, observe?: (status: PipelineRun['status'], duration: number) => void): void {
    this.nodes = nodes;
    this.observe = observe;
  }
  async initialize(): Promise<void> {
    this.initialization ??= this.db
      .updateTable('pipeline_runs')
      .set({ status: 'interrupted', completedAt: new Date() })
      .where('status', 'in', live)
      .execute()
      .then(() => undefined);
    return this.initialization;
  }
  async dispose(): Promise<void> {
    this.stopped = true;
    for (const run of this.activeRuns.values()) run.abort.abort(new Error('Daemon is stopping'));
    while (this.activeRuns.size) await Promise.allSettled([...this.activeRuns.values()].map((run) => run.done));
  }
  private async validate(def: PipelineDef): Promise<void> {
    validatePipeline(def);
    const { Pipeline: XecPipeline } = await import('@xec-sh/ops');
    const graph = XecPipeline.create(def.name);
    for (const step of def.steps)
      graph.step(step.name, { run: step.run, ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}) });
    graph.validate();
  }
  async createPipeline(def: PipelineDef): Promise<Pipeline> {
    await this.validate(def);
    const row = await this.db
      .insertInto('pipelines')
      .values({
        id: randomUUID(),
        name: def.name.trim(),
        description: def.description ?? null,
        steps: JSON.stringify(def.steps),
        triggers: JSON.stringify(def.triggers ?? []),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.mapPipeline(row);
  }
  async updatePipeline(id: string, def: PipelineDef): Promise<Pipeline> {
    await this.validate(def);
    const row = await this.db
      .updateTable('pipelines')
      .set({
        name: def.name.trim(),
        description: def.description ?? null,
        steps: JSON.stringify(def.steps),
        triggers: JSON.stringify(def.triggers ?? []),
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    if (!row) throw new Error(`Pipeline '${id}' not found`);
    return this.mapPipeline(row);
  }
  async getPipeline(id: string): Promise<Pipeline | null> {
    const row = await this.db.selectFrom('pipelines').selectAll().where('id', '=', id).executeTakeFirst();
    return row ? this.mapPipeline(row) : null;
  }
  async listPipelines(): Promise<Pipeline[]> {
    return (await this.db.selectFrom('pipelines').selectAll().orderBy('createdAt', 'desc').execute()).map((row) =>
      this.mapPipeline(row)
    );
  }
  async deletePipeline(id: string): Promise<void> {
    if ([...this.activeRuns.values()].some((run) => run.pipelineId === id))
      throw new Error('Stop active runs before deleting a pipeline');
    await this.db.transaction().execute(async (trx) => {
      await trx.deleteFrom('pipeline_runs').where('pipelineId', '=', id).execute();
      await trx.deleteFrom('pipelines').where('id', '=', id).execute();
    });
  }

  async executePipeline(
    id: string,
    params: Record<string, unknown> = {},
    triggeredBy = 'system',
    expectedRevision?: string
  ): Promise<PipelineRun> {
    await this.initialize();
    if (this.stopped) throw new Error('Pipeline executor is stopping');
    if (this.activeRuns.size >= PIPELINE_LIMITS.activeRuns) throw new Error('Pipeline execution capacity reached');
    validatePipelineParams(params);
    const runId = randomUUID();
    const abort = new AbortController();
    let finishAdmission!: () => void;
    const admission = new Promise<void>((resolve) => {
      finishAdmission = resolve;
    });
    const handle: ActiveRun = { pipelineId: id, abort, done: admission };
    this.activeRuns.set(runId, handle);
    const prepared: PreparedScript[] = [];
    try {
      const definition = await this.getPipeline(id);
      if (!definition) throw new Error(`Pipeline '${id}' not found`);
      if (expectedRevision !== undefined && expectedRevision !== definition.revision)
        throw new Error('Pipeline changed after review. Reload and review the current definition');
      await this.validate({ ...definition, description: definition.description ?? '' });
      const { Pipeline: XecPipeline, prepareScript } = await import('@xec-sh/ops');
      const graph = XecPipeline.create(definition.name);
      for (const step of definition.steps) {
        abort.signal.throwIfAborted();
        const env = stepEnvironment(step, params);
        let target: SSHAdapterOptions | undefined;
        if (step.nodeId && step.nodeId !== 'local') {
          const node = this.nodes?.getNode(step.nodeId);
          if (!node || node.isLocal) throw new Error(`Unknown remote node: ${step.nodeId}`);
          const ssh = await this.nodes!.nodeToSshTarget(node);
          target = { type: 'ssh', ...ssh, username: ssh.username ?? 'root', hostKeyChecking: 'strict' };
        }
        let command: Command;
        if (step.kind === 'xec') {
          const script = await prepareScript(step.run, {
            ...(step.cwd ? { cwd: step.cwd } : {}),
            env,
            params,
            ...(target ? { target } : {}),
          });
          prepared.push(script);
          command = script.command;
        } else
          command = {
            command: step.run,
            shell: true,
            ...(step.cwd ? { cwd: step.cwd } : {}),
            env,
            ...(target ? { adapter: 'ssh', adapterOptions: target } : {}),
          };
        graph.step(step.name, {
          run: command,
          ...(step.dependsOn ? { dependsOn: step.dependsOn } : {}),
          timeout: step.timeout ?? 300_000,
          retry: { maxAttempts: (step.retries ?? 0) + 1 },
          ...(step.condition ? { condition: () => pipelineCondition(step.condition!, params) } : {}),
        });
      }
      abort.signal.throwIfAborted();
      const startedAt = new Date().toISOString();
      const steps: PipelineRunStepResult[] = definition.steps.map((step) => ({
        name: step.name,
        status: 'pending',
        duration: 0,
        kind: step.kind ?? 'shell',
        nodeId: step.nodeId ?? 'local',
        sourceHash: createHash('sha256').update(JSON.stringify(step)).digest('hex'),
      }));
      const run: PipelineRun = {
        id: runId,
        pipelineId: id,
        status: 'running',
        steps,
        startedAt,
        completedAt: null,
        triggeredBy,
        params: Object.fromEntries(Object.keys(params).map((key) => [key, '[provided]'])),
      };
      await this.db
        .insertInto('pipeline_runs')
        .values({
          ...run,
          startedAt: new Date(startedAt),
          steps: JSON.stringify(steps),
          params: JSON.stringify(run.params),
        })
        .execute();
      const secrets = [
        ...new Set([
          ...Object.values(params).filter((value): value is string => typeof value === 'string' && value.length > 0),
          ...Object.entries({ ...process.env, ...Object.assign({}, ...definition.steps.map((step) => step.env)) })
            .filter(([key, value]) => secretKey.test(key) && typeof value === 'string' && value.length > 0)
            .map(([, value]) => value as string),
        ]),
      ].sort((a, b) => b.length - a.length);
      handle.done = this.executeRun(run, graph, abort.signal, secrets, prepared).finally(() =>
        this.activeRuns.delete(runId)
      );
      finishAdmission();
      void handle.done.catch((error) =>
        this.logger.error({ runId, error: redactDiagnosticText(String(error)) }, 'Pipeline journal failed')
      );
      return structuredClone(run);
    } catch (error) {
      this.activeRuns.delete(runId);
      try {
        await Promise.all(prepared.map((script) => script.dispose()));
      } finally {
        finishAdmission();
      }
      throw error;
    }
  }

  private async executeRun(
    run: PipelineRun,
    graph: import('@xec-sh/ops').Pipeline,
    signal: AbortSignal,
    secrets: string[],
    prepared: PreparedScript[]
  ): Promise<void> {
    const safeError = (error: unknown) => {
      const text = new PipelineOutput(secrets);
      text.append(String(error));
      return text.snapshot(true);
    };
    const output = new Map(
      run.steps.map((step) => [step.name, { stdout: new PipelineOutput(secrets), stderr: new PipelineOutput(secrets) }])
    );
    let lastWrite = 0;
    let writes = Promise.resolve();
    const save = () => {
      const snapshot = JSON.stringify(run.steps);
      writes = writes
        .then(() => this.db.updateTable('pipeline_runs').set({ steps: snapshot }).where('id', '=', run.id).execute())
        .then(() => undefined);
      return writes;
    };
    const onEvent = async (event: PipelineEvent) => {
      const step = run.steps.find((item) => item.name === event.step)!;
      const journal = output.get(event.step)!;
      if (event.type === 'step-start') {
        step.status = 'running';
        step.startedAt ??= new Date(event.at).toISOString();
        step.attempts = event.attempt;
      } else if (event.type === 'step-output') {
        journal[event.stream].append(event.text);
        if (Date.now() - lastWrite < 250) return;
        lastWrite = Date.now();
        step.output = journal.stdout.snapshot();
        step.stderr = journal.stderr.snapshot();
      } else {
        const result = event.result;
        if (!journal.stdout.received && result.stdout) journal.stdout.append(result.stdout);
        if (!journal.stderr.received && result.stderr) journal.stderr.append(result.stderr);
        step.status = result.cancelled
          ? 'cancelled'
          : result.skipped
            ? 'skipped'
            : result.success
              ? 'success'
              : 'failed';
        step.completedAt = new Date(event.at).toISOString();
        step.duration = result.duration;
        step.exitCode = result.exitCode;
        if (result.error) {
          const failure = new PipelineOutput(secrets);
          failure.append(result.error);
          step.error = failure.snapshot(true);
        }
        step.output = journal.stdout.snapshot(true);
        step.stderr = journal.stderr.snapshot(true);
        step.outputTruncated = journal.stdout.truncated || journal.stderr.truncated || result.outputTruncated === true;
      }
      await save();
    };
    try {
      const result = await graph.run(
        {},
        { signal, concurrency: PIPELINE_LIMITS.concurrency, outputLimit: PIPELINE_LIMITS.outputBytes, onEvent }
      );
      run.status = result.status;
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed';
      this.logger.error({ runId: run.id, error: safeError(error) }, 'Pipeline execution failed');
      for (const step of run.steps)
        if (step.status === 'pending' || step.status === 'running') {
          step.status = run.status;
          step.error = safeError(error);
        }
    } finally {
      try {
        await Promise.all(prepared.map((script) => script.dispose()));
      } catch (error) {
        run.status = 'failed';
        this.logger.error({ runId: run.id, error: safeError(error) }, 'Pipeline temporary script cleanup failed');
      }
      await writes.catch(() => undefined);
      run.completedAt = new Date().toISOString();
      await this.db
        .updateTable('pipeline_runs')
        .set({ status: run.status, steps: JSON.stringify(run.steps), completedAt: new Date(run.completedAt) })
        .where('id', '=', run.id)
        .execute();
      const duration = Date.parse(run.completedAt) - Date.parse(run.startedAt);
      this.observe?.(run.status, duration);
      this.logger.info(
        { runId: run.id, pipelineId: run.pipelineId, status: run.status, duration },
        'Pipeline execution completed'
      );
    }
  }
  async cancelRun(runId: string): Promise<void> {
    const handle = this.activeRuns.get(runId);
    if (!handle) {
      const run = await this.getRunStatus(runId);
      if (!run) throw new Error(`Run '${runId}' not found`);
      if (live.includes(run.status)) throw new Error('Executor is unavailable; reconcile the daemon before retrying');
      return;
    }
    await this.db
      .updateTable('pipeline_runs')
      .set({ status: 'cancelling' })
      .where('id', '=', runId)
      .where('status', 'in', live)
      .execute();
    handle.abort.abort(new Error('Cancelled by operator'));
    await handle.done;
  }
  async getRunStatus(runId: string): Promise<PipelineRun | null> {
    const row = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', runId).executeTakeFirst();
    return row ? this.mapRun(row) : null;
  }
  async listRuns(pipelineId?: string, limit = 50): Promise<PipelineRunSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Run limit must be between 1 and 200');
    let query = this.db
      .selectFrom('pipeline_runs')
      .select(['id', 'pipelineId', 'status', 'startedAt', 'completedAt', 'triggeredBy'])
      .orderBy('startedAt', 'desc')
      .limit(limit);
    if (pipelineId) query = query.where('pipelineId', '=', pipelineId);
    return (await query.execute()).map((row) => ({
      ...row,
      status: row.status as PipelineRun['status'],
      startedAt: new Date(row.startedAt).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    }));
  }
  private mapPipeline(row: Selectable<PipelinesTable>): Pipeline {
    const definition = {
      ...row,
      steps: (typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps) as unknown as Pipeline['steps'],
      triggers: (typeof row.triggers === 'string'
        ? JSON.parse(row.triggers)
        : row.triggers) as unknown as Pipeline['triggers'],
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
    };
    return { ...definition, revision: createHash('sha256').update(JSON.stringify(definition)).digest('hex') };
  }
  private mapRun(row: Selectable<PipelineRunsTable>): PipelineRun {
    const steps = (typeof row.steps === 'string'
      ? JSON.parse(row.steps)
      : row.steps) as unknown as PipelineRunStepResult[];
    if (row.status === 'interrupted')
      for (const step of steps) if (live.includes(step.status)) step.status = 'interrupted';
    return {
      ...row,
      status: row.status as PipelineRun['status'],
      steps,
      params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params,
      startedAt: new Date(row.startedAt).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    };
  }
}
