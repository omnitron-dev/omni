/** Wire contracts shared by the CLI, Console and daemon. */

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
