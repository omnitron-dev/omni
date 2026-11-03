import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requirePostgresSchema, type PostgresSchemaRequirement } from '../src/exports/readiness.js';
import { POSTGRES_MAIL_OUTBOX_SCHEMA, POSTGRES_MAIL_OUTBOX_REQUIREMENTS, PostgresMailOutbox } from '../../titan-mailer/src/postgres.js';

// Explicit isolated database only: never use an application's DATABASE_URL.
describe.skipIf(!process.env['TEST_DATABASE_URL'])('Postgres mail component readiness', () => {
  let admin: Pool, pool: Pool, schema: string;
  beforeEach(async () => {
    schema = `mail_readiness_${randomUUID().replaceAll('-', '')}`;
    admin = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1, options: `-c search_path=${schema},public` });
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
});
