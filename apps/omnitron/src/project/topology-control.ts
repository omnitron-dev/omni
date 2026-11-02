import { randomUUID } from 'node:crypto';
import type { IEcosystemAppEntry, IEcosystemConfig, IStackConfig } from '../config/types.js';
import type { IStackInfo, ProjectTopology } from '../shared/dto/project.js';
import type { TopologyScope, TopologySpec, TopologyPlan, TopologyWorkspace } from '../shared/dto/topology.js';
import { mergeInfrastructure } from '../infrastructure/merge-config.js';
import {
  topologyChanges,
  topologyIssues,
  topologyRevision,
  topologySpec,
  validateTopologySpec,
} from './topology-plan.js';
import { topologyServices } from './topology-services.js';
import { TopologyStateStore } from './topology-state.js';
import { publicStack } from './public-stack.js';
import { stackNodeKey } from './stack-observation.js';

export interface TopologySources {
  configuration(scope: TopologyScope): Promise<{
    config: IEcosystemConfig;
    stack: IStackConfig;
    apps: IEcosystemAppEntry[];
    userStacks: Record<string, IStackConfig>;
  }>;
  observation(scope: TopologyScope): Promise<IStackInfo>;
  dependencies(scope: TopologyScope): Promise<ProjectTopology>;
  nodes(): TopologyWorkspace['availableNodes'];
}

/** Owns target intent. It has no process, SSH, provisioning or restart capabilities. */
export class TopologyControl {
  constructor(
    private readonly state: TopologyStateStore,
    private readonly sources: TopologySources
  ) {}

  private async context(scope: TopologyScope) {
    const { config, stack, apps, userStacks } = await this.sources.configuration(scope);
    const configured = topologySpec(stack, apps);
    const desired = this.state.read(scope).desired ?? configured;
    return {
      config,
      stack,
      configured,
      desired,
      applications: config.apps.filter((app) => app.enabled !== false),
      revision: topologyRevision({ config, userStacks, desired }),
    };
  }

  async workspace(scope: TopologyScope): Promise<TopologyWorkspace> {
    const context = await this.context(scope);
    const state = this.state.read(scope);
    const [observed, graph] = await Promise.all([this.sources.observation(scope), this.sources.dependencies(scope)]);
    return {
      ...scope,
      revision: context.revision,
      configured: context.configured,
      desired: context.desired,
      draft: state.draft,
      plans: state.plans,
      applications: context.applications.map((app) => ({
        name: app.name,
        runtime: 'process',
        dependsOn: app.dependsOn ?? [],
      })),
      services: topologyServices(mergeInfrastructure(context.config, context.stack), context.stack, graph.dependencies),
      availableNodes: this.sources.nodes(),
      observed: publicStack(observed),
      dependencies: graph.dependencies,
      coverage: graph.coverage ?? [],
      warnings: graph.warnings.map((warning) => `${warning.app ?? scope.stack}: ${warning.reason}`),
    };
  }

  async saveDraft(data: TopologyScope & { baseRevision: string; expectedDraft: number | null; spec: TopologySpec }) {
    const context = await this.context(data);
    if (data.baseRevision !== context.revision)
      throw new Error('Topology configuration changed; reload and rebase the draft');
    return this.state.saveDraft(data, context.revision, validateTopologySpec(data.spec), data.expectedDraft);
  }

  async plan(data: TopologyScope & { draftRevision: number }): Promise<TopologyPlan> {
    const context = await this.context(data);
    const draft = this.state.read(data).draft;
    if (!draft || draft.revision !== data.draftRevision)
      throw new Error('Topology draft changed; reload before planning');
    if (draft.baseRevision !== context.revision)
      throw new Error('Draft is based on an older configuration; rebase before planning');
    const issues = topologyIssues(draft.spec, context.applications);
    const configured = new Map(context.configured.nodes.map(node => [stackNodeKey(node.host, node.port), node]));
    const fleet = new Map(this.sources.nodes().map(node => [stackNodeKey(node.host, node.port), node]));
    for (const node of draft.spec.nodes) {
      const endpoint = stackNodeKey(node.host, node.port);
      const previous = configured.get(endpoint);
      const registered = fleet.get(endpoint);
      if (!registered && !previous)
        issues.push({
          severity: 'error',
          code: 'unregistered-node',
          message: `${stackNodeKey(node.host, node.port)} is not a registered fleet node`,
        });
      if ((previous?.nodeId && previous.nodeId !== node.nodeId) ||
          (node.nodeId && previous?.nodeId !== node.nodeId && registered?.id !== node.nodeId) ||
          (node.nodeId && registered && registered.id !== node.nodeId)) {
        issues.push({ severity: 'error', code: 'recipient-identity', message: `Reconcile the registered identity and existing allocation at ${endpoint} before changing its pin` });
      }
    }
    if (draft.spec.type !== context.stack.type)
      issues.push({
        severity: 'error',
        code: 'runtime-transition',
        message:
          'Changing local/remote/cluster ownership requires a separate migration; create another stack and plan its rollout',
      });
    const changes = topologyChanges(context.desired, draft.spec);
    if (changes.some((change) => change.resource === 'node'))
      issues.push({
        severity: 'warning',
        code: 'infrastructure-placement',
        message:
          'Current deployment provisions managed stack infrastructure on each declared node. It does not replicate databases or migrate volumes. Service placement needs its own execution plan.',
      });
    if (changes.some((change) => change.action === 'remove'))
      issues.push({
        severity: 'warning',
        code: 'retained-workloads',
        message:
          'Removing a placement from a target does not stop processes or delete data. The runtime map continues to show configured and observed placements.',
      });
    issues.push({
      severity: 'warning',
      code: 'intent-only',
      message:
        'Accepting this plan stores the target topology. It does not change deployment or restart configuration. Runtime placement changes require a separately admitted execution plan; this version does not execute topology migrations.',
    });
    const now = Date.now();
    return this.state.addPlan(data, {
      project: data.project,
      stack: data.stack,
      id: randomUUID(),
      baseRevision: context.revision,
      draftRevision: draft.revision,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 600_000).toISOString(),
      spec: draft.spec,
      changes,
      issues,
      effect: 'configuration',
      status: 'planned',
    });
  }

  async apply(data: TopologyScope & { plan: string }, actor: { actorId: string | null; actorType: string }) {
    const context = await this.context(data);
    const prior = this.state.read(data).plans.find((plan) => plan.id === data.plan);
    if (prior?.status === 'applied') return { plan: prior, changed: false };
    return { plan: this.state.apply(data, data.plan, context.revision, actor), changed: true };
  }
}
