import { afterEach, describe, expect, it, vi } from 'vitest';
import { Kysely, SqliteDialect, sql } from 'kysely';
import Database from 'better-sqlite3';
import { createMigrationRunner, createMigrationHistory, defineSqlMigration, defineMigrationConfig, executeMigrationOperation } from '../../src/migration/index.js';

const databases: Kysely<unknown>[] = [];
function database() {
  const db = new Kysely<unknown>({ dialect: new SqliteDialect({ database: new Database(':memory:') }) });
  databases.push(db);
  return db;
}
afterEach(async () => { await Promise.all(databases.splice(0).map(db => db.destroy())); });

describe('public Omnitron migration API', () => {
  it('inspects without writing, records checksums, rejects changed applied definitions', async () => {
    const db = database();
    const migration = defineSqlMigration('001', 'create table example (id integer)', 'drop table example');
    const runner = createMigrationRunner(db, [migration]);
    expect((await runner.inspect()).pending).toEqual(['001']);
    expect(await db.introspection.getTables()).toHaveLength(0);
    await runner.up();
    expect((await runner.inspect()).unknownChecksums).toEqual([]);
    await expect(createMigrationRunner(db, [{ ...migration, checksum: 'changed' }]).up()).rejects.toMatchObject({ name: 'MigrationChecksumError' });
    await runner.down();
    expect((await runner.inspect()).pending).toEqual(['001']);
  });

  it('rolls the schema and history back together when recording fails', async () => {
    const db = database();
    const runner = createMigrationRunner(db, [defineSqlMigration('001', 'create table example (id integer)')], {
      history: { ...createMigrationHistory(), insert: async () => { throw new Error('journal unavailable'); } },
    });
    await expect(runner.up()).rejects.toThrow('journal unavailable');
    expect((await runner.inspect()).executed).toEqual([]);
    expect((await db.introspection.getTables()).some(table => table.name === 'example')).toBe(false);
  });

  it('validates before connecting and preserves operation plus cleanup failures', async () => {
    const db = database();
    const connect = vi.fn(async () => ({ db, close: vi.fn(async () => {}) }));
    const config = defineMigrationConfig({ connect, migrations: [] });
    await expect(executeMigrationOperation(config, { action: 'down', steps: -1 })).rejects.toThrow('nonnegative');
    expect(connect).not.toHaveBeenCalled();
    const close = vi.fn(async () => { throw new Error('close failed'); });
    const broken = defineMigrationConfig({ connect: async () => ({ db, close }), migrations: [{ name: 'bad', up: async () => { throw new Error('migration failed'); } }] });
    const error = await executeMigrationOperation(broken, { action: 'up' }).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toHaveLength(2);
    expect(close).toHaveBeenCalledOnce();
  });
});
