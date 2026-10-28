import { sql, type Kysely, type Transaction } from 'kysely';
import { Service, Public } from '@omnitron-dev/titan/decorators';
import { Errors } from '@omnitron-dev/titan/errors';
import type { Netron } from '@omnitron-dev/titan/netron';
import { validateAccessRequirements } from '@omnitron-dev/titan/netron/auth';
import { readMethodMetadata } from '@omnitron-dev/titan/netron/transport/http/middleware';
import { ADMIN_ROLES, VIEWER_ROLES, ROLE_DESCRIPTIONS, isOmnitronRole } from '../shared/roles.js';
import type { OmnitronDatabase } from '../database/schema.js';
import type { ConsoleAccess, ConsoleAccount, ConsoleRole, IOmnitronAccessService } from '../shared/dto/access.js';
import type { AuthService } from './auth.service.js';
import type { AuditService } from './audit.service.js';
import { daemonPrincipal, revokeDaemonAuthority } from './daemon-principal.js';
import { consolePasswordError } from '../shared/dto/auth.js';

const columns = ['id', 'username', 'displayName', 'role', 'createdAt', 'lastLoginAt'] as const;
function account(row: {
  id: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: Date | string;
  lastLoginAt: Date | string | null;
}): ConsoleAccount {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    lastLoginAt: row.lastLoginAt ? new Date(row.lastLoginAt).toISOString() : null,
  };
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value))
    throw Errors.badRequest('A valid account ID is required');
  return value;
}

/** Human control-plane accounts. Application roles and service identities stay separate. */
@Service({ name: 'OmnitronAccess' })
export class AccessRpcService implements IOmnitronAccessService {
  constructor(
    private readonly db: Kysely<OmnitronDatabase>,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly netron: Netron
  ) {}

  @Public({ auth: { roles: VIEWER_ROLES } })
  async describe(): Promise<ConsoleAccess> {
    const { context, role } = await daemonPrincipal(this.auth, 'viewer');
    const capabilities: ConsoleAccess['capabilities'] = [];
    for (const stub of this.netron.peer.stubs.values()) {
      const { name, version, methods } = stub.definition.meta;
      if (!name.startsWith('Omnitron') || stub.definition.parentId) continue;
      for (const method of Object.keys(methods)) {
        const gate = readMethodMetadata(stub.instance, method)?.auth;
        if (gate === undefined) continue; // An undeclared gate cannot become a UI grant.
        const requirements = typeof gate === 'object' ? gate : {};
        const conditional = Boolean(
          Array.isArray(requirements.policies) ? requirements.policies.length : requirements.policies
        );
        const allowed =
          !conditional &&
          validateAccessRequirements(context, requirements).allowed &&
          (this.netron.authorizationManager?.canAccessMethod(`${name}@${version}`, method, context) ?? false);
        capabilities.push({
          service: name,
          method,
          roles: requirements.roles ?? [],
          allowed,
          conditional,
          ...(gate === false || requirements.allowAnonymous ? { anonymous: true } : {}),
        });
      }
    }
    return {
      userId: context.userId!,
      role,
      roles: ROLE_DESCRIPTIONS.map((r) => ({ ...r })),
      capabilities: capabilities.sort((a, b) => `${a.service}.${a.method}`.localeCompare(`${b.service}.${b.method}`)),
    };
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async listUsers(data: { after?: string } = {}) {
    await daemonPrincipal(this.auth, 'admin');
    let query = this.db.selectFrom('omnitron_users').select(columns).orderBy('id').limit(101);
    if (data.after) query = query.where('id', '>', id(data.after));
    const rows = await query.execute();
    return { users: rows.slice(0, 100).map(account), next: rows.length > 100 ? rows[99]!.id : null };
  }

  /** Serialize role changes and recheck the actor inside the same transaction. */
  private async transaction<T>(fn: (trx: Transaction<OmnitronDatabase>, actorId: string) => Promise<T>): Promise<T> {
    const actor = await daemonPrincipal(this.auth, 'admin');
    return this.db.transaction().execute(async (trx) => {
      await sql`select pg_advisory_xact_lock(hashtext('omnitron:console-accounts'))`.execute(trx);
      if (actor.sessionId) {
        const current = await trx
          .selectFrom('omnitron_users')
          .innerJoin('omnitron_sessions', 'omnitron_sessions.userId', 'omnitron_users.id')
          .select('omnitron_users.role')
          .where('omnitron_users.id', '=', actor.context.userId!)
          .where('omnitron_sessions.id', '=', actor.sessionId)
          .where('omnitron_sessions.expiresAt', '>', new Date())
          .executeTakeFirst();
        if (current?.role !== 'admin') throw Errors.forbidden('Administrator session was revoked or changed');
      }
      return fn(trx, actor.context.userId!);
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async createUser(data: {
    username: string;
    displayName?: string;
    password: string;
    role: ConsoleRole;
  }): Promise<ConsoleAccount> {
    await daemonPrincipal(this.auth, 'admin');
    if (!data || typeof data.username !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._@+-]{0,127}$/.test(data.username))
      throw Errors.badRequest('Username must contain 1–128 letters, digits or . _ @ + -');
    if (!isOmnitronRole(data.role)) throw Errors.badRequest('Unknown console role');
    const passwordError = consolePasswordError(data.password);
    if (passwordError) throw Errors.badRequest(passwordError);
    if (data.displayName !== undefined && (typeof data.displayName !== 'string' || data.displayName.length > 128))
      throw Errors.badRequest('Display name is limited to 128 characters');
    const passwordHash = await this.auth.hashPassword(data.password);
    return this.transaction(async (trx) => {
      if (await trx.selectFrom('omnitron_users').select('id').where('username', '=', data.username).executeTakeFirst())
        throw Errors.badRequest('Username already exists');
      const row = await trx
        .insertInto('omnitron_users')
        .values({
          username: data.username,
          displayName: data.displayName?.trim() || null,
          passwordHash,
          role: data.role,
          totpSecret: null,
          totpEnabled: false,
          pgpPublicKey: null,
          pgpEnabled: false,
          lastLoginAt: null,
          lockedUntil: null,
        })
        .returning(columns)
        .executeTakeFirstOrThrow();
      await this.audit
        .inTransaction(trx)
        .record(
          {
            action: 'account.create',
            outcome: 'ok',
            resourceType: 'account',
            resourceId: row.id,
            details: { username: row.username, role: row.role },
          },
          true
        );
      return account(row);
    });
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async setRole(data: { id: string; role: ConsoleRole; previous: string }): Promise<void> {
    const target = id(data?.id);
    if (!isOmnitronRole(data.role) || typeof data.previous !== 'string')
      throw Errors.badRequest('Unknown console role');
    await this.transaction(async (trx, actorId) => {
      if (target === actorId) throw Errors.forbidden('Ask another administrator to change your own role');
      const user = await trx
        .selectFrom('omnitron_users')
        .select(['id', 'role'])
        .where('id', '=', target)
        .forUpdate()
        .executeTakeFirst();
      if (!user) throw Errors.notFound('Account');
      if (user.role !== data.previous)
        throw Errors.badRequest('Role changed since you opened this account; refresh and retry');
      if (user.role === data.role) return;
      if (user.role === 'admin' && data.role !== 'admin') {
        const other = await trx
          .selectFrom('omnitron_users')
          .select('id')
          .where('role', '=', 'admin')
          .where('id', '!=', target)
          .executeTakeFirst();
        if (!other) throw Errors.forbidden('The last administrator cannot be demoted');
      }
      await trx
        .updateTable('omnitron_users')
        .set({ role: data.role, updatedAt: new Date() })
        .where('id', '=', target)
        .execute();
      await trx.deleteFrom('omnitron_sessions').where('userId', '=', target).execute();
      await this.audit
        .inTransaction(trx)
        .record(
          {
            action: 'account.role.change',
            outcome: 'ok',
            resourceType: 'account',
            resourceId: target,
            details: { previous: user.role, role: data.role },
          },
          true
        );
    });
    this.invalidateAuthority(target);
  }

  @Public({ auth: { roles: ADMIN_ROLES } })
  async revokeSessions(data: { id: string }): Promise<{ revoked: number }> {
    const target = id(data?.id);
    const revoked = await this.transaction(async (trx) => {
      if (!(await trx.selectFrom('omnitron_users').select('id').where('id', '=', target).executeTakeFirst()))
        throw Errors.notFound('Account');
      const result = await trx.deleteFrom('omnitron_sessions').where('userId', '=', target).executeTakeFirst();
      const count = Number(result.numDeletedRows);
      await this.audit
        .inTransaction(trx)
        .record(
          { action: 'account.sessions.revoke', outcome: 'ok', resourceType: 'account', resourceId: target, details: { count } },
          true
        );
      return count;
    });
    this.invalidateAuthority(target);
    return { revoked };
  }

  private invalidateAuthority(userId: string): void {
    revokeDaemonAuthority(this.netron, userId);
  }
}
