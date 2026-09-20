/**
 * Who changed this control plane, and what they changed.
 *
 * `omnitron_audit_log` has been in the schema since the first migration —
 * `action`, `actorId`, `actorType`, `resourceType`, `resourceId`, `details`,
 * `ipAddress`, four indexes — and nothing has ever written a row to it. So a
 * console with accounts, roles and sessions could not answer who stopped a
 * stack, who added a node, or who read a secret out of the vault, and the
 * only account of any of it was a log line that rotates.
 *
 * The actor comes from the same AsyncLocalStorage the RPC guards read, so a
 * row cannot claim an identity the request did not carry. A call that
 * carried no token is `system` — which is what a local CLI call over the
 * unix socket is, where the trust is the socket's permissions rather than a
 * session — and never an invented user.
 *
 * Recorded at the RPC boundary, so this is an account of what was ASKED of
 * this daemon. What the daemon does on its own — a boot-time autostart, a
 * supervisor restarting a crashed app — is in its log, not here: an audit
 * trail answers WHO, and for those there is no who.
 *
 * Best-effort by design: the action has already happened when this is
 * called, and failing it afterwards would turn an unrecorded change into a
 * broken one. A write that fails is reported at error with the action it
 * could not record, which is the state an operator needs to know about.
 */

import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

import type { OmnitronDatabase } from '../database/schema.js';
import { getCurrentAuth, getRequestContext } from './auth-context.js';

/** One thing that happened, as the caller knows it. */
export interface AuditEntry {
  /** `<resource>.<verb>`: `stack.start`, `node.remove`, `secret.set`. */
  readonly action: string;
  /** What kind of thing it happened to — `stack`, `node`, `secret`, `app`. */
  readonly resourceType: string;
  /** Which one, when there is one. */
  readonly resourceId?: string | null | undefined;
  /**
   * Anything else worth keeping, as identifiers rather than payloads.
   *
   * Keys that name a credential are dropped on the way in. A caller should
   * not be passing one, and an audit trail that quietly becomes a second
   * copy of the vault is worse than no audit trail.
   */
  readonly details?: Record<string, unknown> | null | undefined;
}

export interface AuditRow {
  id: string;
  action: string;
  actorId: string | null;
  actorType: string;
  resourceType: string;
  resourceId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditQuery {
  /** Newest first. Capped by `MAX_AUDIT_PAGE`. */
  readonly limit?: number | undefined;
  readonly action?: string | undefined;
  readonly resourceType?: string | undefined;
  readonly actorId?: string | undefined;
  /** Keyset: rows strictly older than this ISO timestamp. */
  readonly before?: string | undefined;
}

/**
 * The most rows one call may ask for.
 *
 * A page size is the cost of the request, and the server is the only side
 * that knows what it can afford — see `node-manager.rpc-service`, which
 * learned this the same way.
 */
export const MAX_AUDIT_PAGE = 500;

/** Keys whose VALUE is a credential, whatever the caller meant by them. */
const SECRET_KEY = /password|passphrase|secret|token|credential|privatekey|apikey/i;

/** `details`, with anything that looks like a credential removed. */
export function scrubDetails(
  details: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!details) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[redacted]';
      continue;
    }
    // One level. A nested object is a payload, and this table takes facts.
    out[key] = value && typeof value === 'object' && !Array.isArray(value) ? '[object]' : value;
  }
  return out;
}

/** Who is calling, as the request proved rather than as it claimed. */
export function currentActor(): { actorId: string | null; actorType: string } {
  const auth = getCurrentAuth();
  if (!auth) return { actorId: null, actorType: 'system' };

  const roles = auth.roles ?? [];
  // A master reaching a node carries `service_role` and no human behind it.
  if (roles.includes('service_role') && !auth.userId) {
    return { actorId: null, actorType: 'service' };
  }
  return { actorId: auth.userId ?? null, actorType: auth.userId ? 'user' : 'system' };
}

export class AuditService {
  constructor(
    private readonly logger: ILogger,
    /** `null` on a daemon with no omnitron database — a slave, or a boot that failed. */
    private readonly db: Kysely<OmnitronDatabase> | null,
  ) {}

  /** Whether anything written here can be read back. */
  get available(): boolean {
    return this.db !== null;
  }

  async record(entry: AuditEntry): Promise<void> {
    if (!this.db) return;
    const { actorId, actorType } = currentActor();
    const ipAddress = getRequestContext()?.ipAddress ?? null;

    try {
      await this.db
        .insertInto('omnitron_audit_log')
        .values({
          action: entry.action,
          actorId,
          actorType,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          details: scrubDetails(entry.details) as never,
          ipAddress,
        } as never)
        .execute();
    } catch (err) {
      this.logger.error(
        { action: entry.action, resource: `${entry.resourceType}:${entry.resourceId ?? '-'}`, error: (err as Error).message },
        'Could not record this action in the audit log — it happened and nothing recorded it',
      );
    }
  }

  async list(query: AuditQuery = {}): Promise<AuditRow[]> {
    if (!this.db) return [];
    const limit = Math.min(MAX_AUDIT_PAGE, Math.max(1, Math.floor(query.limit ?? 100)));

    let q = this.db
      .selectFrom('omnitron_audit_log')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (query.action) q = q.where('action', '=', query.action);
    if (query.resourceType) q = q.where('resourceType', '=', query.resourceType);
    if (query.actorId) q = q.where('actorId', '=', query.actorId);
    if (query.before) q = q.where('createdAt', '<', new Date(query.before) as never);

    const rows = await q.execute();
    return rows.map((r) => ({
      id: String(r.id),
      action: r.action,
      actorId: r.actorId ?? null,
      actorType: r.actorType,
      resourceType: r.resourceType,
      resourceId: r.resourceId ?? null,
      details: (r.details as Record<string, unknown> | null) ?? null,
      ipAddress: r.ipAddress ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));
  }
}
