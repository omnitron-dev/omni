import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { requirePostgresSchema, type PostgresSchemaRequirement } from '../src/exports/readiness.js';

// Explicit test database only; every case owns and removes its own schema.
describe.skipIf(!process.env['TEST_DATABASE_URL'])('Postgres unique key readiness', () => {
  let admin: Pool, pool: Pool, schema: string;
  const contract: PostgresSchemaRequirement = { name: 'indexed-component', tables: { entries: {
    columns: { tenant: { type: 'int4', nullable: false }, id: { type: 'int4', nullable: false } },
    unique: [['tenant', 'id']],
  } } };
  beforeEach(async () => {
    schema = `index_readiness_${randomUUID().replaceAll('-', '')}`;
    admin = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1, connectionTimeoutMillis: 5_000 });
    await admin.query(`CREATE SCHEMA ${schema}`);
    pool = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1, connectionTimeoutMillis: 5_000,
      options: `-c search_path=${schema},public` });
    await pool.query('CREATE TABLE entries(tenant integer NOT NULL, id integer NOT NULL, payload text)');
  });
  afterEach(async () => {
    await pool?.end();
    try { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await admin?.end(); }
  });

  it('accepts a standalone unique index used by an actual foreign key on a read-only connection', async () => {
    await pool.query(`CREATE UNIQUE INDEX entry_identity ON entries(tenant,id);
      CREATE TABLE reports(tenant integer NOT NULL, id integer NOT NULL,
        FOREIGN KEY(tenant,id) REFERENCES entries(tenant,id));
      INSERT INTO entries VALUES(1,2,'original'); INSERT INTO reports VALUES(1,2)`);
    const readonly = new Pool({ connectionString: process.env['TEST_DATABASE_URL'], max: 1,
      connectionTimeoutMillis: 5_000, options: `-c search_path=${schema},public -c default_transaction_read_only=on` });
    try {
      await requirePostgresSchema(readonly, { ...contract, tables: { ...contract.tables, reports: {
        columns: contract.tables.entries!.columns,
        foreignKeys: [{ columns: ['tenant', 'id'], table: 'entries', references: ['tenant', 'id'] }],
      } } });
    } finally { await readonly.end(); }
    expect((await pool.query('SELECT * FROM entries')).rows).toEqual([{ tenant: 1, id: 2, payload: 'original' }]);
    await expect(pool.query("INSERT INTO entries VALUES(1,2,'duplicate')")).rejects.toMatchObject({ code: '23505' });
    await expect(pool.query('INSERT INTO reports VALUES(2,3)')).rejects.toMatchObject({ code: '23503' });
  });

  it('checks only key columns, not INCLUDE payload columns', async () => {
    await pool.query('CREATE UNIQUE INDEX entry_identity ON entries(tenant,id) INCLUDE(payload)');
    await requirePostgresSchema(pool, contract);
  });

  it.each(['PRIMARY KEY', 'UNIQUE'])('continues to accept an immediate %s constraint', async (kind) => {
    await pool.query(`ALTER TABLE entries ADD CONSTRAINT entry_identity ${kind}(tenant,id)`);
    await requirePostgresSchema(pool, contract);
  });

  it.each([
    ['non-unique', 'CREATE INDEX entry_identity ON entries(tenant,id)'],
    ['partial', 'CREATE UNIQUE INDEX entry_identity ON entries(tenant,id) WHERE tenant>0'],
    ['expression', 'CREATE UNIQUE INDEX entry_identity ON entries(tenant,(id+0))'],
    ['additional key', 'CREATE UNIQUE INDEX entry_identity ON entries(tenant,id,payload)'],
    ['included instead of key', 'CREATE UNIQUE INDEX entry_identity ON entries(tenant) INCLUDE(id)'],
    ['deferred', 'ALTER TABLE entries ADD CONSTRAINT entry_identity UNIQUE(tenant,id) DEFERRABLE INITIALLY IMMEDIATE'],
  ])('refuses a %s index as the declared immediate whole-table key', async (_kind, ddl) => {
    await pool.query(ddl!);
    await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({
      code: 'database_schema_incompatible',
      violations: expect.arrayContaining(['entries: unique key (tenant,id) required']),
    });
  });

  it('refuses the invalid index left by a failed concurrent unique build', async () => {
    await pool.query("INSERT INTO entries VALUES(1,2,'first'),(1,2,'duplicate')");
    await expect(pool.query('CREATE UNIQUE INDEX CONCURRENTLY entry_identity ON entries(tenant,id)'))
      .rejects.toMatchObject({ code: '23505' });
    const result = await pool.query(`SELECT indisunique,indisvalid FROM pg_catalog.pg_index
      WHERE indexrelid=$1::regclass`, [`${schema}.entry_identity`]);
    expect(result.rows).toEqual([{ indisunique: true, indisvalid: false }]);
    await expect(requirePostgresSchema(pool, contract)).rejects.toMatchObject({
      violations: expect.arrayContaining(['entries: unique key (tenant,id) required']),
    });
  });
});
