/**
 * A consumer that resolved the connection once must survive a reconnect.
 *
 * `DATABASE_CONNECTION` is a Singleton provider whose factory calls
 * `manager.getConnection()` exactly once, and every repository built by
 * `forFeature` captures the value it is given in its constructor
 * (`super(db, table)`). Reconnection, meanwhile, replaces the object:
 * `reconnect()` calls `close()` — which runs `instance.destroy()` and drops
 * the entry — and then builds a brand new `Kysely` (and a new executor).
 *
 * So after the first reconnect, every repository in the process held a
 * destroyed Kysely and every query failed with
 *
 *     driver has already been destroyed
 *       at RuntimeDriver.acquireConnection
 *
 * permanently, until the process was restarted. This was observed in the dev
 * environment as 33 consecutive `[CachePurge] tick failed` warnings over five
 * hours while the application reported itself online — a background job was
 * simply the only consumer that logged; ordinary RPC calls returned the error
 * to their callers.
 *
 * A health check that decides a connection is bad is enough to trigger it, so
 * one slow database moment permanently disabled data access process-wide.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application } from '@omnitron-dev/titan/application';
import { Module } from '@omnitron-dev/titan/decorators';

import { DatabaseManager } from '../src/database.manager.js';
import {
  TitanDatabaseModule,
  Repository,
  TransactionAwareRepository,
  DATABASE_MANAGER,
  getRepositoryToken,
} from '../src/index.js';
import { sql } from 'kysely';

const TMP = mkdtempSync(join(tmpdir(), 'titan-db-reconnect-'));

// File scope: a per-suite afterAll would delete the directory the next suite needs.
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const silentLogger = () => {
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

describe('a resolved connection survives reconnection', () => {
  let manager: DatabaseManager | undefined;

  afterEach(async () => {
    await manager?.closeAll().catch(() => {});
    manager = undefined;
  });


  async function managerOnFile(name: string): Promise<DatabaseManager> {
    const created = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: join(TMP, `${name}.sqlite`) } },
      silentLogger() as never
    );
    await created.init();
    manager = created;
    return created;
  }

  it('keeps serving queries through the same reference after a reconnect', async () => {
    const db = await managerOnFile('survives');

    // What a repository does: resolve once, hold forever.
    const held = db.getConnectionRef();
    await sql`select 1`.execute(held as never);

    // What a failed health check does.
    await db['reconnect']('default');

    // The reference the repository still holds must keep working.
    await expect(sql`select 1`.execute(held as never)).resolves.toBeDefined();
  });

  it('keeps working across several reconnects', async () => {
    const db = await managerOnFile('repeated');
    const held = db.getConnectionRef();

    for (let i = 0; i < 3; i++) {
      await db['reconnect']('default');
      await expect(sql`select 1`.execute(held as never)).resolves.toBeDefined();
    }
  });

  it('reports a connection that is genuinely gone, not a destroyed driver', async () => {
    // Closing for good is different from reconnecting: the reference must fail,
    // but with an error that names the connection rather than leaking Kysely's
    // "driver has already been destroyed" from deep inside the query.
    const db = await managerOnFile('closed');
    const held = db.getConnectionRef();

    await db.close('default');

    await expect(sql`select 1`.execute(held as never)).rejects.toThrow(/default/);
  });

  it('an executor obtained with explicit plugins also survives', async () => {
    // forFeature resolves repositories through getExecutor(name, plugins) when
    // the repository declares any, so that path needs the same guarantee.
    const db = await managerOnFile('executor');
    const held = db.getExecutorRef('default', []);

    await db['reconnect']('default');

    await expect(sql`select 1`.execute(held as never)).resolves.toBeDefined();
  });
});

describe('a repository resolved through forFeature survives reconnection', () => {
  // The production path: a Singleton repository captures `db` in its
  // constructor and is never rebuilt, so this is what actually broke in the
  // dev environment.
  @Repository<{ id: number }>({ table: 'widgets' })
  class WidgetRepository extends TransactionAwareRepository<any, 'widgets'> {
    async count(): Promise<number> {
      const row = await this.executor
        .selectFrom(this.tableName as never)
        .select(({ fn }) => fn.countAll<number>().as('count'))
        .executeTakeFirst();
      return Number((row as { count?: number } | undefined)?.count ?? 0);
    }
  }

  @Module({ imports: [TitanDatabaseModule.forFeature([WidgetRepository])] })
  class WidgetModule {}

  let app: Application | undefined;

  afterEach(async () => {
    await app?.stop().catch(() => {});
    app = undefined;
  });

  it('keeps querying after the connection behind it is replaced', async () => {
    const file = join(TMP, 'repo.sqlite');
    app = await Application.create({
      imports: [
        TitanDatabaseModule.forRoot({ connection: { dialect: 'sqlite', connection: file } }),
        WidgetModule,
      ],
      disableGracefulShutdown: true,
    } as never);
    await app.start();

    const manager = await app.resolveAsync<DatabaseManager>(DATABASE_MANAGER as never);
    const db = await manager.getConnection();
    await sql`create table if not exists widgets (id integer primary key)`.execute(db as never);

    const repo = await app.resolveAsync<WidgetRepository>(getRepositoryToken(WidgetRepository) as never);
    expect(await repo.count()).toBe(0);

    await manager['reconnect']('default');

    // Before the fix this threw "driver has already been destroyed" and kept
    // throwing it for the life of the process.
    expect(await repo.count()).toBe(0);
  }, 60_000);
});
