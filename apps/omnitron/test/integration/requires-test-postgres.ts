/**
 * «The database was not there» and «the code is broken» are two findings.
 *
 * Both integration suites here used to `throw` from `beforeAll` when the test
 * Postgres was absent. Vitest reports that as a FAILED SUITE, identical in
 * shape to an assertion that caught a defect — measured 2026-09-22 on a full
 * omnitron run: «2 failed | 2022 passed», and the two were
 * `auth-throttle.test.ts` and `omnitron-migrations.test.ts`, neither of which
 * had run a single assertion. A reader has to open the log to learn that the
 * container simply was not up.
 *
 * The other error is worse and is the reason this file exists at all: a silent
 * `skip` would turn «2 failed, go read the log» into «all green», and nobody
 * would know two integration suites never ran. `run-checks.mjs` solved the
 * same problem for the scanners with a `NOT RUN` line that is counted and
 * named in the summary; this is that idea for vitest.
 *
 * So: the suites are SKIPPED (visible in the summary as skipped, never as
 * passed) and the reason is printed once, naming the URL and the command that
 * fixes it.
 */
import { sql } from 'kysely';

export interface TestPostgres {
  ok: boolean;
  url: string;
  reason?: string;
}

/**
 * Probe the test database once, cheaply, and say so out loud when it is absent.
 *
 * Called at module scope so `describe.skipIf` can use the answer — a
 * `beforeAll` runs too late to skip the suite it belongs to.
 */
export async function requiresTestPostgres(url: string): Promise<TestPostgres> {
  const { resetEnvCache, setEnvOverride } = await import('../../src/shared/env-config.js');
  resetEnvCache();
  setEnvOverride({ OMNITRON_DATABASE_URL: url });

  const { createOmnitronDb } = await import('../../src/database/connection.js');
  let db: Awaited<ReturnType<typeof createOmnitronDb>> | undefined;

  try {
    db = await createOmnitronDb({ max: 1 });
    await sql`SELECT 1`.execute(db);
    return { ok: true, url };
  } catch (err) {
    const reason = (err as Error).message;
    // One line, on stderr, so it survives a reporter that only prints
    // counts. Without it a skipped suite is indistinguishable from a suite
    // that does not exist.
    // `process.stderr.write`, not `console.warn`: vitest captures console
    // output per test and a module-scope `console.warn` is swallowed — checked,
    // it never reached the reporter. The stream survives.
    process.stderr.write(
      `\n  NOT RUN — integration suite skipped: test Postgres unreachable at ${url}\n` +
        `           run \`pnpm test:up\` from the repo root first\n` +
        `           cause: ${reason.split('\n')[0]}\n\n`
    );
    return { ok: false, url, reason };
  } finally {
    if (db) await db.destroy().catch(() => undefined);
  }
}
