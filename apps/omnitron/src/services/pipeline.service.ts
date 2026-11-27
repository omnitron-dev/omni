import { admitPipeline, assertParameters, pipelineAdmissionCheck, readAdmission, readPrepareRun, readStartRun, validateRunId, type PipelineAdmission } from './pipeline-admission.js';
import { completedStep, recoverableStep, recoveryReview } from './pipeline-recovery.js';
import { inspectRecoveryQualification, recoveryQualificationDefinition, requireRecoveryQaEndpoint, isRecoveryQaStep, installedRecoveryCommand,
  type RecoveryQualificationExpected } from './recovery-qualification.js';
import type { InspectPhysicalRestore, PhysicalRestoreEvidence } from '../shared/dto/physical-restore.js';
import { physicalRestoreRequest } from './physical-restore-graph.js';
import { inspectPhysicalRestore, preparePhysicalRehearsal, runPhysicalMigrationTrial } from './physical-restore.js';
import type { MigrationRehearsalPlan, MigrationRehearsalResult, RehearsalCopyPlan, RehearsalCopyReceipt } from '../shared/dto/first-write.js';
import { pipelineWorkspaceQueries, pinnedPipelineDefinition } from './pipeline-workspace.js';
import { buildIssuerDigest, buildJournalReceipt, deploymentBuildArgs, deploymentBuildInput, readActivity } from './deployment-build-pipeline.js';
import { RecoveryMutation } from '../daemon/recovery-state.js';
/** Durable control-plane state over Xec's execution, graph and cancellation contracts. */
import { randomUUID, createHash } from 'node:crypto';
import { sql, type Kysely, type RawBuilder, type Selectable } from 'kysely';
import type { Command, SSHAdapterOptions } from '@xec-sh/core';
import type { PipelineEvent, PreparedScript } from '@xec-sh/ops';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { redactDiagnosticText } from '@omnitron-dev/titan/diagnostics';
import type { OmnitronDatabase, PipelinesTable, PipelineRunsTable } from '../database/schema.js';
import { sshConfig } from '../execution/execution.service.js';
import type { NodeManagerService } from './node-manager.service.js';
import type { ProjectService } from './project.service.js';
import {
  PIPELINE_LIMITS,
  pipelineCondition,
  stepEnvironment,
  checkPipelineDefinition,
  storedDefinition,
  validatePipelineParams,
} from './pipeline-definition.js';
import type {
  PipelineDef,
  Pipeline,
  PipelineRunStepResult,
  PipelineRun,
  PipelineRunSummary,
  PipelineWorkspace,
  PipelineWorkspaceHistory,
  DeploymentPipelineActivity,
  PipelineReleaseExecution,
  PreparePipelineRun,
  StartPipelineRun,
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
  projects: string[];
  pipelineId: string;
  abort: AbortController;
  done: Promise<void>;
}
interface PipelineCompletion {
  admission: string;
  status: PipelineRun['status'];
  steps: string;
  completedAt: Date;
}
type Nodes = Pick<NodeManagerService, 'getNode' | 'nodeToSshTarget'>;
interface DeploymentBinding { operation: Awaited<ReturnType<ProjectService['resolvePipelineDeployment']>>; run(): Promise<void> }
type ReleaseOperation = Awaited<ReturnType<ProjectService['resolvePipelineRelease']>>;
type PipelineProjects = Pick<ProjectService, 'resolvePipelineRelease'> & Partial<Pick<ProjectService, 'resolvePipelineDeployment' | 'inspectPipelineDeployment' | 'projectConfigurations'>>;
interface ReleaseCommand {
  name: string;
  operation: ReleaseOperation;
  evidence?: PipelineReleaseExecution;
  spawned: boolean;
  unconfirmed: boolean;
}
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
  private readonly physicalInspections = new Map<string, { abort: AbortController; done: Promise<PhysicalRestoreEvidence> }>();
  private readonly rehearsalCopies = new Map<string, { digest: string; abort: AbortController; done: Promise<RehearsalCopyReceipt> }>();
  private readonly migrationTrials = new Map<string, { review: string; readOnly: boolean; abort: AbortController; done: Promise<MigrationRehearsalResult> }>();
  private readonly activeRuns = new Map<string, ActiveRun>();
  private readonly historicRehearsals = new Map<string, DeploymentPipelineActivity>();
  private readonly pendingCompletions = new Map<string, PipelineCompletion>();
  private initialization: Promise<void> | undefined;
  private stopped = false;
  private nodes?: Nodes;
  private projects: PipelineProjects | undefined;
  private assertLifecycle: (() => void | Promise<void>) | undefined;
  private observe: ((status: PipelineRun['status'], duration: number) => void) | undefined;
  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly logger: ILogger,
    private readonly execution: import('../execution/execution.service.js').ExecutionService,
  ) {}

  configure(nodes: Nodes, observe?: (status: PipelineRun['status'], duration: number) => void,
    releases?: { projects: PipelineProjects; assertLifecycle(): void | Promise<void> }): void {
    this.nodes = nodes;
    this.observe = observe;
    this.projects = releases?.projects;
    this.assertLifecycle = releases?.assertLifecycle;
  }
  async initialize(): Promise<void> {
    this.initialization ??= this.db.transaction().execute(async trx => {
      const prior = await trx.selectFrom('pipeline_runs').select(['id', 'admission'])
        .where(sql<boolean>`admission ->> 'activity' IS NULL AND ${pinnedPipelineDefinition(this.db)} ->> 'name' LIKE 'recovery-qualification-%'`).execute();
      for (const row of prior) {
        try {
          const admission = readAdmission(row.admission);
          if (!admission?.definition) continue;
          const pinned = JSON.parse(admission.definition) as Pipeline;
          const step = pinned.steps.length === 1 && pinned.steps[0];
          if (step && isRecoveryQaStep(step)) {
            const evidence = await installedRecoveryCommand(step);
            this.historicRehearsals.set(row.id, rehearsalActivity(evidence.spec));
          }
        } catch {
          // A differently versioned verifier stays accessible through the original reviewed run ID.
          this.logger.debug({ runId: row.id }, 'Historical recovery graph has no independently readable scope');
        }
      }
      const unfinished = await trx.selectFrom('pipeline_runs').selectAll().where('status', 'in', live).execute();
      for (const row of unfinished) {
        const run = this.mapRun(row);
        for (const step of run.steps) {
          if (live.includes(step.status)) step.status = 'interrupted';
          // Spawn and its acknowledgement cannot be one database transaction.
          // A prepared record therefore does not prove that effects never began.
          for (const attempt of step.executions ?? [])
            if (attempt.state === 'prepared' || attempt.state === 'started') attempt.state = 'unconfirmed';
        }
        await trx.updateTable('pipeline_runs').set({ status: 'interrupted', steps: JSON.stringify(run.steps), completedAt: new Date() })
          .where('id', '=', row.id).where('status', 'in', live).execute();
      }
    }).catch(error => {
      this.initialization = undefined;
      throw error;
    });
    return this.initialization;
  }
  async dispose(): Promise<void> {
    this.stopped = true;
    for (const inspection of this.physicalInspections.values()) inspection.abort.abort(new Error('Daemon is stopping'));
    for (const copy of this.rehearsalCopies.values()) copy.abort.abort(new Error('Daemon is stopping'));
    for (const trial of this.migrationTrials.values()) trial.abort.abort(new Error('Daemon is stopping'));
    for (const run of this.activeRuns.values()) run.abort.abort(new Error('Daemon is stopping'));
    await Promise.allSettled([...this.physicalInspections.values()].map(inspection => inspection.done));
    await Promise.allSettled([...this.rehearsalCopies.values()].map(copy => copy.done));
    await Promise.allSettled([...this.migrationTrials.values()].map(trial => trial.done));
    while (this.activeRuns.size) await Promise.allSettled([...this.activeRuns.values()].map((run) => run.done));
  }
  async createPipeline(def: PipelineDef): Promise<Pipeline> {
    await checkPipelineDefinition(def);
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
  async updatePipeline(id: string, def: PipelineDef, expectedRevision: string): Promise<Pipeline> {
    if (!/^[a-f0-9]{64}$/.test(expectedRevision ?? ''))
      throw new Error('Review the current definition before updating it');
    await checkPipelineDefinition(def);
    return this.db.transaction().execute(async (trx) => {
      const current = await trx.selectFrom('pipelines').selectAll().where('id', '=', id)
        .forUpdate().executeTakeFirst();
      if (!current) throw new Error(`Pipeline '${id}' not found`);
      if (this.mapPipeline(current).revision !== expectedRevision)
        throw new Error('Pipeline changed after review. Reload and review the current definition');
      const row = await trx.updateTable('pipelines').set({
        name: def.name.trim(),
        description: def.description ?? null,
        steps: JSON.stringify(def.steps),
        triggers: JSON.stringify(def.triggers ?? []),
        updatedAt: new Date(Math.max(Date.now(), new Date(current.updatedAt).getTime() + 1)),
      }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
      return this.mapPipeline(row);
    });
  }
  async getPipeline(id: string, workspace?: PipelineWorkspace): Promise<Pipeline | null> {
    let query = this.db.selectFrom('pipelines').selectAll().where('id', '=', id);
    if (workspace !== undefined) query = query.where(this.workspaceQueries(workspace).definitions);
    const row = await query.executeTakeFirst();
    return row ? this.mapPipeline(row) : null;
  }
  async listPipelines(filter?: RawBuilder<boolean>): Promise<Pipeline[]> {
    let query = this.db.selectFrom('pipelines').selectAll().orderBy('createdAt', 'desc');
    if (filter) query = query.where(filter);
    return (await query.execute()).map(row => this.mapPipeline(row));
  }
  private workspaceQueries(workspace: PipelineWorkspace) {
    if (typeof workspace?.project !== 'string' || !workspace.project ||
      (workspace.stack !== undefined && (typeof workspace.stack !== 'string' || !workspace.stack)))
      throw Error('Select a project and an optional stack for pipeline history');
    if (!this.projects?.projectConfigurations) throw Error('Project inventory is unavailable');
    return pipelineWorkspaceQueries(this.db, workspace, this.projects.projectConfigurations(workspace.project), this.historicRehearsals);
  }
  async listWorkspace(workspace: PipelineWorkspaceHistory) {
    const filters = this.workspaceQueries(workspace);
    if (workspace.activityOnly === true) {
      if (workspace.activityRunId !== undefined) validateRunId(workspace.activityRunId);
      return { definitions: [], runs: await this.listRuns(undefined, workspace.limit, { name: filters.name, runs: filters.activity }, workspace.activityRunId) };
    }
    const [definitions, runs] = await Promise.all([
      this.listPipelines(filters.definitions), this.listRuns(undefined, workspace.limit, filters),
    ]);
    return { definitions, runs };
  }
  async deletePipeline(id: string): Promise<void> {
    if ([...this.activeRuns.values()].some((run) => run.pipelineId === id))
      throw new Error('Stop active runs before deleting a pipeline');
    await this.db.transaction().execute(async (trx) => {
      const pending = await trx.selectFrom('pipeline_runs').select('id').where('pipelineId', '=', id)
        .where('status', 'in', ['awaiting-review', ...live]).executeTakeFirst();
      if (pending) throw new Error('Cancel outstanding requests before deleting a pipeline');
      await trx.deleteFrom('pipeline_runs').where('pipelineId', '=', id).execute();
      await trx.deleteFrom('pipelines').where('id', '=', id).execute();
    });
  }

  /** Durable intent and the ready-to-start record are one database insertion.
   * An awaiting review consumes no worker slot and survives daemon recovery. */
  @RecoveryMutation()
  async prepareRun(request: PreparePipelineRun, actor: string): Promise<PipelineRun> {
    await this.initialize();
    if (this.stopped) throw new Error('Pipeline executor is stopping');
    request = readPrepareRun(request);
    const params = request.params ?? {};
    validatePipelineParams(params);
    const existing = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', request.runId).executeTakeFirst();
    if (existing) return this.matchRequest(existing, request, actor);
    await this.assertLifecycle?.();
    const definition = await this.getPipeline(request.id);
    if (!definition) throw new Error(`Pipeline '${request.id}' not found`);
    if (definition.revision !== request.expectedRevision)
      throw new Error('Pipeline changed after review. Reload and review the current definition');
    await checkPipelineDefinition(storedDefinition(definition));
    const admission = admitPipeline(request.runId, definition, params, actor);
    const singleStep = definition.steps.length === 1 && definition.steps[0];
    if (singleStep && !Object.keys(params).length) {
      if (isRecoveryQaStep(singleStep)) {
        const inspected = await installedRecoveryCommand(singleStep).catch(() => undefined);
        const spec = inspected?.spec;
        if (spec) admission.activity = rehearsalActivity(spec);
      } else {
        const build = deploymentBuildInput(singleStep);
        if (build) {
          const issuer = this.nodes?.getNode(build.nodeId);
          if (!issuer) throw Error('Build issuer is not registered on this controller');
          admission.buildIssuer = buildIssuerDigest(issuer, await this.nodes!.nodeToSshTarget(issuer));
          admission.review.digest = createHash('sha256').update(JSON.stringify([admission.review.digest, admission.buildIssuer])).digest('hex');
          admission.activity = build;
        }
      }
    }
    pipelineAdmissionCheck.getStore()?.();
    const inserted = await this.db.insertInto('pipeline_runs').values({
      id: request.runId, pipelineId: request.id, status: 'awaiting-review',
      steps: JSON.stringify(definition.steps.map(step => ({ name: step.name, status: 'pending', duration: 0,
        kind: step.kind ?? 'shell', nodeId: step.nodeId ?? 'local',
        sourceHash: createHash('sha256').update(JSON.stringify(step)).digest('hex') }))),
      startedAt: new Date(), completedAt: null, triggeredBy: actor,
      params: JSON.stringify(Object.fromEntries(Object.keys(params).map(key => [key, '[provided]']))),
      admission: JSON.stringify(admission),
    }).onConflict(conflict => conflict.column('id').doNothing()).returningAll().executeTakeFirst();
    const recorded = inserted ?? await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', request.runId).executeTakeFirstOrThrow();
    return this.matchRequest(recorded, request, actor);
  }

  private matchRequest(row: Selectable<PipelineRunsTable>, request: PreparePipelineRun, actor: string): PipelineRun {
    const admission = readAdmission(row.admission);
    if (row.pipelineId !== request.id || row.triggeredBy !== actor ||
      admission?.review.definitionRevision !== request.expectedRevision)
      throw new Error('Run ID already belongs to another pipeline command');
    assertParameters(admission, request.params ?? {});
    return this.mapRun(row, admission);
  }

  /** Immediate execution uses exactly the same admission/start path as reviewed runs. */
  async executePipeline(id: string, params: Record<string, unknown> = {}, triggeredBy = 'system',
    expectedRevision?: string, runId: string = randomUUID()): Promise<PipelineRun> {
    const revision = expectedRevision ?? (await this.getPipeline(id))?.revision;
    const prepared = await this.prepareRun({ runId, id, expectedRevision: revision ?? '', params }, triggeredBy);
    return this.startRun({ runId, expectedDigest: prepared.review!.digest, params }, triggeredBy);
  }

  @RecoveryMutation()
  async startRun(request: StartPipelineRun, actor: string): Promise<PipelineRun> {
    return this.claimRun(request, actor, false);
  }

  /** Resume the exact observed checkpoint, never repeat an uncertain command. */
  @RecoveryMutation()
  async resumeRun(request: StartPipelineRun, actor: string): Promise<PipelineRun> {
    return this.claimRun(request, actor, true);
  }

  @RecoveryMutation()
  async reconcileRun(runId: string): Promise<PipelineRun> {
    await this.initialize();
    if (this.activeRuns.has(runId)) throw Error('Wait for the current executor before reconciling');
    await this.flushCompletion(runId);
    const row = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    if (!['interrupted', 'failed'].includes(row.status)) return this.mapRun(row);
    const run = this.mapRun(row);
    for (const step of run.steps) {
      if (completedStep(step) || !step.deployment) continue;
      if (!this.projects?.inspectPipelineDeployment) throw Error('Deployment inspection is unavailable');
      // Errors leave the original unknown outcome intact. Inspection grants no dispatch authority.
      const observation = await this.projects.inspectPipelineDeployment(step.deployment);
      step.deployment.observation = observation;
      step.deployment.state = observation?.confirmed ? 'confirmed' : 'unconfirmed';
      if (observation?.confirmed) {
        step.status = 'success'; step.exitCode = 0; step.completedAt = observation.observedAt;
        delete step.error;
      }
    }
    const updated = await this.db.updateTable('pipeline_runs').set({ steps: JSON.stringify(run.steps) })
      .where('id', '=', runId).where('status', '=', row.status).where(sql<boolean>`steps = ${typeof row.steps === 'string' ? row.steps : JSON.stringify(row.steps)}`).executeTakeFirst();
    if (updated.numUpdatedRows !== 1n) throw Error('Run changed during reconciliation; inspect its current receipt');
    return (await this.getRunStatus(runId))!;
  }

  private async claimRun(request: StartPipelineRun, actor: string, recovering: boolean): Promise<PipelineRun> {
    await this.initialize();
    request = readStartRun(request);
    const { runId } = request, params = request.params ?? {};
    await this.flushCompletion(runId);
    const row = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
    const admission = readAdmission(row.admission);
    if (!admission) throw new Error('Run has no durable admission');
    assertParameters(admission, params);
    const checkpoint = this.mapRun(row, admission);
    const pinned: Pipeline | undefined = admission.definition ? JSON.parse(admission.definition) : undefined;
    if (recovering) {
      if (admission.resumedFrom === request.expectedDigest) return checkpoint;
      if (!admission.definition || !['interrupted', 'failed'].includes(row.status) || recoveryReview(checkpoint).digest !== request.expectedDigest)
        throw Error('Review the current recoverable checkpoint before resuming');
      if (checkpoint.steps.length !== pinned!.steps.length || pinned!.steps.some(step =>
        checkpoint.steps.find(saved => saved.name === step.name)?.sourceHash !== createHash('sha256').update(JSON.stringify(step)).digest('hex')))
        throw Error('Checkpoint differs from its pinned graph');
      if (recoveryReview(checkpoint).blocked.length) throw Error('Unconfirmed or failed steps block continuation; reconcile receiver evidence first');
    } else if (admission.review.digest !== request.expectedDigest) throw Error('Review the exact pipeline admission before starting it');
    // Terminal and in-flight receipts are authoritative. Redelivery never creates
    // another execution, even after a lost reply or a daemon restart.
    if (!recovering && row.status !== 'awaiting-review') return checkpoint;
    if (this.activeRuns.has(runId)) return this.mapRun(row);
    if (this.stopped) throw new Error('Pipeline executor is stopping');
    if (this.activeRuns.size >= PIPELINE_LIMITS.activeRuns) throw new Error('Pipeline execution capacity reached');
    const projects = admission.review.projects.length ? admission.review.projects.map(project => `project:${project}`) : ['unscoped'];
    for (const project of projects)
      if ([...this.activeRuns.values()].filter(run => run.projects.includes(project)).length >= PIPELINE_LIMITS.projectRuns)
        throw new Error(`Pipeline execution capacity reached for ${project}`);
    // Reserve synchronously before any await. Waiting for human review never
    // occupies capacity, and one project cannot consume all daemon slots.
    const abort = new AbortController();
    let finishAdmission!: () => void;
    const admitted = new Promise<void>((resolve) => {
      finishAdmission = resolve;
    });
    const handle: ActiveRun = { pipelineId: row.pipelineId, projects, abort, done: admitted };
    this.activeRuns.set(runId, handle);
    const prepared: PreparedScript[] = [];
    const commands = new Map<NonNullable<Command['onSpawn']>, ReleaseCommand | null>();
    let executionAdmission: string | undefined;
    try {
      await this.assertLifecycle?.();
      const definition = recovering ? pinned : await this.getPipeline(row.pipelineId);
      if (!definition) throw new Error(`Pipeline '${row.pipelineId}' not found`);
      if (admission.review.definitionRevision !== definition.revision)
        throw new Error('Pipeline changed after review. Reload and review the current definition');
      await checkPipelineDefinition(storedDefinition(definition));
      const startedAt = new Date();
      pipelineAdmissionCheck.getStore()?.();
      executionAdmission = JSON.stringify({ ...admission, approvedBy: actor, executionId: randomUUID(),
        ...(recovering ? { resumedFrom: request.expectedDigest } : {}) });
      const claim = await this.db.updateTable('pipeline_runs').set({ status: 'running', startedAt,
        completedAt: null, admission: executionAdmission })
        .where('id', '=', runId).where('status', '=', row.status).where(sql<boolean>`steps = ${typeof row.steps === 'string' ? row.steps : JSON.stringify(row.steps)}`).executeTakeFirst();
      if (claim.numUpdatedRows !== 1n) {
        this.activeRuns.delete(runId);
        finishAdmission();
        const current = await this.getRunStatus(runId);
        if (!current) throw new Error('Pipeline request was removed before admission');
        return current;
      }
      this.logger.info({ runId, actor, projects }, 'Reviewed pipeline admitted');
      const { Pipeline: XecPipeline, prepareScript } = await import('@xec-sh/ops');
      const graph = XecPipeline.create(definition.name);
      const run = checkpoint;
      run.status = 'running'; run.startedBy = actor; run.startedAt = startedAt.toISOString(); run.completedAt = null;
      delete run.recovery;
      const completed = new Set(recovering ? run.steps.filter(completedStep).map(step => step.name) : []);
      if (recovering) for (const step of run.steps) if (recoverableStep(step)) {
        step.status = 'pending'; delete step.error; delete step.completedAt;
      }
      const deployments = new Map<string, DeploymentBinding>();
      for (const step of definition.steps) {
        if (completed.has(step.name)) continue;
        abort.signal.throwIfAborted();
        const dependencies = step.dependsOn?.filter(name => !completed.has(name));
        const qualification = isRecoveryQaStep(step) ? await installedRecoveryCommand(step) : undefined;
        if (step.kind === 'deploy') {
          if (!this.projects?.resolvePipelineDeployment) throw Error('Native deployment admission is unavailable');
          const operation = await this.projects.resolvePipelineDeployment(step.target);
          const binding: DeploymentBinding = { operation, run: async () => { throw Error('Deployment journal is not bound'); } };
          deployments.set(step.name, binding);
          // Xec function steps await the ordinary ProjectService operation. Cancellation
          // stops subsequent steps; it does not pretend to undo a dispatched deployment.
          graph.step(step.name, { run: () => binding.run(), ...(dependencies ? { dependsOn: dependencies } : {}),
            ...(step.condition ? { condition: () => pipelineCondition(step.condition!, params) } : {}) });
          continue;
        }
        const env = stepEnvironment(step, params);
        let target: SSHAdapterOptions | undefined;
        if (step.nodeId && step.nodeId !== 'local') {
          const node = this.nodes?.getNode(step.nodeId);
          if (!node || node.isLocal) throw new Error(`Unknown remote node: ${step.nodeId}`);
          const ssh = await this.nodes!.nodeToSshTarget(node);
          if (admission.activity?.kind === 'build' && admission.buildIssuer !== buildIssuerDigest(node, ssh))
            throw Error('Build issuer changed since the Pipeline admission');
          if (qualification) await requireRecoveryQaEndpoint(step, node, ssh, qualification.spec.nodeId, this.nodes!);
          target = { type: 'ssh', ...sshConfig(ssh) };
        }
        let command: Command;
        if (qualification) {
          if (!target || Object.keys(params).length) throw Error('Recovery qualification requires the fixed remote QA admission');
          command = { command: qualification.command, args: qualification.args, shell: false, adapter: 'ssh', adapterOptions: target };
        } else if (admission.activity?.kind === 'build') {
          if (!target || !deploymentBuildInput(step)) throw Error('Release build requires the admitted native issuer command');
          command = { command: 'omnitron', args: deploymentBuildArgs(admission.activity), shell: false, adapter: 'ssh', adapterOptions: target };
        } else if (step.kind === 'release') {
          if (!this.projects || !this.assertLifecycle) throw new Error('Release pipeline admission is unavailable on this daemon');
          const operation = await this.projects.resolvePipelineRelease(step.target, {
            ...(step.cwd ? { cwd: step.cwd } : {}), ...(step.args ? { args: step.args } : {}), env,
          });
          const binding: ReleaseCommand = { name: step.name, operation, spawned: false, unconfirmed: false };
          // Xec preserves this ordinary Command callback in every attempt. Its
          // identity correlates equal commands without argv guesses or global state.
          const onSpawn: NonNullable<Command['onSpawn']> = child => {
            binding.spawned = true;
            if (child.pid) binding.evidence!.pid = child.pid;
            binding.evidence!.state = 'started';
          };
          commands.set(onSpawn, binding);
          command = { ...operation.command, onSpawn };
        } else if (step.kind === 'xec') {
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
        if (step.kind !== 'release') {
          const original = command.onSpawn;
          const onSpawn: NonNullable<Command['onSpawn']> = child => original?.(child);
          commands.set(onSpawn, null);
          command = { ...command, onSpawn };
        }
        graph.step(step.name, {
          run: command,
          ...(dependencies ? { dependsOn: dependencies } : {}),
          timeout: step.timeout ?? 300_000,
          retry: { maxAttempts: (step.retries ?? 0) + 1 },
          ...(step.condition ? { condition: () => pipelineCondition(step.condition!, params) } : {}),
        });
      }
      abort.signal.throwIfAborted();
      await this.assertLifecycle?.();
      const secrets = [
        ...new Set([
          ...Object.values(params).filter((value): value is string => typeof value === 'string' && value.length > 0),
          ...[process.env, ...definition.steps.map((step) => step.env),
            ...[...commands.values()].flatMap(binding => binding ? [binding.operation.command.env] : [])].flatMap(env => Object.entries(env ?? {}))
            .filter(([key, value]) => secretKey.test(key) && typeof value === 'string' && value.length > 0)
            .map(([, value]) => value as string),
        ]),
      ].sort((a, b) => b.length - a.length);
      handle.done = this.executeRun(run, executionAdmission, graph, abort.signal, secrets, prepared, commands, deployments).finally(() =>
        this.activeRuns.delete(runId)
      );
      finishAdmission();
      void handle.done.catch((error) =>
        this.logger.error({ runId, error: redactDiagnosticText(String(error)) }, 'Pipeline journal failed')
      );
      return structuredClone(run);
    } catch (error) {
      try {
        if (executionAdmission) {
          const failure = new PipelineOutput(Object.values(params).filter((value): value is string => typeof value === 'string' && value.length > 0));
          failure.append(String(error));
          const status = abort.signal.aborted ? 'cancelled' : 'failed';
          const steps = this.mapRun(row).steps.map(step => completedStep(step) ? step : ({ ...step, status, error: failure.snapshot(true) }));
          await this.completeRun(runId, { admission: executionAdmission, status, steps: JSON.stringify(steps), completedAt: new Date() });
        }
      } finally {
        try { await Promise.all(prepared.map((script) => script.dispose())); }
        finally { this.activeRuns.delete(runId); finishAdmission(); }
      }
      throw error;
    }
  }

  private async executeRun(
    run: PipelineRun,
    executionAdmission: string,
    graph: import('@xec-sh/ops').Pipeline,
    signal: AbortSignal,
    secrets: string[],
    prepared: PreparedScript[],
    commands: Map<NonNullable<Command['onSpawn']>, ReleaseCommand | null>,
    deployments: Map<string, DeploymentBinding>,
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
    for (const [name, binding] of deployments) binding.run = async () => {
      const step = run.steps.find(item => item.name === name)!;
      step.deployment = structuredClone(binding.operation.evidence);
      await save();
      await this.assertLifecycle?.();
      signal.throwIfAborted();
      try {
        await binding.operation.execute();
        const observation = await this.projects!.inspectPipelineDeployment!(step.deployment);
        step.deployment.observation = observation;
        if (!observation?.confirmed) throw Error('Deployment returned without matching launch receipts on every expected placement');
        step.deployment.state = 'confirmed';
        await save();
      } catch (error) {
        step.deployment.state = 'unconfirmed';
        await save();
        throw error;
      }
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
        if (result.success && run.activity?.kind === 'build') {
          const receipt = buildJournalReceipt(step.output, run.activity);
          if (receipt) step.releaseBuild = receipt;
        }
        step.outputTruncated = journal.stdout.truncated || journal.stderr.truncated || result.outputTruncated === true;
      }
      await save();
    };
    // Xec retains ownership of streams, output limits, retry and cancellation.
    // Its execute hook fences the exact Command before each ordinary attempt.
    const execute = async (command: Command) => {
      await this.assertLifecycle?.();
      command.signal?.throwIfAborted();
      if (!command.onSpawn || !commands.has(command.onSpawn)) throw Error('Xec did not retain the admitted pipeline command binding');
      const binding = commands.get(command.onSpawn);
      if (!binding) {
        const result = await this.execution.execute(command);
        if (run.activity?.kind === 'build' && result.exitCode === 0 && !buildJournalReceipt(result.stdout, run.activity))
          throw Error('Issuer returned without a manifest receipt matching the reviewed build; inspect the issuer before retrying');
        return result;
      }
      if (binding.unconfirmed) throw new Error('Prior release execution is unconfirmed; inspect its evidence before retrying');
      const { operation } = binding;
      const step = run.steps.find(item => item.name === binding.name)!;
      binding.spawned = false;
      binding.evidence = { ...structuredClone(operation.evidence), attempt: step.attempts!, state: 'prepared' };
      (step.executions ??= []).push(binding.evidence);
      await save();
      await operation.verify();
      await this.assertLifecycle?.();
      command.signal?.throwIfAborted();
      try {
        const result = await this.execution.execute(command);
        // A changed owner after effects is an unconfirmed attempt, never a
        // successful receipt or a reason to run those effects again automatically.
        await operation.verify();
        binding.evidence.state = 'completed';
        await save();
        return result;
      } catch (error) {
        if (binding.spawned) { binding.unconfirmed = true; binding.evidence.state = 'unconfirmed'; }
        throw error;
      } finally {
        // A failed completion write must not escape the catch and let Xec retry
        // already executed effects. A failed journal stays failed, not repaired
        // by silently dropping the rejected write from its queue.
        if (binding.evidence.state !== 'completed') await save();
      }
    };
    try {
      const result = await graph.run(
        {},
        { signal, concurrency: PIPELINE_LIMITS.concurrency, outputLimit: PIPELINE_LIMITS.outputBytes, onEvent,
          execute }
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
      await this.completeRun(run.id, { admission: executionAdmission, status: run.status,
        steps: JSON.stringify(run.steps), completedAt: new Date(run.completedAt) });
      const duration = Date.parse(run.completedAt) - Date.parse(run.startedAt);
      this.observe?.(run.status, duration);
      this.logger.info(
        { runId: run.id, pipelineId: run.pipelineId, status: run.status, duration },
        'Pipeline execution completed'
      );
    }
  }
  private async completeRun(runId: string, completion: PipelineCompletion): Promise<void> {
    this.pendingCompletions.set(runId, completion);
    await this.flushCompletion(runId);
  }
  private async flushCompletion(runId: string): Promise<void> {
    const receipt = this.pendingCompletions.get(runId);
    if (!receipt) return;
    const { admission, ...result } = receipt;
    // A retry may follow a lost acknowledgement or a newer execution of the same run.
    // Only the process that claimed this attempt may finish its journal.
    await this.db.updateTable('pipeline_runs').set(result).where('id', '=', runId)
      .where('status', 'in', ['running', 'cancelling']).where(sql<boolean>`admission = ${admission}`).execute();
    if (this.pendingCompletions.get(runId) === receipt) this.pendingCompletions.delete(runId);
  }
  async cancelRun(runId: string): Promise<void> {
    const handle = this.activeRuns.get(runId);
    if (!handle) {
      const run = await this.getRunStatus(runId);
      if (!run) throw new Error(`Run '${runId}' not found`);
      if (run.status === 'awaiting-review') {
        const cancelled = await this.db.updateTable('pipeline_runs').set({ status: 'cancelled', completedAt: new Date() })
          .where('id', '=', runId).where('status', '=', 'awaiting-review').executeTakeFirst();
        if (cancelled.numUpdatedRows === 1n) return;
        await this.cancelRun(runId);
        return;
      }
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
  async inspectPhysicalRestore(request: InspectPhysicalRestore): Promise<PhysicalRestoreEvidence> {
    physicalRestoreRequest(request);
    if (this.stopped) throw Error('Daemon is stopping');
    request = { project: request.project, stack: request.stack, verifyRunId: request.verifyRunId };
    const key = JSON.stringify([request.verifyRunId, request.project, request.stack]);
    const active = this.physicalInspections.get(key);
    if (active) return active.done;
    if (this.physicalInspections.size >= 2) throw Error('Two physical restore observations are already running');
    const abort = new AbortController();
    const done = this.physicalRun(request).then(({ definition, run, nodes }) => inspectPhysicalRestore(request, definition, run, nodes, this.execution, abort.signal))
      .finally(() => this.physicalInspections.delete(key));
    this.physicalInspections.set(key, { abort, done });
    return done;
  }
  /** Internal. The project service derives the entire plan from its refreshed, approved sources and current physical proof. */
  async prepareRehearsalCopy(plan: RehearsalCopyPlan, previous?: RehearsalCopyReceipt): Promise<RehearsalCopyReceipt> {
    await this.assertLifecycle?.();
    if (this.stopped) throw Error('The controller is stopping');
    const active = this.rehearsalCopies.get(plan.receiver.nodeId);
    if (active) {
      if (active.digest !== plan.digest) throw Error('Another rehearsal owns this receiver');
      return active.done;
    }
    const abort = new AbortController();
    const done = this.physicalRun(plan).then(({ definition, run, nodes }) => preparePhysicalRehearsal(plan, previous, definition, run, nodes, this.execution, abort.signal))
      .finally(() => this.rehearsalCopies.delete(plan.receiver.nodeId));
    this.rehearsalCopies.set(plan.receiver.nodeId, { digest: plan.digest, abort, done });
    return done;
  }

  private async physicalRun(request: InspectPhysicalRestore) {
    return this.approvedRun(request.verifyRunId);
  }

  private async approvedRun(runId: string) {
    await this.flushCompletion(runId);
    const row = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', runId).executeTakeFirst();
    const admission = row && readAdmission(row.admission);
    if (!row || !admission?.approvedBy || !admission.definition || !this.nodes)
      throw Error('A pinned and approved native verification and registered nodes are required');
    assertParameters(admission, {});
    return { definition: JSON.parse(admission.definition) as Pipeline, run: this.mapRun(row, admission), nodes: this.nodes, admission };
  }

  recoveryQualificationDefinition(expected: RecoveryQualificationExpected, qaNodeId: string): Promise<PipelineDef> {
    if (!this.nodes) throw Error('Recovery qualification requires registered nodes');
    return recoveryQualificationDefinition(expected, qaNodeId, this.nodes);
  }

  async inspectRecoveryQualification(runId: string, expected: RecoveryQualificationExpected): Promise<string> {
    const { definition, run, nodes, admission } = await this.approvedRun(runId);
    if (admission.resumedFrom) throw Error('Recovery qualification requires an uninterrupted approved rehearsal');
    return inspectRecoveryQualification(runId, expected, definition, run, nodes);
  }

  async rehearsePrivateMigrations(plan: MigrationRehearsalPlan, archive: string, readOnly: boolean, runtime: () => Promise<number>): Promise<MigrationRehearsalResult> {
    await this.assertLifecycle?.();
    if (this.stopped) throw Error('The controller is stopping');
    const key = plan.copy.receiver.nodeId;
    const active = this.migrationTrials.get(key);
    if (active) {
      if (active.review !== plan.digest) throw Error('Another migration rehearsal owns this receiver');
      if (active.readOnly && !readOnly) {
        await active.done;
        return this.rehearsePrivateMigrations(plan, archive, false, runtime);
      }
      return active.done;
    }
    const abort = new AbortController();
    const done = this.physicalRun(plan.copy).then(({ definition, run, nodes }) =>
      runPhysicalMigrationTrial(plan, archive, readOnly, runtime, definition, run, nodes, this.execution, abort.signal))
      .finally(() => this.migrationTrials.delete(key));
    this.migrationTrials.set(key, { review: plan.digest, readOnly, abort, done });
    return done;
  }
  async getRunStatus(runId: string): Promise<PipelineRun | null> {
    await this.flushCompletion(runId);
    const row = await this.db.selectFrom('pipeline_runs').selectAll().where('id', '=', runId).executeTakeFirst();
    return row ? this.mapRun(row) : null;
  }
  async listRuns(pipelineId?: string, limit = 50, workspace?: Pick<ReturnType<typeof pipelineWorkspaceQueries>, 'runs' | 'name'>,
    activityRunId?: string): Promise<PipelineRunSummary[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Run limit must be between 1 and 200');
    for (const runId of this.pendingCompletions.keys()) await this.flushCompletion(runId);
    const name = workspace?.name ?? sql<null>`NULL`;
    let query = this.db
      .selectFrom('pipeline_runs')
      .select(['id', 'pipelineId', 'status', 'startedAt', 'completedAt', 'triggeredBy'])
      .select(name.as('pipelineName'))
      .select(sql<string | null>`admission ->> 'activity'`.as('activityJson'))
      .select(sql<string | null>`steps -> 0 ->> 'releaseBuild'`.as('buildReceipt'))
      .$if(activityRunId !== undefined, q => q.orderBy(sql<boolean>`id = ${activityRunId}`, 'desc'))
      .orderBy('startedAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit);
    if (pipelineId) query = query.where('pipelineId', '=', pipelineId);
    if (workspace) query = query.where(workspace.runs);
    return (await query.execute()).map(({ pipelineName, activityJson, buildReceipt, ...row }) => {
      const activity = readActivity(activityJson && JSON.parse(activityJson), buildReceipt && JSON.parse(buildReceipt)) ?? this.historicRehearsals.get(row.id);
      return {
        ...row,
        ...(activity && { activity }),
        ...(pipelineName ? { pipelineName } : {}),
        status: row.status as PipelineRun['status'],
        startedAt: new Date(row.startedAt).toISOString(),
        completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
      };
    });
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
    return { ...definition, revision: createHash('sha256').update(JSON.stringify(definition)).digest('hex'), conditionalUpdates: true };
  }
  private mapRun(row: Selectable<PipelineRunsTable>, admission: PipelineAdmission | undefined = readAdmission(row.admission)): PipelineRun {
    const steps = structuredClone(typeof row.steps === 'string'
      ? JSON.parse(row.steps)
      : row.steps) as unknown as PipelineRunStepResult[];
    if (row.status === 'interrupted')
      for (const step of steps) if (live.includes(step.status)) step.status = 'interrupted';
    const activity = admission?.activity ?? this.historicRehearsals.get(row.id);
    return {
      id: row.id, pipelineId: row.pipelineId, triggeredBy: row.triggeredBy,
      ...(admission ? { review: admission.review } : {}),
      ...(activity && { activity: { ...activity, ...steps[0]?.releaseBuild } }),
      ...(admission?.approvedBy ? { startedBy: admission.approvedBy } : {}),
      ...(admission?.definition && ['failed', 'interrupted'].includes(row.status) ? { recovery: recoveryReview({ id: row.id, status: row.status as PipelineRun['status'], steps }) } : {}),
      status: row.status as PipelineRun['status'],
      steps,
      params: typeof row.params === 'string' ? JSON.parse(row.params) : row.params,
      startedAt: new Date(row.startedAt).toISOString(),
      completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
    };
  }
}

function rehearsalActivity(spec: RecoveryQualificationExpected): DeploymentPipelineActivity {
  return { kind: 'rehearsal', project: spec.project, stack: spec.stack, nodeId: spec.nodeId,
    releaseId: spec.candidate.id, manifestSha256: spec.candidate.manifestSha256,
    recoveryReleaseId: spec.recovery.id, recoveryManifestSha256: spec.recovery.manifestSha256 };
}
