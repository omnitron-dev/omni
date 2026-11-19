import { Public, Service } from '@omnitron-dev/titan/decorators';
import { ADMIN_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import { evaluateFlow } from '../shared/dto/flows.js';
import type {
  FlowChange,
  FlowRef,
  FlowSave,
  FlowWorkspace,
  IOmnitronFlowsService,
} from '../shared/dto/flow-runtime.js';
import type { IOmnitronStudioService, StudioProposalRef } from '../shared/dto/studio.js';
import type { AuditService } from '../services/audit.service.js';
import type { AuthService } from '../services/auth.service.js';
import { daemonPrincipal } from '../services/daemon-principal.js';
import { checkFlowWorkspace } from './flow-ledger.js';
import type { FlowRuntime, FlowScopeReader } from './flow-runtime.js';
import { meshSourceIds } from './mesh-disk.js';

@Service({ name: 'OmnitronFlows' })
export class FlowsRpcService implements IOmnitronFlowsService {
  constructor(
    private readonly runtime: FlowRuntime,
    private readonly auth: Pick<AuthService, 'validateSession'>,
    private readonly audit: Pick<AuditService, 'record'>,
    private readonly scope: FlowScopeReader,
    private readonly admit: () => Promise<void>,
    private readonly studio?: Pick<IOmnitronStudioService, 'flowProposal'>
  ) {}
  private async authorize(ref?: FlowRef, action?: string) {
    const principal = await daemonPrincipal(this.auth, 'admin');
    if (ref) checkFlowWorkspace(ref.workspace);
    if (action) {
      await this.admit();
      await this.audit.record({ action: 'flow.' + action, resourceType: 'flow', resourceId: ref?.id }, true);
    }
    return { actor: principal.context.userId, session: principal.sessionId ?? null };
  }
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async catalog() {
    await daemonPrincipal(this.auth, 'operator');
    const { registry } = this.runtime.ledger;
    return { nodes: registry.catalog(), diagnostics: registry.diagnostics };
  }
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async preview(data: Parameters<IOmnitronFlowsService['preview']>[0]) {
    await daemonPrincipal(this.auth, 'operator');
    return evaluateFlow(data.definition, data.event, data.state, this.runtime.ledger.registry);
  }
  @Public({ auth: { roles: OPERATOR_ROLES } })
  async submitProposal(data: StudioProposalRef) {
    const { context } = await daemonPrincipal(this.auth, 'operator');
    if (!data || Object.keys(data).some((key) => !['project', 'threadId', 'proposalId'].includes(key)))
      throw Error('Select a proposal in its Studio room');
    if (!this.studio) throw Error('Studio proposals are unavailable on this controller');
    const source = { actor: context.userId, threadId: data.threadId, proposalId: data.proposalId };
    const proposal = await this.studio.flowProposal(data);
    const workspace: FlowWorkspace = {
      project: data.project,
      ...(proposal.stack !== null && { stack: proposal.stack }),
    };
    const receipt = this.runtime.ledger.proposalReceipt(source, workspace);
    if (receipt) return receipt;
    const binding = await this.scope(workspace, meshSourceIds(proposal.definition));
    await this.audit.record(
      { action: 'flow.proposal.requested', resourceType: 'studio.flow-proposal', resourceId: data.proposalId },
      true
    );
    await this.admit();
    // Recheck the submitting account, room and project directory after resolving the destination.
    const current = await this.studio.flowProposal(data);
    if (current.stack !== proposal.stack) throw Error('The proposal workspace changed');
    return this.runtime.ledger.submitProposal(source, workspace, current.definition, binding);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async list(data: Parameters<IOmnitronFlowsService['list']>[0]) {
    await this.authorize();
    checkFlowWorkspace(data.workspace);
    await this.scope(data.workspace);
    return this.runtime.ledger.list(data);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async get(data: FlowRef) {
    await this.authorize(data);
    return this.runtime.ledger.get(data, { includeProjectStacks: true });
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async save(data: FlowSave) {
    await this.authorize(data, 'save');
    const binding = await this.scope(data.workspace, meshSourceIds(data.definition));
    return this.runtime.ledger.save(data, binding);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async activate(data: FlowChange) {
    const actor = await this.authorize(data, 'activate');
    const draft = this.runtime.ledger.get(data);
    if (draft.revision !== data.revision) throw Error('The flow draft changed. Review the new revision.');
    const binding = await this.scope(data.workspace, meshSourceIds(draft.definition));
    await this.runtime.review(draft.definition, binding, actor);
    const result = this.runtime.ledger.change(data, actor, binding);
    this.runtime.wake();
    return result;
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async deactivate(data: FlowChange) {
    const actor = await this.authorize(data, 'deactivate');
    const result = this.runtime.ledger.change(data, actor, null);
    this.runtime.wake();
    return result;
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async submit(data: Parameters<IOmnitronFlowsService['submit']>[0]) {
    await this.authorize(data, 'submit');
    await this.runtime.checkWorkspace(data.id, data.activation);
    const result = this.runtime.ledger.submit(data, data.activation, data.event);
    this.runtime.wake();
    return result;
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async history(data: FlowRef & { limit?: number }) {
    await this.authorize(data);
    return this.runtime.ledger.history(data, data.limit);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async notifications(data: Parameters<IOmnitronFlowsService['notifications']>[0]) {
    await this.authorize();
    checkFlowWorkspace(data.workspace);
    await this.scope(data.workspace);
    return this.runtime.ledger.notifications(data.workspace, data.after, data.limit);
  }
  @Public({ auth: { roles: ADMIN_ROLES } })
  async retryDelivery(data: Parameters<IOmnitronFlowsService['retryDelivery']>[0]) {
    const actor = await this.authorize(data, 'retry');
    const result = this.runtime.ledger.retry(data, data.activation, data.delivery, actor);
    this.runtime.wake();
    return result;
  }
}
