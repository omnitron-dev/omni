/**
 * A shutdown that waited for a driver that never answered.
 *
 * `closeAll()` has a paragraph explaining why the wait must be bounded: «a driver
 * that never settles its destroy() — a pg client stuck mid-query, a socket with no
 * keepalive — otherwise holds the process open forever and shutdown is decided by
 * whatever SIGKILLs it». The bound it names is `options.shutdownTimeout`, and it was
 * optional with no default.
 *
 * Measured 2026-09-27: nobody passes it. Not this module, not daos's
 * `createDatabaseModuleFactory`, not one `DatabaseModule.forRootAsync` call in seven
 * apps — they set pools, plugins and RLS, and never this. So every process in the
 * platform took the unbounded branch and the paragraph above described a protection
 * that was not in force anywhere. One checked-out pg client is enough: two of them
 * sat in `pg_stat_activity` with an empty `query` for hours on dev the same day,
 * which is what `a-reconnect-that-spent-the-name` is about — the same driver, the
 * other path.
 *
 * And 0 meant the opposite of what a caller passing it means. The guard read
 * `!== undefined && > 0`, so both «0» and «nothing» fell into the unbounded await:
 * asking to stop immediately asked to wait for ever. titan-pm records the same trap
 * in its own option, where `shutdownTimeout: 0` reached the child as 5000 ms.
 *
 * Held here: the default is applied when nobody asks, a teardown that never settles
 * does not hold the shutdown, 0 does not wait at all, and a healthy close still
 * reports what it did.
 *
 * One of the five is a check on the SOURCE, deliberately. The behavioural proof that
 * the DEFAULT bounds the wait would have to let a hung destroy run to
 * `DEFAULT_SHUTDOWN_TIMEOUT_MS` — ten seconds on every run of this file, against the
 * two it takes now — so instead the last case pins the one-door property that makes
 * the other four sufficient: `closeAll` reads the normalised getter and never
 * `options.shutdownTimeout`. Reverting the wait to read the option directly is
 * exactly the regression that would slip past the behavioural cases, and that is the
 * one the text catches.
 */

import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DatabaseManager, DEFAULT_SHUTDOWN_TIMEOUT_MS } from '../src/database.manager.js';

const TMP = mkdtempSync(join(tmpdir(), 'titan-db-shutdown-'));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

const logs: { level: string; args: unknown[] }[] = [];
const recordingLogger = () => {
  const logger = {
    info: vi.fn((...args: unknown[]) => logs.push({ level: 'info', args })),
    debug: vi.fn(),
    warn: vi.fn((...args: unknown[]) => logs.push({ level: 'warn', args })),
    error: vi.fn((...args: unknown[]) => logs.push({ level: 'error', args })),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
};

/** What the stands had: a driver whose destroy never settles. */
const NEVER = () => new Promise<void>(() => {});

const said = (needle: string): boolean =>
  logs.some((l) => l.args.some((a) => typeof a === 'string' && a.includes(needle)));

describe('closeAll, against a teardown that never settles', () => {
  let manager: DatabaseManager | undefined;

  afterEach(() => {
    // No `closeAll()` here: these cases decide for themselves whether to wait, and a
    // hook that waited would be the defect under test, holding the suite.
    manager = undefined;
    logs.length = 0;
  });

  async function managerOnFile(name: string, shutdownTimeout?: number): Promise<DatabaseManager> {
    const created = new DatabaseManager(
      {
        connection: { dialect: 'sqlite', connection: join(TMP, `${name}.sqlite`) },
        ...(shutdownTimeout === undefined ? {} : { shutdownTimeout }),
      },
      recordingLogger() as never
    );
    await created.init();
    manager = created;
    return created;
  }

  const registry = (db: DatabaseManager) =>
    (db as unknown as { connections: Map<string, { instance: { destroy: () => Promise<void> } }> }).connections;

  /** Bounded, so a defect fails a case instead of hanging the file. */
  async function closeWithin(db: DatabaseManager, ms: number): Promise<'closed' | 'stuck'> {
    return Promise.race([
      db.closeAll().then(() => 'closed' as const),
      new Promise<'stuck'>((resolve) => {
        const t = setTimeout(() => resolve('stuck'), ms);
        t.unref?.();
      }),
    ]);
  }

  it('applies the default when nobody asks for a bound', async () => {
    const db = await managerOnFile('default');
    expect((db as unknown as { shutdownTimeoutMs: number }).shutdownTimeoutMs).toBe(DEFAULT_SHUTDOWN_TIMEOUT_MS);
    // And the default is a real bound, not a placeholder.
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('stops waiting on a destroy that never settles, and names what it abandoned', async () => {
    const db = await managerOnFile('stuck', 300);
    registry(db).get('default')!.instance.destroy = NEVER;

    expect(await closeWithin(db, 4000)).toBe('closed');
    expect(said('did not close within shutdownTimeout')).toBe(true);
    // The operator needs the name, not only the fact.
    expect(logs.some((l) => l.args.some((a) => JSON.stringify(a ?? '').includes('default')))).toBe(true);
  });

  it('does not wait at all when asked for 0 — the opposite of what it used to do', async () => {
    const db = await managerOnFile('zero', 0);
    registry(db).get('default')!.instance.destroy = NEVER;

    // 200 ms is far below any bound: only «did not wait» can pass this.
    expect(await closeWithin(db, 200)).toBe('closed');
    expect(said('Not waiting for database connections')).toBe(true);
    // And it does not claim a close it never confirmed.
    expect(said('All database connections closed')).toBe(false);
  });

  it('reads its bound from one place, so the default cannot be bypassed', () => {
    const src = readFileSync(new URL('../src/database.manager.ts', import.meta.url), 'utf8');
    const at = src.indexOf('async closeAll(');
    expect(at, 'closeAll moved or was renamed').toBeGreaterThan(-1);
    // To the next member declaration at class indentation.
    const rest = src.slice(at + 1);
    const end = rest.search(/\n  (?:private |public |protected |async |get |static |\/\*\*)/);
    const body = rest.slice(0, end === -1 ? undefined : end);

    expect(body).toContain('this.shutdownTimeoutMs');
    // The option itself has exactly one reader, and it is the getter.
    expect(body).not.toContain('options.shutdownTimeout');
  });

  it('a healthy close still waits, and says so', async () => {
    const db = await managerOnFile('healthy', 4000);

    expect(await closeWithin(db, 4000)).toBe('closed');
    expect(said('All database connections closed')).toBe(true);
    expect(said('did not close within shutdownTimeout')).toBe(false);
    expect(registry(db).size).toBe(0);
  });
});
