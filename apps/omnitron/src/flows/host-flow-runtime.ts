import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import type { FlowWorkspace } from '../shared/dto/flow-runtime.js';
import type { FlowDefinition } from '../shared/dto/flows.js';
import type { StudioPost } from '../shared/dto/studio.js';
import type { StudioRpcService } from '../studio/studio.rpc-service.js';
import type { IOmnitronPipelinesService, PipelineRun } from '../shared/dto/services.js';
import type { AuthService } from '../services/auth.service.js';
import type { ProjectService } from '../services/project.service.js';
import { runWithAuth } from '../services/auth-context.js';
import { pipelineAdmissionCheck } from '../services/pipeline-admission.js';
import {
  FlowRuntime,
  UnconfirmedDelivery,
  verifyFlowScope,
  type FlowScopeReader,
  type OutgoingFlowDelivery,
} from './flow-runtime.js';
import type { FlowMesh } from './mesh-disk.js';
import { FlowLedger, type FlowAuthority, type FlowBinding } from './flow-ledger.js';

export function flowWorkspaceReader(
  projects: Pick<
    ProjectService,
    'getWorkspaceDirectory' | 'resolveProjectStack' | 'configuredStackType' | 'projectConfigurations'
  >,
  mesh?: Pick<FlowMesh, 'identity'>
) {
  return async (workspace: FlowWorkspace, nodes: readonly string[] = []): Promise<FlowBinding> => {
    if (nodes.length && !mesh) throw Error('This controller has no mesh registry');
    const peers = nodes.length ? { mesh: Object.fromEntries(nodes.map((id) => [id, mesh!.identity(id)])) } : {};
    if (workspace.project === null) return { identity: 'controller', target: null, ...peers };
    const directory = await realpath(projects.getWorkspaceDirectory(workspace.project));
    const registrations = projects.projectConfigurations(workspace.project);
    const registration = registrations.find((r) => r.name === workspace.project);
    if (!registration) throw Error('Flow project registration is missing');
    const target =
      workspace.stack === undefined
        ? null
        : await projects.resolveProjectStack(
            { project: workspace.project, stack: workspace.stack },
            { readOnly: true }
          );
    const type = target && projects.configuredStackType(target);
    const source = target && registrations.find((r) => r.name === target.project);
    if (target && (!type || !source)) throw Error('Flow stack no longer exists');
    return {
      identity: createHash('sha256')
        .update(
          JSON.stringify([
            directory,
            registration.registeredAt,
            source?.registeredAt ?? null,
            source ? await realpath(source.path) : null,
          ])
        )
        .digest('hex'),
      target: target && type ? { ...target, type } : null,
      ...peers,
    };
  };
}
interface Host {
  auth: Pick<AuthService, 'validateSession'>;
  pipelines: Pick<
    IOmnitronPipelinesService,
    'getPipeline' | 'listWorkspace' | 'prepareRun' | 'startRun' | 'getRunStatus'
  >;
  studio: Pick<StudioRpcService, 'postReceipt' | 'postIfNew'>;
  scope: FlowScopeReader;
  mesh?: FlowMesh;
  admit(): Promise<void>;
  report(error: unknown): void;
}
function inspectRun(run: PipelineRun, deliveryId: string, id: string, revision: string, actor: string) {
  if (
    run.id !== deliveryId ||
    run.pipelineId !== id ||
    run.triggeredBy !== actor ||
    run.review?.definitionRevision !== revision ||
    run.review.parameterNames.length
  )
    throw new UnconfirmedDelivery('Pipeline admission differs from this flow command. Inspect its receipt.');
  if (
    run.status === 'interrupted' ||
    run.steps.some(
      (step) =>
        step.deployment?.state === 'unconfirmed' || step.executions?.some((attempt) => attempt.state === 'unconfirmed')
    )
  )
    throw new UnconfirmedDelivery('Pipeline effects are unconfirmed. Inspect its existing run.');
  return run.review;
}
export function hostFlowRuntime(ledger: FlowLedger, host: Host) {
  async function reviewedPipeline(config: Record<string, unknown>, binding: FlowBinding) {
    const target = binding.target;
    if (target?.type !== 'local') throw Error('A release pipeline action needs a registered local stack');
    const pipeline = await host.pipelines.getPipeline({ id: String(config['pipelineId']) });
    if (!pipeline || pipeline.revision !== config['revision'])
      throw Error('The published pipeline revision changed. Review the flow.');
    if (
      !pipeline.steps.length ||
      pipeline.steps.some(
        (step) =>
          step.kind !== 'release' ||
          (step.nodeId !== undefined && step.nodeId !== 'local') ||
          step.target.project !== target.project ||
          step.target.stack !== target.stack
      )
    )
      throw Error('Automatic execution requires every step to target a sealed release in this local project and stack');
    return pipeline;
  }
  async function review(definition: FlowDefinition, binding: FlowBinding, authority: FlowAuthority) {
    for (const node of definition.nodes.filter((n) => n.type === 'output.run-pipeline@1')) {
      if (!authority.session) throw Error('Activate release execution from a signed-in administrator session');
      await reviewedPipeline(node.config, binding);
    }
  }
  async function deliver(entry: OutgoingFlowDelivery, check: (dispatch?: boolean) => void): Promise<string> {
    const { active, session, workspace, effect, row } = entry;
    if (!active || !session)
      throw Error('An active administrator session is required. Sign in and retry this delivery.');
    const principal = await host.auth.validateSession(session);
    if (!principal || principal.id !== active.actor || principal.role !== 'admin')
      throw Error('The activating session expired or its role changed. Sign in and retry this delivery.');
    const admit = async () => {
      await host.admit();
      await verifyFlowScope(ledger, host.scope, row.flow_id, row.activation);
      check();
    };
    await admit();
    return runWithAuth(
      { userId: principal.id, roles: [principal.role], permissions: [], metadata: { sessionId: session } },
      async () => {
        if (effect.kind === 'pipeline-review' || effect.kind === 'pipeline-run') {
          const id = String(effect.config['pipelineId']),
            revision = String(effect.config['revision']);
          const automatic = effect.kind === 'pipeline-run';
          const existing = await host.pipelines.getRunStatus({ runId: row.id });
          if (existing) {
            inspectRun(existing, row.id, id, revision, principal.id);
            if (!automatic || existing.status !== 'awaiting-review') return existing.id;
          }
          if (automatic) {
            await reviewedPipeline(effect.config, ledger.verifyActivation(row.flow_id, row.activation).binding);
          } else if (workspace.project) {
            const inventory = await host.pipelines.listWorkspace({
              project: workspace.project,
              ...(workspace.stack && { stack: workspace.stack }),
              limit: 1,
            });
            if (!inventory.definitions.some((p) => p.id === id))
              throw Error('Pipeline is outside the reviewed workspace');
          }
          await admit();
          check(true);
          const run = await pipelineAdmissionCheck.run(check, () =>
            host.pipelines.prepareRun({ id, expectedRevision: revision, runId: row.id, params: {} })
          );
          const reviewed = inspectRun(run, row.id, id, revision, principal.id);
          if (!automatic || run.status !== 'awaiting-review') return run.id;
          await admit();
          try {
            check(true);
            const started = await pipelineAdmissionCheck.run(check, () =>
              host.pipelines.startRun({
                runId: row.id,
                expectedDigest: reviewed.digest,
                params: {},
              })
            );
            inspectRun(started, row.id, id, revision, principal.id);
            return started.id;
          } catch (error) {
            const observed = await host.pipelines.getRunStatus({ runId: row.id }).catch(() => null);
            if (!observed)
              throw new UnconfirmedDelivery(
                'The pipeline start has no confirmed receipt. Inspect the existing command.'
              );
            inspectRun(observed, row.id, id, revision, principal.id);
            if (observed.status !== 'awaiting-review') return observed.id;
            throw error;
          }
        }
        if (effect.kind === 'studio-task') {
          const message: StudioPost = {
            project: workspace.project,
            threadId: String(effect.config['threadId']),
            turnId: row.id,
            memberId: String(effect.config['memberId']),
            kind: 'task',
            text: String(effect.config['task']),
          };
          let dispatched = false;
          await admit();
          try {
            const result = await host.studio.postIfNew(message, workspace.stack, () => {
              check(true);
              dispatched = true;
            });
            return result.turnId;
          } catch (error) {
            if (!dispatched) throw error;
            let receipt;
            try {
              receipt = await host.studio.postReceipt(message, workspace.stack);
            } catch {
              throw new UnconfirmedDelivery('Studio admission could not be confirmed. Inspect the original delivery.');
            }
            if (receipt) return receipt.turnId;
            throw error;
          }
        }
        throw Error('Unsupported flow delivery');
      }
    );
  }
  return new FlowRuntime(ledger, {
    admit: host.admit,
    scope: host.scope,
    ...(host.mesh && { mesh: host.mesh }),
    review,
    deliver,
    report: host.report,
  });
}
