import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requirePostgresSchema, type PostgresSchemaRequirement } from '../src/exports/readiness.js';
import { POSTGRES_MAIL_OUTBOX_SCHEMA, POSTGRES_MAIL_OUTBOX_REQUIREMENTS, PostgresMailOutbox } from '../../titan-mailer/src/postgres.js';

// Explicit isolated database only: never use an application's DATABASE_URL.
describe.skipIf(!process.env['TEST_DATABASE_URL'])('Postgres mail component readiness', () => {
  let admin: Pool, pool: Pool, schema: string;
  beforeEach(async () => {
    schema = `mail_readiness_${randomUUID().replaceAll('-', '')}`;
    admin = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1, connectionTimeoutMillis: 5_000 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1, connectionTimeoutMillis: 5_000, options: `-c search_path=${schema},public` });
    await pool.query(POSTGRES_MAIL_OUTBOX_SCHEMA);
  });
  afterEach(async () => {
    await pool?.end();
    try { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin?.end(); }
  });

  it('accepts its real DDL on a read-only connection and leaves the owner pool usable', async () => {
    const contract: PostgresSchemaRequirement = POSTGRES_MAIL_OUTBOX_REQUIREMENTS;
    const readonly = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1,
      options: `-c search_path=${schema},public -c default_transaction_read_only=on` });
    try { await requirePostgresSchema(readonly, contract); }
    finally { await readonly.end(); }
    await pool.query("INSERT INTO mail_outbox(recipient,subject,body) VALUES('fixture@example.invalid','fixture','fixture')");
    await requirePostgresSchema(pool, contract);
    expect((await pool.query('SELECT count(*)::int AS n FROM mail_outbox')).rows[0].n).toBe(1);
    expect((await pool.query("SELECT tablename FROM pg_tables WHERE schemaname=$1 ORDER BY tablename", [schema])).rows.map(r => r.tablename))
      .toEqual(['mail_delivery_events', 'mail_outbox']);
  });

  it('qualifies the normal outbox producer and delivery path, not only catalog metadata', async () => {
    await requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS);
    const outbox = new PostgresMailOutbox({ pool, transaction: async (work) => {
      const client = await pool.connect();
      try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    } }, { messageIdDomain: 'fixture.example.invalid' });
    const inserted = await pool.query("INSERT INTO mail_outbox(recipient,subject,body) VALUES('fixture@example.invalid','fixture','fixture') RETURNING delivery_id");
    const id = inserted.rows[0].delivery_id;
    expect(await outbox.pending(10)).toEqual([id]);
    await outbox.deliver(id, async (message) => ({ messageId: message.messageId!, accepted: ['fixture@example.invalid'] }));
    expect((await outbox.status(id))?.state).toBe('accepted');
    expect(await outbox.pending(10)).toEqual([]);
  });

  it('accepts compatible additive migrations without consulting migration journals', async () => {
    await pool.query('CREATE TABLE unrelated_future_feature(id int PRIMARY KEY); ALTER TABLE mail_outbox ADD COLUMN optional_note text; ALTER TABLE mail_delivery_events ADD COLUMN revision int NOT NULL DEFAULT 1');
    await requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS);
  });

  it('refuses incompatible extra required inputs before delivery can start', async () => {
    await pool.query('ALTER TABLE mail_delivery_events ADD COLUMN required_context text NOT NULL');
    await expect(requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS)).rejects.toMatchObject({
      code: 'database_schema_incompatible', violations: expect.arrayContaining(['mail_delivery_events.required_context: additional column requires a value']),
    });
  });

  it('refuses a changed retry default even though a default still exists', async () => {
    await pool.query('ALTER TABLE mail_outbox ALTER COLUMN attempts SET DEFAULT 999');
    await expect(requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS)).rejects.toMatchObject({
      violations: expect.arrayContaining(['mail_outbox.attempts: required column shape']),
    });
  });

  it('refuses missing columns and removed delivery identity uniqueness', async () => {
    await pool.query('ALTER TABLE mail_outbox DROP COLUMN html; ALTER TABLE mail_outbox DROP CONSTRAINT mail_outbox_delivery_id_key');
    await expect(requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS)).rejects.toMatchObject({
      violations: expect.arrayContaining(['mail_outbox.html: required column shape', 'mail_outbox: unique key (delivery_id) required']),
    });
  });

  it('checks an explicit schema even if a different table is first on the search path', async () => {
    const direct = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1, options: '-c default_transaction_read_only=on' });
    try {
      await requirePostgresSchema(direct, { ...POSTGRES_MAIL_OUTBOX_REQUIREMENTS, schema });
      await expect(requirePostgresSchema(direct, { ...POSTGRES_MAIL_OUTBOX_REQUIREMENTS, schema: `${schema}_absent` })).rejects.toMatchObject({
        violations: expect.arrayContaining(['mail_outbox: physical table required']),
      });
    } finally { await direct.end(); }
  });

  it('refuses a generated replacement for a column the producer writes, while allowing read projections', async () => {
    await pool.query('ALTER TABLE mail_outbox DROP COLUMN subject; ALTER TABLE mail_outbox ADD COLUMN subject text GENERATED ALWAYS AS (body) STORED NOT NULL');
    await expect(requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS)).rejects.toMatchObject({
      violations: expect.arrayContaining(['mail_outbox.subject: required column shape']),
    });
    await requirePostgresSchema(pool, { name: 'reader', tables: { mail_outbox: { columns: { subject: { type: 'text', nullable: false } } } } });
    await requirePostgresSchema(pool, { name: 'derived-reader', tables: { mail_outbox: { columns: { subject: { type: 'text', nullable: false, generated: 'body' } } } } });
  });

  it('accepts a declared custom type and rejects an undeclared type namespace or narrowed precision', async () => {
    await pool.query("CREATE TYPE mood AS ENUM('ready','waiting'); CREATE TABLE component_values(state mood NOT NULL, amount numeric(12,2) NOT NULL)");
    const contract: PostgresSchemaRequirement = { name: 'typed-consumer', tables: { component_values: {
      columns: { state: { type: 'mood', typeSchema: schema, nullable: false }, amount: { type: 'numeric', formattedType: 'numeric(12,2)', nullable: false } }, insert: true,
    } } };
    await requirePostgresSchema(pool, contract);
    await expect(requirePostgresSchema(pool, { ...contract, tables: { component_values: { columns: { state: { type: 'mood', nullable: false } } } } })).rejects.toMatchObject({
      violations: expect.arrayContaining(['component_values.state: required column shape']),
    });
    await pool.query('ALTER TABLE component_values ALTER COLUMN amount TYPE numeric(4,1)');
    await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({
      violations: expect.arrayContaining(['component_values.amount: required column shape']),
    });
  });

  it('checks required routine return types, settings and security even when the function body is unchanged', async () => {
    const body = 'SELECT 1::bigint';
    await pool.query(`CREATE FUNCTION component_clock() RETURNS bigint LANGUAGE sql VOLATILE AS '${body}'`);
    const contract: PostgresSchemaRequirement = { name: 'clock-consumer', tables: {}, routines: [{
      name: 'component_clock', language: 'sql', volatility: 'v', returnType: 'bigint', configuration: [], bodySha256: createHash('sha256').update(body).digest('hex'),
    }] };
    await requirePostgresSchema(pool, contract);
    await pool.query('ALTER FUNCTION component_clock() SECURITY DEFINER');
    await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({ violations: ['component_clock: required database routine'] });
    await pool.query('ALTER FUNCTION component_clock() SECURITY INVOKER; ALTER FUNCTION component_clock() SET search_path TO pg_catalog');
    await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({ violations: ['component_clock: required database routine'] });
    await requirePostgresSchema(pool, { ...contract, routines: [{ ...contract.routines![0]!, configuration: ['search_path=pg_catalog'] }] });
    await pool.query(`DROP FUNCTION component_clock(); CREATE FUNCTION component_clock() RETURNS numeric LANGUAGE sql VOLATILE AS '${body}'`);
    await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({ violations: ['component_clock: required database routine'] });
  });

  it('bounds a real catalog lock wait and restores transaction-local timeouts before releasing the pool', async () => {
    const before = (await pool.query("SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock")).rows;
    const blocker = await admin.connect();
    try {
      await blocker.query('BEGIN');
      await blocker.query('LOCK TABLE pg_catalog.pg_class IN ACCESS EXCLUSIVE MODE');
      await expect(requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS, { lockTimeoutMs: 100, statementTimeoutMs: 2_000 })).rejects.toMatchObject({ code: '55P03' });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
    }
    expect((await pool.query("SELECT current_setting('statement_timeout') AS statement, current_setting('lock_timeout') AS lock")).rows).toEqual(before);
    await requirePostgresSchema(pool, POSTGRES_MAIL_OUTBOX_REQUIREMENTS);
  });

  it('binds routine search paths to a quoted namespace, with built-ins first and temporary objects last', async () => {
    const quotedSchema = `${schema}-quoted`;
    const body = 'SELECT 1::bigint';
    await pool.query(`CREATE SCHEMA "${quotedSchema}"; CREATE FUNCTION "${quotedSchema}".component_clock() RETURNS bigint LANGUAGE sql VOLATILE AS '${body}' SET search_path TO pg_catalog,"${quotedSchema}",pg_temp`);
    const contract: PostgresSchemaRequirement = { name: 'bound-clock', schema: quotedSchema, tables: {}, routines: [{
      name: 'component_clock', language: 'sql', volatility: 'v', returnType: 'bigint', schemaSearchPath: true, bodySha256: createHash('sha256').update(body).digest('hex'),
    }] };
    try {
      await requirePostgresSchema(pool, contract);
      await pool.query(`ALTER FUNCTION "${quotedSchema}".component_clock() SET search_path TO "${quotedSchema}",pg_catalog,pg_temp`);
      await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({ violations: ['component_clock: required database routine'] });
      await pool.query(`ALTER FUNCTION "${quotedSchema}".component_clock() SET search_path TO pg_catalog,"${quotedSchema}"`);
      await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({ violations: ['component_clock: required database routine'] });
    } finally { await pool.query(`DROP SCHEMA "${quotedSchema}" CASCADE`); }
  });
});
