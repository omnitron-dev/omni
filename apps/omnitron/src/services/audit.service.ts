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
 * The actor is the identity the call was ADMITTED with: the auth context the
 * RPC guard enforced, carried into an AsyncLocalStorage by the transport's
 * invocation wrapper — so a row cannot claim an identity the request did not
 * carry, and never invents one.
 *
 *   user     a console session's account — or `omnitron-local`, the context
 *            the daemon grants every connection on its owner-only unix
 *            socket, which is where the CLI (and an MCP tool) arrives. The
 *            trust there is the socket's permissions rather than a session,
 *            and the id says so.
 *   service  another omnitron acting as the control plane: `service_role`,
 *            no account behind it.
 *   system   nothing asked. The daemon acting on its own — a boot autostart,
 *            the enabled-stacks reconciler.
 *
 * This said a CLI call was `system`, and for a reason that was no design: the
 * unix transport was registered without the invocation wrapper the HTTP and
 * WebSocket ones have, so the store was empty on every CLI call while the
 * guard, one layer down, was admitting it as `omnitron-local`. Measured on
 * the master 2026-09-23: 171 of 178 rows `system`, `omnitron audit --actor
 * system` answering «nothing recorded», and a deployment the operator typed
 * indistinguishable from one the daemon started at boot.
 *
 * Not only what was asked of this daemon, either — this also said a boot
 * autostart was in the log and not here, and 44 of the master's 79
 * `stack.start` rows were exactly that. A stack start is recorded for every
 * caller, with `details.source` naming which (`operator`, `boot`,
 * `auto-resume`). What is in the log only: a supervisor restarting a crashed
 * app, and a remote stack a restart re-attaches, which deploys nothing.
 *
 * How it ended. Most writers record after their action succeeded and write no
 * outcome — the row IS the action. A writer that records both endings passes
 * `outcome`, and a failure keeps the first line of its error (see
 * `describeFailure`). `outcomeOf` (`shared/audit-outcome.ts`, which the
 * console reads too) reads either convention, including the older one of
 * naming the failure in the action (`node.upgrade.failed`).
 *
 * Best-effort by design: the action has already happened — or already failed
 * — when this is called, and failing it afterwards would turn an unrecorded
 * change into a broken one. A write that fails is reported at error with the
 * action it could not record, which is the state an operator needs to know
 * about.
 */

import type { Kysely } from 'kysely';
import type { ILogger } from '@omnitron-dev/titan/module/logger';

import type { OmnitronDatabase } from '../database/schema.js';
import { redactTokens } from '../release/publish.js';
import type { AuditOutcome } from '../shared/audit-outcome.js';
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
  /**
   * How it ended — from a writer that records both endings. Kept in
   * `details.outcome`: the table has no column for it, and every reader
   * already reads `details`.
   */
  readonly outcome?: AuditOutcome | undefined;
  /** For `failed`: what went wrong. Kept as `details.error`, via `describeFailure`. */
  readonly error?: unknown;
}

/**
 * Who an actor can be, as `currentActor` answers it — and the words `omnitron
 * audit --actor` takes as a KIND of actor rather than an id.
 */
export const ACTOR_TYPES = ['user', 'service', 'system'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

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
  /**
   * `user`, `service` or `system` — what the ACTOR column prints for a row
   * with no id. `actorId` alone could not select those: 171 of the master's
   * 178 rows had a null id, and `--actor system` compared `system` with it
   * and found nothing.
   */
  readonly actorType?: string | undefined;
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

/** The longest failure a row keeps. The whole error is in the daemon log. */
const MAX_FAILURE_TEXT = 300;

/**
 * A failure as a row keeps it: the first line of what the error said, with a
 * credential a connection string carried taken out, and bounded.
 *
 * The first line because the rest is for a terminal — the dirty-tree refusal
 * goes on to list ten file names. Redacted because an error is not a detail
 * a caller chose: it is whatever the failing layer wrote, and a
 * `redis://user:pass@host` has reached the daemon log that way before (see
 * `redactTokens`).
 */
export function describeFailure(err: unknown): string {
  // An error that crossed a transport arrives as a plain `{ message }`.
  const message =
    err instanceof Error
      ? err.message
      : err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
        ? (err as { message: string }).message
        : String(err);
  const first =
    message
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? '(the error said nothing)';
  const clean = redactTokens(first);
  return clean.length > MAX_FAILURE_TEXT ? `${clean.slice(0, MAX_FAILURE_TEXT - 1)}…` : clean;
}

/** Who is calling, as the request proved rather than as it claimed. */
export function currentActor(): { actorId: string | null; actorType: ActorType } {
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

    // After the scrub, so neither can be mistaken for something to redact;
    // the error is made safe by `describeFailure` instead.
    const scrubbed = scrubDetails(entry.details);
    const details = entry.outcome
      ? {
          ...(scrubbed ?? {}),
          outcome: entry.outcome,
          ...(entry.outcome === 'failed' && entry.error !== undefined ? { error: describeFailure(entry.error) } : {}),
        }
      : scrubbed;

    try {
      await this.db
        .insertInto('omnitron_audit_log')
        .values({
          action: entry.action,
          actorId,
          actorType,
          resourceType: entry.resourceType,
          resourceId: entry.resourceId ?? null,
          details: details as never,
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
    // Refused by name before the database sees it. `Math.floor(NaN)` is NaN,
    // which `min`/`max` pass straight through, so `omnitron audit -n abc`
    // reached Postgres as `LIMIT NaN` and came back as «invalid input syntax
    // for type bigint: "NaN"» — an error about SQL, for a typo in a flag.
    const asked = query.limit == null ? 100 : Number(query.limit);
    if (Number.isNaN(asked)) {
      throw new Error(`limit is a number of entries, 1 to ${MAX_AUDIT_PAGE} — not "${String(query.limit)}"`);
    }
    const limit = Math.min(MAX_AUDIT_PAGE, Math.max(1, Math.floor(asked)));
    const before = query.before ? new Date(query.before) : null;
    if (before && Number.isNaN(before.getTime())) {
      throw new Error(`before is an ISO timestamp such as 2026-09-22T21:20:37Z — not "${String(query.before)}"`);
    }

    let q = this.db
      .selectFrom('omnitron_audit_log')
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (query.action) q = q.where('action', '=', query.action);
    if (query.resourceType) q = q.where('resourceType', '=', query.resourceType);
    if (query.actorId) q = q.where('actorId', '=', query.actorId);
    if (query.actorType) q = q.where('actorType', '=', query.actorType);
    if (before) q = q.where('createdAt', '<', before as never);

    const rows = await q.execute();
    return rows.map(toAuditRow);
  }

  /**
   * The newest row for each resource, for one action — «what each stack last
   * did», over the whole trail.
   *
   * `OmnitronRelease.deployments()` read the newest 200 `stack.start` rows and
   * took the first per stack. Measured on the master: 80 such rows in three
   * days, 57 of them on one day — every daemon start writes one for the local
   * stack — so the window was about 3.5 days. A stack left running longer read
   * as never deployed, and `prune` did not protect the release it runs.
   */
  async latestPerResource(action: string): Promise<AuditRow[]> {
    if (!this.db) return [];
    const rows = await this.db
      .selectFrom('omnitron_audit_log')
      .distinctOn('resourceId')
      .selectAll()
      .where('action', '=', action)
      .where('resourceId', 'is not', null)
      .orderBy('resourceId')
      .orderBy('createdAt', 'desc')
      .execute();
    return rows.map(toAuditRow);
  }
}

function toAuditRow(r: {
  id: unknown;
  action: string;
  actorId: string | null;
  actorType: string;
  resourceType: string;
  resourceId: string | null;
  details: unknown;
  ipAddress: string | null;
  createdAt: unknown;
}): AuditRow {
  return {
    id: String(r.id),
    action: r.action,
    actorId: r.actorId ?? null,
    actorType: r.actorType,
    resourceType: r.resourceType,
    resourceId: r.resourceId ?? null,
    details: (r.details as Record<string, unknown> | null) ?? null,
    ipAddress: r.ipAddress ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}
