/**
 * PostgreSQL uuid_v7() Function — Database-Level UUIDv7 Generation
 *
 * Provides SQL helpers to create/drop a `uuid_v7()` PL/pgSQL function
 * for use as DEFAULT column values in PostgreSQL tables.
 *
 * @module database/uuid-v7
 */

import { sql, type Kysely } from 'kysely';

/** SQL expression for use as column DEFAULT value: `uuid_v7()` */
export const UUID_V7_DEFAULT = sql`uuid_v7()`;

/**
 * Create the `uuid_v7()` PL/pgSQL function in PostgreSQL (idempotent).
 */
export async function createUuidV7Function(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
    DECLARE
      unix_ts_ms bytea;
      uuid_bytes bytea;
    BEGIN
      unix_ts_ms = substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
      uuid_bytes = unix_ts_ms || gen_random_bytes(10);
      uuid_bytes = set_byte(uuid_bytes, 6, (b'0111' || get_byte(uuid_bytes, 6)::bit(4))::bit(8)::int);
      uuid_bytes = set_byte(uuid_bytes, 8, (b'10'   || get_byte(uuid_bytes, 8)::bit(6))::bit(8)::int);
      RETURN encode(uuid_bytes, 'hex')::uuid;
    END
    $$ LANGUAGE plpgsql VOLATILE
  `.execute(db);
}

/**
 * Drop the `uuid_v7()` PL/pgSQL function.
 */
export async function dropUuidV7Function(db: Kysely<any>): Promise<void> {
  await sql`DROP FUNCTION IF EXISTS uuid_v7()`.execute(db);
}
