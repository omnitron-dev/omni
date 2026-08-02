/**
 * RLS decorator compilation
 *
 * @Policy/@Allow/@Deny/@Filter/@BypassRLS used to write Reflect metadata
 * that nothing consumed — an annotated repository ran with ZERO filtering.
 * These tests cover the compiler (decorator metadata → @kysera/rls schema)
 * and the runtime path (compiled schema → rlsPlugin → filtered queries).
 *
 * SQLite in-memory — no Docker required.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Kysely, SqliteDialect, sql, type Generated } from 'kysely';
import BetterSqlite3 from 'better-sqlite3';
import { createExecutor } from '@kysera/executor';
import { rlsPlugin, defineRLSSchema, withRLSContextAsync } from '@kysera/rls';
import { TransactionAwareRepository } from '../src/repository/transaction-aware.repository.js';
import {
  Policy,
  Allow,
  Deny,
  Filter,
  BypassRLS,
  compileRLSDecorators,
  hasRLSDecorators,
  getDecoratorPlugins,
} from '../src/database.decorators.js';

interface DocsTable {
  id: Generated<number>;
  tenantId: string;
  ownerId: string;
  title: string;
}

interface TestDB {
  docs: DocsTable;
}

interface AuthCtx {
  auth: { userId?: string; tenantId?: string; roles: string[] };
}

@Policy()
class DocsRepo extends TransactionAwareRepository<TestDB, 'docs'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'docs');
  }

  @Filter()
  filterByTenant(ctx: AuthCtx): Record<string, unknown> {
    return { tenantId: ctx.auth.tenantId };
  }

  @BypassRLS()
  async adminCount(): Promise<number> {
    return this.count();
  }
}

@Policy({ table: 'docs', skipFor: ['admin'], defaultPolicy: 'deny' })
class MappingRepo extends TransactionAwareRepository<TestDB, 'docs'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'docs');
  }

  @Allow({ operations: ['select', 'update'], priority: 5 })
  ownDocs(ctx: AuthCtx, row: { ownerId?: string }): boolean {
    return row.ownerId === ctx.auth.userId;
  }

  @Deny({ operations: ['delete'] })
  noDeletes(): boolean {
    return true;
  }

  @Filter({ operations: ['select'] })
  tenantOnly(ctx: AuthCtx): Record<string, unknown> {
    return { tenantId: ctx.auth.tenantId };
  }
}

class PlainRepo extends TransactionAwareRepository<TestDB, 'docs'> {
  constructor(db: Kysely<TestDB>) {
    super(db, 'docs');
  }
}

describe('RLS decorator compilation', () => {
  describe('compileRLSDecorators', () => {
    it('returns null for repositories without RLS decorators', () => {
      expect(hasRLSDecorators(PlainRepo)).toBe(false);
      expect(compileRLSDecorators(PlainRepo, 'docs')).toBeNull();
    });

    it('is discovered by getDecoratorPlugins', () => {
      expect(getDecoratorPlugins(DocsRepo)).toContain('rls');
      expect(getDecoratorPlugins(PlainRepo)).not.toContain('rls');
    });

    it('maps operations, policy config, and bypass methods', () => {
      const compiled = compileRLSDecorators(MappingRepo, 'fallback_table');
      expect(compiled).not.toBeNull();

      // @Policy({ table: 'docs' }) wins over the fallback table name
      const tableConfig = compiled!.schema['docs'] as {
        policies: Array<{ type: string; operation: string | string[]; priority?: number }>;
        skipFor?: string[];
        defaultDeny?: boolean;
      };
      expect(tableConfig).toBeDefined();
      expect(tableConfig.skipFor).toEqual(['admin']);
      expect(tableConfig.defaultDeny).toBe(true);

      const types = tableConfig.policies.map((p) => p.type).sort();
      expect(types).toEqual(['allow', 'deny', 'filter']);

      // select→read, insert→create mapping
      const allowPolicy = tableConfig.policies.find((p) => p.type === 'allow')!;
      expect(allowPolicy.operation).toEqual(['read', 'update']);
      expect(allowPolicy.priority).toBe(5);

      const denyPolicy = tableConfig.policies.find((p) => p.type === 'deny')!;
      expect(denyPolicy.operation).toEqual(['delete']);

      // select-only decorator filter compiles to kysera's 'read'
      const filterPolicy = tableConfig.policies.find((p) => p.type === 'filter')!;
      expect(filterPolicy.operation).toBe('read');
    });

    it('lists @BypassRLS methods for system-context wrapping', () => {
      const compiled = compileRLSDecorators(DocsRepo, 'docs');
      expect(compiled!.bypassMethods).toContain('adminCount');
    });
  });

  describe('runtime enforcement through the compiled plugin', () => {
    let db: Kysely<TestDB>;
    let repo: DocsRepo;

    beforeEach(async () => {
      db = new Kysely<TestDB>({
        dialect: new SqliteDialect({ database: new BetterSqlite3(':memory:') }),
      });
      await sql`
        CREATE TABLE docs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          "tenantId" TEXT NOT NULL,
          "ownerId" TEXT NOT NULL,
          title TEXT NOT NULL
        )
      `.execute(db);

      // Seed through the RAW db — RLS must not apply to fixtures
      await db
        .insertInto('docs')
        .values([
          { tenantId: 't1', ownerId: 'u1', title: 'alpha' },
          { tenantId: 't1', ownerId: 'u2', title: 'beta' },
          { tenantId: 't2', ownerId: 'u3', title: 'gamma' },
        ])
        .execute();

      const holder: { current?: object } = {};
      const compiled = compileRLSDecorators(DocsRepo, 'docs', () => holder.current)!;
      const executor = await createExecutor(db, [
        rlsPlugin({ schema: defineRLSSchema(compiled.schema as never) }),
      ]);
      repo = new DocsRepo(executor as Kysely<TestDB>);
      holder.current = repo;
    });

    afterEach(async () => {
      await db.destroy();
    });

    it('@Filter scopes reads to the context tenant', async () => {
      const result = await withRLSContextAsync(
        { auth: { userId: 'u1', tenantId: 't1', roles: [] } } as never,
        async () => repo.list({ orderBy: 'id' })
      );
      expect(result.data).toHaveLength(2);
      expect(result.data.every((row) => row.tenantId === 't1')).toBe(true);

      const other = await withRLSContextAsync(
        { auth: { userId: 'u3', tenantId: 't2', roles: [] } } as never,
        async () => repo.list({ orderBy: 'id' })
      );
      expect(other.data).toHaveLength(1);
      expect(other.data[0]?.title).toBe('gamma');
    });

    it('queries without an RLS context are rejected (requireContext)', async () => {
      await expect(repo.list({ orderBy: 'id' })).rejects.toThrow();
    });
  });
});
