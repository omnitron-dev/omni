import type { DaemonStateStore } from '../daemon/daemon-state-store.service.js';
import type { TopologyDraft, TopologyPlan, TopologyScope, TopologySpec } from '../shared/dto/topology.js';
import { topologyRevision, validateTopologySpec } from './topology-plan.js';

interface TopologyState {
  version: 1;
  generation: number;
  desired: TopologySpec | null;
  draft: TopologyDraft | null;
  plans: TopologyPlan[];
  appliedBy?: { actorId: string | null; actorType: string };
}
const empty = (): TopologyState => ({ version: 1, generation: 0, desired: null, draft: null, plans: [] });
export class TopologyStateStore {
  constructor(private readonly store: DaemonStateStore) {}
  private key(scope: TopologyScope): string {
    for (const value of [scope.project, scope.stack])
      if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value))
        throw new Error('Invalid topology scope');
    return `topology:${scope.project}/${scope.stack}`;
  }
  read(scope: TopologyScope): TopologyState {
    const state = this.store.kvGetSync<TopologyState>(this.key(scope), { strict: true });
    if (state && state.version !== 1) throw new Error('Unsupported persisted topology version');
    return state ?? empty();
  }
  saveDraft(
    scope: TopologyScope,
    baseRevision: string,
    spec: TopologySpec,
    expectedDraft: number | null
  ): TopologyDraft {
    const validated = validateTopologySpec(spec);
    return this.store.kvUpdateSync<TopologyState>(this.key(scope), (current) => {
      const state = current ?? empty();
      if ((state.draft?.revision ?? null) !== expectedDraft)
        throw new Error('Topology draft changed in another session; reload before saving');
      return {
        ...state,
        generation: state.generation + 1,
        draft: { revision: state.generation + 1, baseRevision, spec: validated, updatedAt: new Date().toISOString() },
      };
    }).draft!;
  }
  addPlan(scope: TopologyScope, plan: TopologyPlan): TopologyPlan {
    this.store.kvUpdateSync<TopologyState>(this.key(scope), (current) => {
      const state = current ?? empty();
      if (
        state.draft?.revision !== plan.draftRevision ||
        topologyRevision(state.draft.spec) !== topologyRevision(plan.spec)
      )
        throw new Error('Draft changed while planning; build a fresh plan');
      return { ...state, plans: [plan, ...state.plans].slice(0, 20) };
    });
    return plan;
  }
  apply(
    scope: TopologyScope,
    id: string,
    revision: string,
    actor: { actorId: string | null; actorType: string }
  ): TopologyPlan {
    const state = this.store.kvUpdateSync<TopologyState>(this.key(scope), (current) => {
      if (!current) throw new Error('Topology plan not found');
      const plan = current.plans.find((candidate) => candidate.id === id);
      if (!plan) throw new Error('Topology plan not found');
      if (plan.status === 'applied') return current;
      if (plan.baseRevision !== revision || plan.draftRevision !== current.draft?.revision)
        throw new Error('Topology plan is stale; rebuild it from the current configuration and draft');
      if (Date.parse(plan.expiresAt) <= Date.now()) throw new Error('Topology plan expired; create a fresh plan');
      if (plan.issues.some((issue) => issue.severity === 'error'))
        throw new Error('Topology plan contains blocking issues');
      const applied: TopologyPlan = { ...plan, status: 'applied', appliedAt: new Date().toISOString() };
      return {
        ...current,
        generation: current.generation + 1,
        desired: plan.spec,
        draft: null,
        plans: current.plans.map((value) => (value.id === id ? applied : value)),
        appliedBy: actor,
      };
    });
    return state.plans.find((plan) => plan.id === id)!;
  }
}
