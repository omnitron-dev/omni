import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Public, Service } from '@omnitron-dev/titan/decorators';
import { hasMinimumRole, ADMIN_ROLES, OPERATOR_ROLES } from '../shared/roles.js';
import { daemonPrincipal } from '../services/daemon-principal.js';
import type { AuditService } from '../services/audit.service.js';
import type { AuthService } from '../services/auth.service.js';
import type { ProjectService } from '../services/project.service.js';
import type { StudioLedger, StudioLink, StudioScope } from './ledger.js';
import {
  STUDIO_PROVIDERS,
  type IOmnitronStudioService,
  type StudioSend,
  type StudioDecision,
  type StudioResult,
  type StudioFailure,
} from '../shared/dto/studio.js';
import {
  assertStudioAssignment,
  createStudioProviderInput,
  studioRoleRequirements,
  selectStudioModel,
  studioUsageReport,
  type StudioModelCatalog,
} from '../shared/dto/studio-policy.js';

const uuid = (s: unknown) =>
  typeof s === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(s);
const opaque = (s: unknown) => typeof s === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(s);
const failures = new Set<StudioFailure>([
  'authorization',
  'disconnected',
  'sign-in',
  'provider',
  'protocol',
  'timeout',
]);
const MAX_ANSWER = 128 * 1024;
type ProjectReader = Pick<ProjectService, 'getWorkspaceDirectory' | 'resolveProjectStack' | 'listStacks'>;
type LinkRequest = Parameters<IOmnitronStudioService['connectAdapter']>[0];

@Service({ name: 'OmnitronStudio' })
export class StudioRpcService implements IOmnitronStudioService {
  constructor(
    private readonly ledger: StudioLedger,
    private readonly projects: ProjectReader,
    private readonly auth: Pick<AuthService, 'validateSession'>,
    private readonly audit: Pick<AuditService, 'record'>
  ) {}

  private scope(project: string | null, account: string): StudioScope {
    if (project === null) return { project: '', account, directory: '' };
    if (typeof project !== 'string' || !project.length || project.length > 160)
      throw Error('Select a registered project');
    return { project, account, directory: realpathSync(this.projects.getWorkspaceDirectory(project)) };
  }

  private async localOperator() {
    const { context } = await daemonPrincipal(this.auth, 'admin');
    if (context.userId !== 'omnitron-local' || context.metadata?.['source'] !== 'local-unix-socket')
      throw Error('Connect the adapter using the private local Omnitron CLI');
  }

  private async worker(id: string) {
    await this.localOperator();
    if (!uuid(id)) throw Error('Invalid adapter connection');
    const link = this.ledger.connection(id);
    try {
      if (this.scope(link.project || null, link.account).directory !== link.directory)
        throw Error('Workspace directory changed');
      return link;
    } catch (error) {
      this.ledger.disconnect(id);
      throw error;
    }
  }

  private async authorizedTurn(link: StudioLink, session: string | null) {
    if (!session) return link.account === 'omnitron-local';
    const user = await this.auth.validateSession(session);
    return !!user && user.id === link.account && hasMinimumRole([user.role], 'operator');
  }

  private async requireStack(project: string | null, stack: string) {
    if (project === null) throw Error('Select a registered project for a stack assignment');
    const scope = await this.projects.resolveProjectStack({ project, stack }, { readOnly: true });
    if (!this.projects.listStacks(scope.project).some((entry) => entry.name === scope.stack))
      throw Error('Select a known stack in this workspace');
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async workspace({ project, stack, before }: Parameters<IOmnitronStudioService['workspace']>[0]) {
    const { context } = await daemonPrincipal(this.auth, 'operator');
    if (
      (stack !== undefined && (typeof stack !== 'string' || !stack.length || stack.length > 160 || project === null)) ||
      (before !== undefined &&
        (!before || !uuid(before.id) || !Number.isSafeInteger(before.updatedAt) || before.updatedAt < 0))
    )
      throw Error('Invalid conversation list request');
    const { links, threads, older } = this.ledger.workspace(this.scope(project, context.userId!), stack, before);
    return {
      account: context.userId!,
      threads,
      older,
      catalogs: links.map((link) => JSON.parse(link.catalog) as StudioModelCatalog),
    };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async thread(data: Parameters<IOmnitronStudioService['thread']>[0]) {
    const { context } = await daemonPrincipal(this.auth, 'operator');
    if (!uuid(data.threadId) || (data.before !== undefined && !uuid(data.before))) throw Error('Invalid conversation');
    return this.ledger.thread(this.scope(data.project, context.userId!), data.threadId, data.before);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async send(data: StudioSend) {
    const { context, sessionId } = await daemonPrincipal(this.auth, 'operator');
    const scope = this.scope(data.project, context.userId!);
    if (
      !STUDIO_PROVIDERS.includes(data.provider) ||
      !uuid(data.threadId) ||
      !uuid(data.turnId) ||
      (data.after !== null && !uuid(data.after)) ||
      typeof data.prompt !== 'string' ||
      !data.prompt.trim() ||
      Buffer.byteLength(data.prompt) > 32 * 1024 ||
      !data.preferences ||
      JSON.stringify(data.preferences).length > 4096
    )
      throw Error('Select an adapter and send a message up to 32 KiB');
    if (data.stack !== undefined) await this.requireStack(data.project, data.stack);
    const { role, result, model } = data.preferences;
    if (model !== undefined && (typeof model !== 'string' || !model.trim()))
      throw Error('Select a model from the connected catalog');
    assertStudioAssignment({
      scope: { project: data.project ?? 'Project planning', ...(data.stack && { stack: data.stack }) },
      role,
      result,
    });
    const requirements = studioRoleRequirements(role, data.preferences.requirements, model !== undefined);
    const preferences = { role, result, requirements, ...(model === undefined ? {} : { model }) };
    const requestKey = createHash('sha256').update(JSON.stringify(preferences)).digest('hex');
    await this.audit.record(
      {
        action: 'studio.turn.requested',
        resourceType: 'studio.turn',
        resourceId: data.turnId,
        details: { provider: data.provider, role, result },
      },
      true
    );
    this.ledger.send(scope, { ...data, requestKey }, sessionId ?? null, () => {
      const link = this.ledger.linkFor(scope, data.provider)!;
      const catalog: StudioModelCatalog = JSON.parse(link.catalog);
      const decision = selectStudioModel(catalog, {
        provider: data.provider,
        connector: catalog.connector,
        requirements,
        ...(model !== undefined && { model }),
      });
      if (!decision.ok) throw Error(decision.message);
      return JSON.stringify({ requestKey, preferences, selection: decision.selection });
    });
    return { threadId: data.threadId, turnId: data.turnId };
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async cancel(data: { project: string | null; threadId: string; turnId: string }) {
    const { context } = await daemonPrincipal(this.auth, 'operator');
    if (!uuid(data.threadId) || !uuid(data.turnId)) throw Error('Invalid turn');
    return this.ledger.cancel(this.scope(data.project, context.userId!), data.threadId, data.turnId);
  }

  @Public({ auth: { roles: OPERATOR_ROLES } })
  async review(data: Parameters<IOmnitronStudioService['review']>[0]) {
    const { context } = await daemonPrincipal(this.auth, 'operator');
    if (
      !['accepted', 'needs-work'].includes(data.outcome) ||
      typeof data.note !== 'string' ||
      data.note.length > 2048 ||
      (data.previous !== null && !Number.isSafeInteger(data.previous))
    )
      throw Error('Invalid result review');
    await this.audit.record(
      {
        action: 'studio.review',
        resourceType: 'studio.turn',
        resourceId: data.turnId,
        details: { outcome: data.outcome },
      },
      true
    );
    this.ledger.review(
      this.scope(data.project, context.userId!),
      data.threadId,
      data.turnId,
      data.previous,
      data.outcome,
      data.note
    );
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async connectAdapter(data: LinkRequest) {
    await this.localOperator();
    if (!opaque(data.account)) throw Error('Invalid Console account');
    const scope = this.scope(data.project, data.account);
    if (
      data.project === null
        ? data.directory !== null
        : typeof data.directory !== 'string' || realpathSync(data.directory) !== scope.directory
    )
      throw Error('Run the connector from the registered project directory');
    const catalog = data.catalog;
    if (
      !catalog ||
      !STUDIO_PROVIDERS.includes(catalog.provider) ||
      !Array.isArray(catalog.models) ||
      !catalog.models.length ||
      catalog.models.length > 512 ||
      JSON.stringify(catalog).length > 256 * 1024
    )
      throw Error('A bounded local model catalog is required');
    const check = selectStudioModel(catalog, {
      provider: catalog.provider,
      connector: catalog.connector,
      requirements: {},
      model: catalog.models[0]?.id ?? '',
    });
    if (!check.ok) throw Error(check.message);
    await this.audit.record(
      { action: 'studio.adapter.connect', resourceType: 'studio.adapter', resourceId: catalog.provider },
      true
    );
    return { connection: this.ledger.connect(scope, catalog.provider, JSON.stringify(catalog)) };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async nextTurn({ connection }: { connection: string }) {
    const link = await this.worker(connection);
    const job = this.ledger.pending(connection);
    if (!job) return null;
    if (!(await this.authorizedTurn(link, job.session))) {
      this.ledger.refuse(connection, job.id);
      return null;
    }
    const { preferences, selection } = JSON.parse(job.assignment) as StudioDecision;
    const catalog: StudioModelCatalog = JSON.parse(link.catalog);
    const check = selectStudioModel(catalog, {
      provider: link.provider,
      connector: catalog.connector,
      requirements: preferences.requirements,
      previous: selection,
    });
    if (!check.ok) {
      this.ledger.refuse(connection, job.id, 'model-changed');
      return null;
    }
    if (job.stack) {
      try {
        await this.requireStack(link.project || null, job.stack);
      } catch {
        this.ledger.refuse(link.id, job.id, 'scope-unavailable');
        return null;
      }
    }
    const input = createStudioProviderInput({
      assignment: {
        scope: { project: link.project || 'Project planning', ...(job.stack && { stack: job.stack }) },
        role: preferences.role,
        result: preferences.result,
      },
      selection,
      prompt: job.prompt,
      conversation: job.conversation,
    });
    if (!this.ledger.claim(connection, job.id)) return null;
    return { turnId: job.id, ...input };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async heartbeat(data: { connection: string; turnId: string; preview?: string }) {
    const link = await this.worker(data.connection);
    const record = this.ledger.active(link.id, data.turnId);
    if (!record) return { active: false };
    if (!(await this.authorizedTurn(link, record.session))) {
      this.ledger.refuse(link.id, data.turnId);
      return { active: false };
    }
    if (data.preview !== undefined) {
      if (typeof data.preview !== 'string' || Buffer.byteLength(data.preview) > MAX_ANSWER)
        throw Error('Preview exceeds the reply limit');
      this.ledger.preview(link.id, data.turnId, data.preview);
    }
    return { active: !!this.ledger.active(link.id, data.turnId) };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async finishTurn(data: { connection: string; turnId: string; result: StudioResult }) {
    const link = await this.worker(data.connection);
    const r = data.result;
    const record = this.ledger.active(link.id, data.turnId);
    if (!record) return;
    if (!(await this.authorizedTurn(link, record.session))) {
      this.ledger.refuse(link.id, data.turnId);
      return;
    }
    if (
      r?.status === 'completed' &&
      typeof r.answer === 'string' &&
      r.answer.trim() &&
      Buffer.byteLength(r.answer) <= MAX_ANSWER &&
      opaque(r.conversation)
    )
      this.ledger.finish(link.id, data.turnId, {
        status: 'completed',
        answer: r.answer,
        conversation: r.conversation,
        usage: studioUsageReport(r.usage),
      });
    else if (r?.status === 'failed' && failures.has(r.failure))
      this.ledger.finish(link.id, data.turnId, { status: 'failed', failure: r.failure });
    else throw Error('Invalid adapter result');
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async disconnectAdapter({ connection }: { connection: string }) {
    await this.localOperator();
    this.ledger.disconnect(connection);
  }
}
