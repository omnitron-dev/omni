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

/**
 * And the background loop looks at the connections that are DOWN.
 *
 * `runHealthChecks` iterated only entries whose `connected` was true, so it
 * stopped watching a connection at exactly the moment it needed watching: one
 * that failed to establish at boot, and one whose reconnect after a failed
 * check did not take, both stayed down until something else happened to ask
 * for them. An entry that is explicitly closed is DELETED from the map rather
 * than marked, so "present and down" already means "wanted".
 */
describe('the health check loop recovers what is down', () => {
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

  const entry = (db: DatabaseManager, name = 'default') =>
    (db as unknown as {
      connections: Map<string, { connected: boolean; permanent?: boolean; lastError?: Error; config: { connection: string } }>;
    }).connections.get(name)!;

  it('a tick brings back a connection that is registered and down', async () => {
    const db = await managerOnFile('loop-recovers');
    const info = entry(db);
    info.connected = false;
    info.lastError = new Error('health check failed earlier');

    await (db as unknown as { runHealthChecks(): Promise<void> }).runHealthChecks();

    expect(entry(db).connected).toBe(true);
  });

  it('and the recovered connection actually answers', async () => {
    const db = await managerOnFile('loop-answers');
    entry(db).connected = false;

    await (db as unknown as { runHealthChecks(): Promise<void> }).runHealthChecks();

    // Through the map's own instance, NOT `getConnection()` — that path
    // reconnects lazily on its own, so asking it would measure the lazy fix
    // rather than the loop.
    const live = (db as unknown as {
      connections: Map<string, { instance: unknown }>;
    }).connections.get('default')!.instance;
    await expect(sql`select 1`.execute(live as never)).resolves.toBeDefined();
  });

  /** Counts the attempts, because the OUTCOME is `down` either way. */
  function spyOnReconnect(db: DatabaseManager): string[] {
    const calls: string[] = [];
    const self = db as unknown as { reconnect(name: string): Promise<void> };
    const original = self.reconnect.bind(db);
    self.reconnect = async (name: string) => {
      calls.push(name);
      return original(name);
    };
    return calls;
  }

  it('a failure the driver calls permanent is not ATTEMPTED again', async () => {
    // Asserting it stays down would pass whether or not the loop tried: a
    // misconfiguration fails on every attempt. What must not happen is the
    // attempt — once per tick, forever, each one building a pool.
    const db = await managerOnFile('loop-permanent');
    const info = entry(db);
    info.connected = false;
    info.permanent = true;
    info.config.connection = join(TMP, 'no', 'such', 'dir', 'x.sqlite');
    const calls = spyOnReconnect(db);

    await (db as unknown as { runHealthChecks(): Promise<void> }).runHealthChecks();

    expect(calls, 'the loop must not retry what retrying cannot fix').toEqual([]);
    expect(entry(db).connected).toBe(false);
  });

  it('a transient failure IS attempted', async () => {
    // The control for the assertion above.
    const db = await managerOnFile('loop-transient');
    entry(db).connected = false;
    const calls = spyOnReconnect(db);

    await (db as unknown as { runHealthChecks(): Promise<void> }).runHealthChecks();

    expect(calls).toEqual(['default']);
  });

  it('two overlapping ticks produce one attempt', async () => {
    // `setInterval` does not await the tick, and `reconnect` tears a pool down
    // and builds another, so this property has to hold.
    //
    // It currently holds twice over: `close()` deletes the entry from the map
    // synchronously, so a tick that starts afterwards sees nothing to recover,
    // AND the `recovering` set refuses a second attempt. Removing either one
    // alone therefore leaves this green — it pins the PROPERTY, not one of the
    // two mechanisms, which is what matters if either is rewritten.
    const db = await managerOnFile('loop-overlap');
    entry(db).connected = false;
    const calls = spyOnReconnect(db);

    const run = () => (db as unknown as { runHealthChecks(): Promise<void> }).runHealthChecks();
    await Promise.all([run(), run()]);

    expect(calls).toEqual(['default']);
  });

  it('a connection that was explicitly closed is not resurrected', async () => {
    // `close()` deletes the entry, so there is nothing for the loop to see.
    const db = await managerOnFile('loop-closed');
    await db.close('default');

    await (db as unknown as { runHealthChecks(): Promise<void> }).runHealthChecks();

    expect(
      (db as unknown as { connections: Map<string, unknown> }).connections.has('default'),
    ).toBe(false);
  });
});

/**
 * The same shape, one field over: the circuit breaker was read BEFORE the
 * connection it protects.
 *
 *     const breaker = this.circuitBreakers.get(name);
 *     const db = await this.getConnection(name);      // may reconnect…
 *     if (breaker) return breaker.execute(() => fn(db));
 *
 * `getConnection` reconnects a connection that is down, and `createConnection`
 * installs a NEW `CircuitBreaker` at the same key. So the call ran on the
 * object the reconnect had just replaced: every failure counted there was
 * invisible to the breaker everyone else consults, and a breaker left open
 * refused a call the fresh connection would have served.
 *
 * Found by sweeping for the shape the `getConnection` bug had — a reference
 * taken from a registry and used across an `await` that can replace the entry.
 * Fifteen candidates across the packages, and this was the only other one.
 */
describe('the circuit breaker belongs to the connection that ends up serving', () => {
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

  const breakers = (db: DatabaseManager) =>
    (db as unknown as { circuitBreakers: Map<string, { execute(f: () => unknown): unknown }> }).circuitBreakers;

  it('a call that triggers a reconnect does not run on the replaced breaker', async () => {
    const db = await managerOnFile('breaker-replaced');
    const before = breakers(db).get('default')!;
    let ranOnOld = false;
    const original = before.execute.bind(before);
    before.execute = (f: () => unknown) => {
      ranOnOld = true;
      return original(f);
    };

    // What a failed health check leaves behind.
    (db as unknown as { connections: Map<string, { connected: boolean }> })
      .connections.get('default')!.connected = false;

    await db.withCircuitBreaker('default', async () => 'ok');

    expect(breakers(db).get('default'), 'the reconnect installs a new one').not.toBe(before);
    expect(ranOnOld, 'the call must run on the breaker that is current').toBe(false);
  });

  it('and an ordinary call still runs on the one breaker there is', async () => {
    // Non-vacuity: the assertion above must not pass because the breaker is
    // never used at all.
    const db = await managerOnFile('breaker-ordinary');
    const breaker = breakers(db).get('default')!;
    let ran = false;
    const original = breaker.execute.bind(breaker);
    breaker.execute = (f: () => unknown) => {
      ran = true;
      return original(f);
    };

    await expect(db.withCircuitBreaker('default', async () => 'ok')).resolves.toBe('ok');
    expect(ran).toBe(true);
  });

  it('closing a connection takes its breaker with it', async () => {
    const db = await managerOnFile('breaker-closed');
    expect(breakers(db).has('default')).toBe(true);

    await db.close('default');

    expect(breakers(db).has('default'), 'it answered for a connection that no longer existed').toBe(
      false,
    );
  });
});

/**
 * And what the caller is told does not include why.
 *
 * `Errors.unavailable(service, reason)` puts its reason in the message AND in
 * `details`, and both cross the wire. Measured on the live stand, a paysys 503
 * reached the client as
 *
 *     details: { service: 'default', reason: 'Connection health check failed: ' }
 *
 * — empty after the colon only because that build predated `describeError`.
 * With it, the same field carries `connect ECONNREFUSED 127.0.0.1:5432`, or a
 * SQLSTATE like `28P01` for a password that did not work.
 *
 * None of which a caller can act on, and an anonymous one should not read. The
 * cause is not lost: `createConnection`'s catch and `handleHealthCheckFailure`
 * both write it through `describeError`, which is what that helper is for.
 */
describe('a caller is told the connection is down, not why', () => {
  let manager: DatabaseManager | undefined;

  afterEach(async () => {
    await manager?.closeAll().catch(() => {});
    manager = undefined;
  });

  it('the error carries no driver text, in the message or the details', async () => {
    const created = new DatabaseManager(
      { connection: { dialect: 'sqlite', connection: join(TMP, 'no-leak.sqlite') } },
      silentLogger() as never,
    );
    await created.init();
    manager = created;

    // A connection that is down AND cannot be rebuilt, so the thrown error is
    // the real one the driver produced rather than a planted string.
    const badPath = join(TMP, 'no', 'such', 'dir', 'x.sqlite');
    const info = (created as unknown as {
      connections: Map<string, { connected: boolean; config: { connection: string } }>;
    }).connections.get('default')!;
    info.connected = false;
    info.config.connection = badPath;

    const err = await created.getConnection().then(
      () => null,
      (e: unknown) => e as { message: string; details?: Record<string, unknown> },
    );

    expect(err, 'a connection that cannot be rebuilt must refuse').not.toBeNull();

    // Structural, so it cannot go vacuous: `Errors.unavailable` writes its
    // reason into `details.reason`, and there must not be one.
    expect(err!.details?.['reason'], 'the cause belongs in the log').toBeUndefined();

    const seen = `${err!.message} ${JSON.stringify(err!.details ?? {})}`;
    expect(seen, 'the connection name is fine — it is not a secret').toContain('default');
    // The driver's own sentence, measured rather than guessed: better-sqlite3
    // says "Cannot open database because the directory does not exist". A
    // first version of this test looked for `ENOENT` and the path, neither of
    // which that driver produces, so it passed with the leak restored.
    expect(seen).not.toContain('Cannot open database');
    expect(seen).not.toContain('directory does not exist');
    expect(seen).not.toContain(badPath);
  });
});
