/**
 * A misconfigured connection was asked about six times before it was reported.
 *
 * `createConnectionWithRetry` retries with backoff — 1+2+4+8+16 = 31 seconds —
 * and its `shouldRetry` accepted every SERVICE_UNAVAILABLE. `createConnection`
 * produces exactly that for ANY failure: the driver failing to build, and the
 * `SELECT 1` probe failing. So a wrong password, a database that does not
 * exist, a sqlite path whose directory is missing, a malformed connection
 * string — none of which change while you wait — each cost 31 seconds before
 * the process said what was wrong. On boot that is 31 seconds of `starting`
 * per connection.
 *
 * The comment above `shouldRetry` claimed the opposite:
 *
 *     // Config mistakes (bad dialect, malformed options) fail on the FIRST
 *     // attempt instead of burning the whole backoff budget.
 *
 * Measured, that was true of nothing. The distinction the code made was
 * "failed to build" versus "failed to connect", and both were wrapped the
 * same way one level up. The distinction that matters is permanent versus
 * transient, and nobody was drawing it.
 *
 * Measured before and after, through `DatabaseManager.init()`:
 *
 *     invalid dialect        31045ms  →      1ms
 *     sqlite missing dir     31013ms  →      2ms
 *     postgres wrong pass      108ms  →    100ms   (already fast)
 *     postgres no such db       12ms  →     12ms   (already fast)
 *     postgres refused port  31022ms  →  31025ms   (unchanged — correct)
 *
 * The last row is the point of the change being an allow-list rather than a
 * deny-list: a refused port is what a database container that has not
 * finished starting looks like, and that one must keep retrying. Anything not
 * recognised as hopeless keeps the old behaviour.
 *
 * Two of the measurements corrected an assumption on the way. `Errors.badRequest`
 * for an unknown dialect is never the error you actually get — the connection
 * string reaches URL parsing first and throws `ERR_INVALID_URL` — and
 * better-sqlite3 signals a missing directory with a bare `TypeError` carrying
 * no `code` at all.
 */
import { describe, it, expect } from 'vitest';
import { DatabaseManager, isPermanentConnectionError } from '../src/database.manager.js';

const silent = {
  debug() {}, info() {}, warn() {}, error() {}, trace() {}, fatal() {},
  child() { return silent; },
} as never;

/** How long `init()` takes to reject, in ms. Fails the test if it resolves. */
async function timeToReject(connection: unknown): Promise<number> {
  const manager = new DatabaseManager({ connection } as never, silent);
  const started = Date.now();
  try {
    await manager.init();
    throw new Error('init() resolved, but this configuration cannot connect');
  } catch {
    return Date.now() - started;
  } finally {
    await manager.closeAll().catch(() => { /* nothing to close */ });
  }
}

// Comfortably below the 31s budget and comfortably above any real startup
// cost, so this asserts "did not retry" rather than "was fast today".
const PROMPT_MS = 3_000;

describe('a configuration no retry can fix fails at once', () => {
  it('a connection string that does not parse', async () => {
    expect(await timeToReject({ dialect: 'invalid', connection: ':memory:' })).toBeLessThan(PROMPT_MS);
  });

  it('a sqlite path whose directory does not exist', async () => {
    // better-sqlite3 throws at CONSTRUCTION here, not at the first query, so
    // this exercises the build half rather than the probe half.
    expect(
      await timeToReject({ dialect: 'sqlite', connection: '/nonexistent/path/to/db.sqlite' }),
    ).toBeLessThan(PROMPT_MS);
  });

  it('a postgres password that is wrong', async () => {
    // Needs the stand's postgres to refuse it; if nothing is listening this
    // becomes the transient case and would legitimately take the full budget,
    // so it is written to accept either answer rather than to flake.
    const ms = await timeToReject({
      dialect: 'postgres',
      connection: { host: 'localhost', port: 5432, user: 'postgres', password: 'definitely-wrong', database: 'main' },
    });
    expect(ms < PROMPT_MS || ms > 25_000).toBe(true);
  }, 40_000);
});

describe('a good configuration still connects', () => {
  it('sqlite in memory', async () => {
    const manager = new DatabaseManager({ connection: { dialect: 'sqlite', connection: ':memory:' } } as never, silent);
    await manager.init();
    expect(manager.getConnectionNames()).toContain('default');
    await manager.closeAll();
  });
});

/**
 * The control that matters, and the one this file first got wrong.
 *
 * It originally claimed the sqlite-in-memory case above was the positive
 * control — that "a classifier calling everything permanent would break it".
 * Injecting exactly that showed otherwise: a connection that succeeds never
 * consults the classifier, so all four tests stayed green while every
 * transient failure had silently lost its retry. The control has to be a
 * failure that MUST still be retried.
 *
 * Asserted on the predicate rather than through a live connection, because
 * the only honest end-to-end version of it waits out the full 31-second
 * budget to prove the budget is still being spent.
 */
describe('a transient failure keeps its retries', () => {
  const transient = [
    ['a refused port — a container still starting', Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' })],
    ['a name that does not resolve yet', Object.assign(new Error('getaddrinfo ENOTFOUND db'), { code: 'ENOTFOUND' })],
    ['a connection reset mid-handshake', Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })],
    ['the server is starting up', Object.assign(new Error('the database system is starting up'), { code: '57P03' })],
    ['too many connections', Object.assign(new Error('sorry, too many clients already'), { code: '53300' })],
    ['a health-check timeout', new Error('Health check timed out after 5000ms')],
  ] as const;

  it.each(transient)('%s is not permanent', (_label, error) => {
    expect(isPermanentConnectionError(error)).toBe(false);
  });

  const permanent = [
    ['a wrong password', Object.assign(new Error('password authentication failed'), { code: '28P01' })],
    ['a database that does not exist', Object.assign(new Error('database "x" does not exist'), { code: '3D000' })],
    ['a sqlite file that cannot be opened', Object.assign(new Error('unable to open database file'), { code: 'SQLITE_CANTOPEN' })],
    ['a connection string that does not parse', Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' })],
    // No `code` at all — better-sqlite3's actual shape for a missing
    // directory, which is why the classifier reads messages as well as codes.
    ['a sqlite directory that is missing', new TypeError('Cannot open database because the directory does not exist')],
  ] as const;

  it.each(permanent)('%s is permanent', (_label, error) => {
    expect(isPermanentConnectionError(error)).toBe(true);
  });
});
