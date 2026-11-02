import { sql, type Kysely, type Transaction, type RawBuilder, type QueryResult } from 'kysely';

/** Apply through the application's migration runner, never implicitly at startup. */
export const POSTGRES_LEASE_SCHEMA_V1 = `CREATE TABLE titan_database_leases (
  key text PRIMARY KEY,
  owner text NOT NULL,
  incarnation text NOT NULL,
  epoch bigint NOT NULL CHECK (epoch > 0),
  expires_at timestamptz NOT NULL
)`;

export interface LeaseIdentity {
  key: string;
  owner: string;
  /** A fresh identifier for each controller lifetime. */
  incarnation: string;
}

export interface LeaseGrant extends LeaseIdentity {
  /** Decimal bigint; never round a fencing token through a JavaScript number. */
  epoch: string;
  expiresAt: string;
  /** Remaining duration measured by the database, not the client's wall clock. */
  remainingMs: number;
}

export interface LeaseStore {
  acquire(identity: LeaseIdentity, ttlMs: number): Promise<LeaseGrant | null>;
  renew(grant: LeaseGrant, ttlMs: number): Promise<LeaseGrant | null>;
  release(grant: LeaseGrant): Promise<boolean>;
  read(key: string): Promise<LeaseGrant | null>;
}

export class LeaseLostError extends Error {
  readonly code = 'LEASE_LOST';
  constructor() { super('Lease expired or belongs to another controller'); }
}

interface LeaseRow {
  key: string;
  owner: string;
  incarnation: string;
  epoch: string;
  expires_at: Date | string;
  remaining_ms: number;
}

const projection = sql`key, owner, incarnation, epoch::text, expires_at,
  greatest(0, floor(extract(epoch FROM (expires_at - clock_timestamp())) * 1000))::integer AS remaining_ms`;

function identity(value: LeaseIdentity): void {
  for (const field of ['key', 'owner', 'incarnation'] as const) {
    if (typeof value[field] !== 'string' || value[field].length < 1 || value[field].length > 256 || [...value[field]].some(char => char.charCodeAt(0) < 32)) {
      throw new TypeError(`Invalid lease ${field}`);
    }
  }
}

function ttl(value: number): void {
  if (!Number.isSafeInteger(value) || value < 100 || value > 86_400_000) {
    throw new TypeError('Lease TTL must be an integer from 100 to 86400000 milliseconds');
  }
}

function token(value: LeaseGrant): void {
  identity(value);
  if (!/^[1-9][0-9]{0,18}$/.test(value.epoch) || BigInt(value.epoch) > 9223372036854775807n) {
    throw new TypeError('Invalid lease epoch');
  }
}

function grant(row: LeaseRow | undefined): LeaseGrant | null {
  return row ? {
    key: row.key, owner: row.owner, incarnation: row.incarnation, epoch: row.epoch,
    expiresAt: new Date(row.expires_at).toISOString(), remainingMs: row.remaining_ms,
  } : null;
}

/**
 * A PostgreSQL-authoritative lease. All contenders must use the same writable
 * database; database failover must preserve committed epochs. This is not Raft.
 *
 * read/acquire/renew are observations, not authorization for later external I/O.
 * Fence database effects with withLease; remote effects need a recipient that
 * durably rejects stale epochs. Never delete rows to release a lease: doing so
 * would reset its epoch and permit a previously fenced controller to write again.
 */
export class PostgresLeaseStore<DB> implements LeaseStore {
  constructor(private readonly db: Kysely<DB>) {}

  private durable<T>(query: RawBuilder<T>): Promise<QueryResult<T>> {
    return this.db.transaction().execute(async trx => {
      // An asynchronous-commit application pool must not weaken authority.
      await sql`SET LOCAL synchronous_commit = on`.execute(trx);
      await sql`SET LOCAL lock_timeout = '2s'`.execute(trx);
      await sql`SET LOCAL statement_timeout = '5s'`.execute(trx);
      return query.execute(trx);
    });
  }

  async acquire(value: LeaseIdentity, ttlMs: number): Promise<LeaseGrant | null> {
    identity(value); ttl(ttlMs);
    const result = await this.durable(sql<LeaseRow>`INSERT INTO titan_database_leases AS existing
      (key, owner, incarnation, epoch, expires_at)
      VALUES (${value.key}, ${value.owner}, ${value.incarnation}, 1,
        clock_timestamp() + ${ttlMs} * interval '1 millisecond')
      ON CONFLICT (key) DO UPDATE SET
        owner = EXCLUDED.owner, incarnation = EXCLUDED.incarnation,
        epoch = CASE WHEN existing.expires_at > clock_timestamp()
          THEN existing.epoch ELSE existing.epoch + 1 END,
        expires_at = clock_timestamp() + ${ttlMs} * interval '1 millisecond'
      WHERE existing.expires_at <= clock_timestamp()
        OR (existing.owner = EXCLUDED.owner AND existing.incarnation = EXCLUDED.incarnation)
      RETURNING ${projection}`);
    return grant(result.rows[0]);
  }

  async renew(value: LeaseGrant, ttlMs: number): Promise<LeaseGrant | null> {
    token(value); ttl(ttlMs);
    const result = await this.durable(sql<LeaseRow>`UPDATE titan_database_leases SET
      expires_at = clock_timestamp() + ${ttlMs} * interval '1 millisecond'
      WHERE key = ${value.key} AND owner = ${value.owner} AND incarnation = ${value.incarnation}
        AND epoch = ${value.epoch}::bigint AND expires_at > clock_timestamp()
      RETURNING ${projection}`);
    return grant(result.rows[0]);
  }

  async release(value: LeaseGrant): Promise<boolean> {
    token(value);
    const result = await this.durable(sql`UPDATE titan_database_leases SET expires_at = '-infinity'::timestamptz
      WHERE key = ${value.key} AND owner = ${value.owner} AND incarnation = ${value.incarnation}
        AND epoch = ${value.epoch}::bigint RETURNING key`);
    return result.rows.length === 1;
  }

  async read(key: string): Promise<LeaseGrant | null> {
    identity({ key, owner: 'read', incarnation: 'read' });
    const result = await sql<LeaseRow & { standby: boolean }>`SELECT pg_is_in_recovery() AS standby, held.*
      FROM (VALUES (1)) AS single(n) LEFT JOIN LATERAL
      (SELECT ${projection} FROM titan_database_leases WHERE key = ${key} AND expires_at > clock_timestamp()) AS held ON true`.execute(this.db);
    const row = result.rows[0];
    if (!row || row.standby) throw new Error('Lease authority requires a PostgreSQL primary');
    return grant(row.key ? row : undefined);
  }

  /** Serialize an effect and lease transfer in one database transaction. */
  async withLease<T>(value: LeaseGrant, effect: (trx: Transaction<DB>) => Promise<T>): Promise<T> {
    token(value);
    return this.db.transaction().execute(async trx => {
      await sql`SET LOCAL synchronous_commit = on`.execute(trx);
      await sql`SET LOCAL lock_timeout = '2s'`.execute(trx);
      await sql`SET LOCAL statement_timeout = '5s'`.execute(trx);
      // Lock first, then check the database clock in a separate statement: a
      // blocked SELECT's predicate must not admit a lease that expired waiting.
      const row = await sql`SELECT key FROM titan_database_leases
        WHERE key = ${value.key} AND owner = ${value.owner} AND incarnation = ${value.incarnation}
          AND epoch = ${value.epoch}::bigint FOR UPDATE`.execute(trx);
      if (row.rows.length !== 1) throw new LeaseLostError();
      const current = await sql`SELECT key FROM titan_database_leases
        WHERE key = ${value.key} AND expires_at > clock_timestamp()`.execute(trx);
      if (current.rows.length !== 1) throw new LeaseLostError();
      const result = await effect(trx);
      const stillCurrent = await sql`SELECT key FROM titan_database_leases
        WHERE key = ${value.key} AND expires_at > clock_timestamp()`.execute(trx);
      if (stillCurrent.rows.length !== 1) throw new LeaseLostError();
      return result;
    });
  }
}
