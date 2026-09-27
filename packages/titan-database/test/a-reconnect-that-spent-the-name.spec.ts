/**
 * A reconnect that spent the name it was rebuilding.
 *
 * `reconnect()` tore the stale connection down by calling `close()` — and
 * `close()` means «this name is not wanted any more». `recoverConnection`'s own
 * docblock says so: an explicitly closed connection is DELETED from the map
 * rather than marked, so «present and down» already means «wanted». So a
 * reconnect deleted the entry first and rebuilt it after; and if the teardown
 * did not finish, there was no entry left for anything to rebuild. The sweep
 * visits entries it can see. `getConnection` answers a missing name with
 * `Errors.notFound`, whose message is
 *
 *     Database connection with id default not found
 *
 * which is the line both stands showed. dev, 2026-09-27 from 03:27Z: paysys 1667
 * lines, priceverse 1266, messaging 465, storage 153, until the apps were
 * restarted. test, priceverse: four «Attempting to reconnect» on 2026-09-20 at
 * 12:53Z, then that line from 17:31Z on 09-20 to 21:49Z on 09-26 — six days with
 * no database, ended by a deployment. Two pg sessions sat in `pg_stat_activity`
 * with an empty `query` from the first minute: a client checked out of the pool,
 * so `pool.end()` never returned.
 *
 * And the `try/catch` around the teardown did not help, because a `destroy()`
 * that never settles does not throw. `closeAll` had already learned that — «a
 * driver that never settles its destroy() … otherwise holds the process open
 * forever. We stop waiting; we do not cancel, because the driver gives us no way
 * to» — eighty lines away, on the shutdown path.
 *
 * Held here: through a teardown that never returns, the name never leaves the
 * registry, the replacement is built without waiting for it, and a rebuild that
 * FAILS leaves the entry wanted rather than stuck.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';

import { DatabaseManager } from '../src/database.manager.js';

const TMP = mkdtempSync(join(tmpdir(), 'titan-db-spent-name-'));
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

/** What the stands had: a driver whose destroy never settles. */
const NEVER = () => new Promise<void>(() => {});

describe('a reconnect whose teardown never returns', () => {
  let manager: DatabaseManager | undefined;

  afterEach(async () => {
    await manager?.closeAll().catch(() => {});
    manager = undefined;
  });

  async function managerOnFile(name: string): Promise<DatabaseManager> {
    const created = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: join(TMP, `${name}.sqlite`) },
        // The suite's own bound, and the reason it can report at all. `afterEach`
        // closes the manager, and a teardown that never settles is exactly what
        // these cases install — `closeAll` waits on it only if `shutdownTimeout`
        // says how long. Without this the runner did not exit and the file printed
        // no verdict for 300 s: the defect under test silenced the court about
        // itself. (Nothing in the platform sets this option, so `closeAll` is
        // unbounded in production too — a separate matter, with its own fix.)
        shutdownTimeout: 500,
      },
      silentLogger() as never
    );
    await created.init();
    manager = created;
    return created;
  }

  /**
   * A reconnect nobody can wait on for ever.
   *
   * Every case here drives the real `reconnect`, and the defect it is about is a
   * teardown that never settles — so an unbounded `await` would hang the FILE
   * rather than fail a case. Measured: with the teardown awaited again, the suite
   * did not finish in 300 s and printed no verdict at all. Bounded, each case
   * says which promise never settled.
   */
  async function rebuild(db: DatabaseManager): Promise<'rebuilt' | 'stuck' | Error> {
    return Promise.race([
      (db as unknown as { reconnect(n: string): Promise<void> }).reconnect('default').then(
        () => 'rebuilt' as const,
        (error: Error) => error
      ),
      new Promise<'stuck'>((resolve) => {
        const t = setTimeout(() => resolve('stuck'), 4000);
        t.unref?.();
      }),
    ]);
  }

  /** The map the manager keeps its connections in, and the entry for `default`. */
  const registry = (db: DatabaseManager) =>
    (db as unknown as { connections: Map<string, { instance: { destroy: () => Promise<void> }; connecting: boolean; connected: boolean; config: { connection?: unknown } }> }).connections;

  it('rebuilds the connection without waiting for the stale one', async () => {
    const db = await managerOnFile('rebuilds');
    const stale = registry(db).get('default')!;
    stale.instance.destroy = NEVER;

    expect(await rebuild(db)).toBe('rebuilt');

    // And the connection that came out of it works.
    const live = await db.getConnection('default');
    await expect(sql`select 1`.execute(live as never)).resolves.toBeDefined();
  });

  it('never lets the name leave the registry, not for an instant', async () => {
    const db = await managerOnFile('keeps-name');
    registry(db).get('default')!.instance.destroy = NEVER;

    const inFlight = rebuild(db);

    // Synchronously after the call: the old code had already deleted it here.
    expect(registry(db).has('default')).toBe(true);
    // And at the first await point a consumer could reach.
    await Promise.resolve();
    expect(registry(db).has('default')).toBe(true);

    expect(await inFlight).toBe('rebuilt');
    expect(registry(db).has('default')).toBe(true);
  });

  it('answers a consumer «unavailable», never «not found», while it rebuilds', async () => {
    const db = await managerOnFile('unavailable');
    const stale = registry(db).get('default')!;
    stale.instance.destroy = NEVER;
    // A config the rebuild cannot satisfy: a directory that does not exist is a
    // PERMANENT failure, so `createConnectionWithRetry` gives up at once rather
    // than spending its retry budget.
    stale.config.connection = join(TMP, 'no-such-directory', 'x.sqlite');

    expect(await rebuild(db)).toBeInstanceOf(Error);

    // The entry survived a FAILED rebuild, so `getConnection` can say what is
    // true. It retries the reconnect itself, which fails again, and then reports
    // the verdict: unavailable — not «no such connection».
    //
    // This one is a STATEMENT of the consumer-visible verdict, not a
    // discriminator for the fix: `createConnection`'s catch installs its own
    // failed entry, so the name is back either way. Measured — with the name
    // deleted again, this case stayed green and only «never lets the name leave
    // the registry» went red.
    await expect(db.getConnection('default')).rejects.toThrow(/unavailable/i);
  });

  it('leaves a failed rebuild WANTED rather than stuck at «connecting»', async () => {
    const db = await managerOnFile('wanted');
    const stale = registry(db).get('default')!;
    stale.instance.destroy = NEVER;
    stale.config.connection = join(TMP, 'no-such-directory', 'y.sqlite');

    expect(await rebuild(db)).toBeInstanceOf(Error);

    // The recovery sweep skips an entry that is `connecting`, so a rebuild that
    // failed while holding that flag would never be visited again — the same dead
    // end by another road. What keeps that true is `createConnection`'s catch:
    // `info.connecting = false; this.connections.set(name, info)`. So this case
    // holds a guarantee that lives THERE, and a plant removing that `set` is what
    // reddens it — not anything in `reconnect`.
    const after = registry(db).get('default')!;
    expect({ present: true, connecting: after.connecting, connected: after.connected }).toEqual({
      present: true,
      connecting: false,
      connected: false,
    });
  });

  it('close() still forgets the name — that is what close is for', async () => {
    const db = await managerOnFile('closes');
    await db.close('default');
    expect(registry(db).has('default')).toBe(false);
  });
});
