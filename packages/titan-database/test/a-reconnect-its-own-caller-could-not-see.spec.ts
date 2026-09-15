/**
 * `getConnection()` reconnected, succeeded, and then reported the connection
 * unavailable — with the error from before the reconnect, for ever.
 *
 *     const info = this.connections.get(name);       // object A
 *     if (!info.connected && !info.connecting) {
 *       await this.reconnect(name);                  // close() DELETES A,
 *     }                                              // create() stores B
 *     if (!info.connected) {                         // still reading A
 *       throw Errors.unavailable(name, info.lastError …);
 *     }
 *
 * `reconnect` → `close` → `this.connections.delete(name)`, then
 * `createConnectionWithRetry` builds a **new** `ConnectionInfo`. The local
 * `info` still points at the discarded one, whose `connected` is false by
 * construction and whose `lastError` is whatever broke it originally. So the
 * recovery worked and the caller was told it had not — and told so using a
 * stale error message, which is what makes it look like a database that never
 * came back.
 *
 * Observed live on the dev stand: `daos-dev-postgres` answering in 114 ms
 * while storage returned
 *
 *     503  Service default is unavailable: Connection health check failed:
 *
 * to every public object read, and its own `ready()` reported `down`.
 *
 * And each attempt pays for it: `reconnect` tears the pool down and builds a
 * new one before the caller is told no, so a busy process rebuilt its pool
 * once per query.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';

import { DatabaseManager } from '../src/database.manager.js';

const TMP = mkdtempSync(join(tmpdir(), 'titan-db-stale-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const silentLogger = () => {
  const logger = {
    info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(),
    trace: vi.fn(), fatal: vi.fn(), child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

describe('a caller that triggers its own reconnect can see the result', () => {
  let manager: DatabaseManager | undefined;

  afterEach(async () => {
    await manager?.closeAll().catch(() => {});
    manager = undefined;
  });

  async function managerOnFile(name: string): Promise<DatabaseManager> {
    const created = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: join(TMP, `${name}.sqlite`) } },
      silentLogger() as never,
    );
    await created.init();
    manager = created;
    return created;
  }

  /** What a failed health check leaves behind: present, disconnected. */
  function markDisconnected(db: DatabaseManager, name = 'default') {
    const info = (db as unknown as { connections: Map<string, { connected: boolean; lastError?: Error }> })
      .connections.get(name)!;
    info.connected = false;
    info.lastError = new Error('health check failed earlier');
  }

  it('getConnection returns the reconnected connection', async () => {
    const db = await managerOnFile('get-connection');
    markDisconnected(db);

    const conn = await db.getConnection();
    await expect(sql`select 1`.execute(conn as never)).resolves.toBeDefined();
  });

  it('getExecutor does too', async () => {
    const db = await managerOnFile('get-executor');
    markDisconnected(db);

    const ex = await db.getExecutor();
    await expect(sql`select 1`.execute(ex as never)).resolves.toBeDefined();
  });

  it('and the bookkeeping says connected afterwards', async () => {
    const db = await managerOnFile('bookkeeping');
    markDisconnected(db);
    await db.getConnection();

    const info = (db as unknown as { connections: Map<string, { connected: boolean }> })
      .connections.get('default')!;
    expect(info.connected, 'the map must hold the live entry, not the discarded one').toBe(true);
  });

  it('a connection that truly cannot be rebuilt still reports unavailable', async () => {
    // Non-vacuity: the three above must not pass because the guard is gone.
    const db = await managerOnFile('genuinely-broken');
    const conns = (db as unknown as {
      connections: Map<string, { connected: boolean; config: { connection: string } }>;
    }).connections;
    const info = conns.get('default')!;
    info.connected = false;
    // A directory that does not exist: better-sqlite3 throws at construction.
    info.config.connection = join(TMP, 'no', 'such', 'dir', 'x.sqlite');

    await expect(db.getConnection()).rejects.toThrow(/default/);
  });
});
